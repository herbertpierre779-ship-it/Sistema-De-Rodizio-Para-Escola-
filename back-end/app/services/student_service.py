from __future__ import annotations

import shutil
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, TypedDict

from app.adapters.face.engine import BaseFaceEngine
from app.core.clock import school_today, to_school_datetime
from app.core.config import Settings
from app.core.cpf import is_valid_cpf, normalize_cpf
from app.core.exceptions import AppError
from app.core.media import build_media_url, build_photo_relative_path, build_student_media_directory, slugify_segment
from app.models.entities import (
    ClassRecord,
    FaceEmbeddingRecord,
    FaceEmbeddingSampleRecord,
    MealType,
    RecognitionStatus,
    StudentRecord,
)
from app.schemas.settings import RegistrationCaptureMode
from app.repositories.contracts import (
    AppSettingsRepository,
    ClassRepository,
    FaceEmbeddingRepository,
    FaceEmbeddingSampleRepository,
    MealEntryFilters,
    MealEntryRepository,
    RecognitionAttemptRepository,
    StudentRepository,
)
from app.schemas.students import (
    AttendanceCalendarDayResponse,
    AttendanceTotalsResponse,
    FaceEnrollResponse,
    StudentFaceAssetItem,
    StudentFaceAssetsResponse,
    StudentAttendanceSummaryResponse,
    StudentCreateRequest,
    StudentResponse,
    StudentUpdateRequest,
)
from app.services.meal_entry_service import MealEntryService

CaptureKind = Literal["front", "right", "left", "sample", "unknown"]
LEGACY_MEDIA_MIGRATION_KEY = "legacy_media_migration_v1_done"
ADVANCED_CAPTURE_TOTAL = 50
DEFAULT_STABLE_SAMPLE_LIMIT = 20
DEFAULT_MIN_SAMPLE_QUALITY = 0.35


class ReenrollFilePayload(TypedDict):
    image_bytes: bytes
    content_type: str | None
    filename: str | None


class ReenrollVectorPayload(TypedDict):
    image_bytes: bytes
    storage_image_bytes: bytes
    engine: str
    vector: list[float]
    quality_score: float


class StudentService:
    def __init__(
        self,
        settings: Settings,
        app_settings_repository: AppSettingsRepository,
        student_repository: StudentRepository,
        class_repository: ClassRepository,
        face_embedding_repository: FaceEmbeddingRepository,
        face_embedding_sample_repository: FaceEmbeddingSampleRepository,
        meal_entry_repository: MealEntryRepository,
        recognition_attempt_repository: RecognitionAttemptRepository,
        face_engine: BaseFaceEngine,
    ) -> None:
        self.settings = settings
        self.app_settings_repository = app_settings_repository
        self.student_repository = student_repository
        self.class_repository = class_repository
        self.face_embedding_repository = face_embedding_repository
        self.face_embedding_sample_repository = face_embedding_sample_repository
        self.meal_entry_repository = meal_entry_repository
        self.recognition_attempt_repository = recognition_attempt_repository
        self.face_engine = face_engine

    def migrate_legacy_media_if_needed(self) -> None:
        if self.app_settings_repository.get_value(LEGACY_MEDIA_MIGRATION_KEY) == "done":
            return

        students = sorted(self.student_repository.list_students(), key=lambda item: int(item.id) if item.id.isdigit() else 0)
        for student in students:
            class_record = self.class_repository.get_by_id(student.class_id)
            if not class_record:
                continue
            self._migrate_student_legacy_media(student, class_record)

        self.app_settings_repository.set_value(LEGACY_MEDIA_MIGRATION_KEY, "done")

    def list_students(self) -> list[StudentResponse]:
        students = sorted(self.student_repository.list_students(), key=lambda item: item.full_name.casefold())
        return [self.to_response(student) for student in students]

    def get_student_record(self, student_id: str) -> StudentRecord:
        student = self.student_repository.get_by_id(student_id)
        if not student:
            raise AppError(404, "Aluno não encontrado.")
        return student

    def get_student(self, student_id: str) -> StudentResponse:
        return self.to_response(self.get_student_record(student_id))

    def get_face_assets(self, student_id: str) -> StudentFaceAssetsResponse:
        student = self.get_student_record(student_id)
        class_record = self._ensure_class_exists(student.class_id)
        student = self._ensure_student_media_folder(student, class_record)
        embedding = self.face_embedding_repository.get_by_student_id(student.id)
        sample_assets = self._list_cycle_sample_assets(class_record, student)
        samples_count = embedding.samples_count if embedding else len(sample_assets)
        mode_hint: RegistrationCaptureMode = "hundred_photos" if samples_count >= ADVANCED_CAPTURE_TOTAL else "three_photos"

        return StudentFaceAssetsResponse(
            student_id=student.id,
            full_name=student.full_name,
            cpf=student.cpf,
            class_id=student.class_id,
            school_year=class_record.school_year,
            mode_hint=mode_hint,
            samples_count=samples_count,
            front_url=build_media_url(student.photo_path),
            right_url=build_media_url(student.photo_right_path),
            left_url=build_media_url(student.photo_left_path),
            sample_urls=sample_assets,
        )

    def rebuild_face_embeddings_for_student(self, student_id: str) -> tuple[int, int]:
        student = self.get_student_record(student_id)
        class_record = self._ensure_class_exists(student.class_id)
        student = self._ensure_student_media_folder(student, class_record)
        source_paths = self._list_student_sample_relative_paths(class_record, student)
        if not source_paths:
            return 0, 0

        now = datetime.now(UTC)
        sample_records: list[FaceEmbeddingSampleRecord] = []
        for relative_path in source_paths:
            absolute_path = self.settings.photos_root_path / relative_path
            if not absolute_path.exists() or not absolute_path.is_file():
                continue
            try:
                image_bytes = absolute_path.read_bytes()
            except OSError:
                continue
            extraction = self.face_engine.extract_embedding(image_bytes)
            if extraction.status != RecognitionStatus.success or not extraction.vector:
                continue
            cropped_image_bytes = extraction.cropped_image_bytes
            if cropped_image_bytes:
                try:
                    absolute_path.parent.mkdir(parents=True, exist_ok=True)
                    absolute_path.write_bytes(cropped_image_bytes)
                except OSError:
                    # Se falhar escrita do recorte, seguimos com a amostra atual para nao interromper o rebuild.
                    pass
            sample_records.append(
                FaceEmbeddingSampleRecord(
                    student_id=student_id,
                    engine=extraction.engine,
                    vector=extraction.vector,
                    source_image_path=relative_path,
                    quality_score=self._normalize_quality_score(extraction.quality_score),
                    created_at=now,
                    updated_at=now,
                )
            )

        if not sample_records:
            raise RuntimeError("Nenhuma amostra valida foi gerada durante o rebuild.")

        sample_source_paths = [sample.source_image_path for sample in sample_records if sample.source_image_path]
        primary_source_path = sample_source_paths[0] if sample_source_paths else None
        student_updates: dict[str, object] = {"updated_at": now}
        if primary_source_path and (not student.photo_path or student.photo_path not in sample_source_paths):
            student_updates["photo_path"] = primary_source_path
        student = self.student_repository.update(student.model_copy(update=student_updates))

        self.face_embedding_sample_repository.replace_for_student(student_id, sample_records)
        stable_vectors = self._select_stable_vectors(sample_records)
        averaged_vector = self._average_vectors(stable_vectors)
        existing_embedding = self.face_embedding_repository.get_by_student_id(student_id)
        self.face_embedding_repository.upsert(
            FaceEmbeddingRecord(
                id=existing_embedding.id if existing_embedding else "",
                student_id=student_id,
                engine=sample_records[-1].engine,
                vector=averaged_vector,
                samples_count=len(sample_records),
                source_image_path=sample_records[-1].source_image_path,
                created_at=existing_embedding.created_at if existing_embedding else now,
                updated_at=now,
            )
        )
        return len(sample_records), len(stable_vectors)

    def estimate_face_sample_count(self, student_id: str) -> int:
        student = self.get_student_record(student_id)
        class_record = self._ensure_class_exists(student.class_id)
        student = self._ensure_student_media_folder(student, class_record)
        return len(self._list_student_sample_relative_paths(class_record, student))

    def reenroll_face_batch(
        self,
        *,
        student_id: str,
        mode: RegistrationCaptureMode,
        files: list[ReenrollFilePayload],
    ) -> FaceEnrollResponse:
        student = self.get_student_record(student_id)
        class_record = self._ensure_class_exists(student.class_id)
        student = self._ensure_student_media_folder(student, class_record)
        expected_count = ADVANCED_CAPTURE_TOTAL if mode == "hundred_photos" else 3
        received_count = len(files)
        if received_count != expected_count:
            raise AppError(
                400,
                f"Quantidade invalida para recaptura: esperado {expected_count} arquivo(s), recebido {received_count}.",
            )

        extracted = self._extract_reenroll_vectors(mode=mode, files=files)
        now = datetime.now(UTC)

        self.face_embedding_repository.delete_by_student_id(student_id)
        self.face_embedding_sample_repository.delete_by_student_id(student_id)
        self._delete_student_media_directory(student)
        self._delete_photo(student.photo_path)
        self._delete_photo(student.photo_right_path)
        self._delete_photo(student.photo_left_path)

        saved_paths: list[str] = []
        for index, payload in enumerate(extracted):
            filename = self._resolve_reenroll_filename(mode=mode, index=index)
            saved_path = self._save_named_photo(student, class_record, payload["storage_image_bytes"], filename)
            saved_paths.append(saved_path)

        if not saved_paths:
            raise AppError(400, "Nenhuma foto valida foi enviada para recaptura.")

        student_updates: dict[str, object] = {
            "photo_path": saved_paths[0],
            "photo_right_path": saved_paths[1] if mode == "three_photos" else None,
            "photo_left_path": saved_paths[2] if mode == "three_photos" else None,
            "updated_at": now,
        }
        updated_student = self.student_repository.update(student.model_copy(update=student_updates))

        sample_records = [
            FaceEmbeddingSampleRecord(
                student_id=student_id,
                engine=payload["engine"],
                vector=payload["vector"],
                source_image_path=saved_paths[index],
                quality_score=payload["quality_score"],
                created_at=now,
                updated_at=now,
            )
            for index, payload in enumerate(extracted)
        ]
        self.face_embedding_sample_repository.replace_for_student(student_id, sample_records)

        stable_vectors = self._select_stable_vectors(sample_records)
        averaged_vector = self._average_vectors(stable_vectors)
        embedding = FaceEmbeddingRecord(
            student_id=student_id,
            engine=extracted[-1]["engine"],
            vector=averaged_vector,
            samples_count=len(sample_records),
            source_image_path=saved_paths[-1],
            created_at=now,
            updated_at=now,
        )
        self.face_embedding_repository.upsert(embedding)
        return FaceEnrollResponse(student=self.to_response(updated_student), engine=embedding.engine, enrolled_at=now)

    def get_attendance_summary(
        self,
        student_id: str,
        *,
        month_value: str | None = None,
    ) -> StudentAttendanceSummaryResponse:
        student = self.get_student_record(student_id)
        month = self._parse_month(month_value)
        entries = self.meal_entry_repository.list_entries(MealEntryFilters(student_id=student_id))
        month_entries = [
            entry
            for entry in entries
            if (entry_date := to_school_datetime(self.settings, entry.recorded_at).date()).year == month.year
            and entry_date.month == month.month
        ]

        calendar_map: dict[str, set[MealType]] = defaultdict(set)
        for entry in month_entries:
            entry_date = to_school_datetime(self.settings, entry.recorded_at).date().isoformat()
            calendar_map[entry_date].add(entry.meal_type)

        meal_order = {
            MealType.almoco: 1,
            MealType.merenda: 2,
            MealType.sem_rodizio: 3,
        }

        calendar_days = [
            AttendanceCalendarDayResponse(
                date=date_key,
                meal_types=sorted(meal_types, key=lambda meal_type: meal_order[meal_type]),
            )
            for date_key, meal_types in sorted(calendar_map.items())
        ]

        return StudentAttendanceSummaryResponse(
            student=self.to_response(student),
            month=month.strftime("%Y-%m"),
            attendance_days=len(calendar_days),
            totals_by_meal=AttendanceTotalsResponse(
                almoco=sum(1 for entry in month_entries if entry.meal_type == MealType.almoco),
                merenda=sum(1 for entry in month_entries if entry.meal_type == MealType.merenda),
                sem_rodizio=sum(1 for entry in month_entries if entry.meal_type == MealType.sem_rodizio),
            ),
            calendar_days=calendar_days,
            recent_entries=[MealEntryService.to_response(entry) for entry in entries[:8]],
        )

    def create_student(self, payload: StudentCreateRequest) -> StudentResponse:
        self._ensure_class_exists(payload.class_id)
        normalized_cpf = self._normalize_and_validate_cpf(payload.cpf)
        if self.student_repository.get_by_cpf(normalized_cpf):
            raise AppError(409, "Já existe um aluno cadastrado com esse CPF.")
        full_name = normalize_uppercase_text(payload.full_name)
        now = datetime.now(UTC)
        media_folder = self._build_unique_media_folder(payload.class_id, full_name, exclude_student_id=None)
        student = StudentRecord(
            full_name=full_name,
            class_id=payload.class_id,
            cpf=normalized_cpf,
            media_folder=media_folder,
            created_at=now,
            updated_at=now,
        )
        return self.to_response(self.student_repository.create(student))

    def update_student(self, student_id: str, payload: StudentUpdateRequest) -> StudentResponse:
        previous_student = self.get_student_record(student_id)
        next_class_id = payload.class_id or previous_student.class_id
        self._ensure_class_exists(next_class_id)
        next_full_name = (
            normalize_uppercase_text(payload.full_name) if payload.full_name is not None else previous_student.full_name
        )

        next_cpf = previous_student.cpf
        if payload.cpf is not None:
            normalized_cpf = self._normalize_and_validate_cpf(payload.cpf)
            existing_with_cpf = self.student_repository.get_by_cpf(normalized_cpf)
            if existing_with_cpf and existing_with_cpf.id != previous_student.id:
                raise AppError(409, "Já existe um aluno cadastrado com esse CPF.")
            next_cpf = normalized_cpf

        media_folder_changed = (
            payload.full_name is not None
            or payload.class_id is not None
            or not previous_student.media_folder
        )
        next_media_folder = previous_student.media_folder
        if media_folder_changed:
            next_media_folder = self._build_unique_media_folder(
                next_class_id,
                next_full_name,
                exclude_student_id=previous_student.id,
            )

        updated_student = previous_student.model_copy(
            update={
                "full_name": next_full_name,
                "class_id": next_class_id,
                "cpf": next_cpf,
                "media_folder": next_media_folder,
                "updated_at": datetime.now(UTC),
            }
        )
        persisted = self.student_repository.update(updated_student)
        if (
            previous_student.class_id != persisted.class_id
            or previous_student.media_folder != persisted.media_folder
            or payload.full_name is not None
        ):
            persisted = self._relocate_student_media(previous_student, persisted)
        return self.to_response(persisted)

    def delete_student(self, student_id: str) -> None:
        student = self.get_student_record(student_id)
        self.face_embedding_repository.delete_by_student_id(student_id)
        self.face_embedding_sample_repository.delete_by_student_id(student_id)
        self.meal_entry_repository.delete_by_student_id(student_id)
        self._delete_student_media_directory(student)
        self._delete_photo(student.photo_path)
        self._delete_photo(student.photo_right_path)
        self._delete_photo(student.photo_left_path)
        self.recognition_attempt_repository.delete_by_student_id(student_id)
        self.student_repository.delete(student_id)

    def enroll_face(
        self,
        student_id: str,
        *,
        image_bytes: bytes,
        content_type: str | None,
        filename: str | None,
    ) -> FaceEnrollResponse:
        _ = content_type
        student = self.get_student_record(student_id)
        class_record = self._ensure_class_exists(student.class_id)
        student = self._ensure_student_media_folder(student, class_record)

        extraction = self.face_engine.extract_embedding(image_bytes)
        if extraction.status != RecognitionStatus.success or not extraction.vector:
            raise AppError(400, extraction.message)

        now = datetime.now(UTC)
        existing_embedding = self.face_embedding_repository.get_by_student_id(student_id)
        capture_kind, sample_cycle, sample_index = self._resolve_capture_kind(filename)
        student_updates: dict[str, object] = {}
        storage_image_bytes = extraction.cropped_image_bytes or image_bytes
        source_image_path: str | None = student.photo_path

        if capture_kind == "front":
            front_path = self._save_named_photo(student, class_record, storage_image_bytes, "front.jpg")
            student_updates["photo_path"] = front_path
            source_image_path = front_path
        elif capture_kind == "right":
            right_path = self._save_named_photo(student, class_record, storage_image_bytes, "right.jpg")
            student_updates["photo_right_path"] = right_path
            source_image_path = right_path
            if not student.photo_path:
                student_updates["photo_path"] = right_path
        elif capture_kind == "left":
            left_path = self._save_named_photo(student, class_record, storage_image_bytes, "left.jpg")
            student_updates["photo_left_path"] = left_path
            source_image_path = left_path
            if not student.photo_path:
                student_updates["photo_path"] = left_path
        elif capture_kind == "sample" and sample_cycle is not None and sample_index is not None:
            sample_filename = f"cycle-{sample_cycle:02d}-{sample_index:03d}.jpg"
            sample_path = self._save_named_photo(student, class_record, storage_image_bytes, sample_filename)
            source_image_path = sample_path
            if not student.photo_path:
                student_updates["photo_path"] = sample_path
        else:
            if not student.photo_path:
                fallback_path = self._save_named_photo(student, class_record, storage_image_bytes, "front.jpg")
                student_updates["photo_path"] = fallback_path
                source_image_path = fallback_path
            else:
                timestamp_filename = f"sample-{int(time.time() * 1000)}.jpg"
                source_image_path = self._save_named_photo(
                    student,
                    class_record,
                    storage_image_bytes,
                    timestamp_filename,
                )

        if student_updates:
            student_updates["updated_at"] = now
            updated_student = self.student_repository.update(student.model_copy(update=student_updates))
        else:
            updated_student = student

        source_image_path = source_image_path or updated_student.photo_path
        if not source_image_path:
            raise AppError(400, "Nao foi possivel determinar o caminho da amostra capturada.")

        sample_record = FaceEmbeddingSampleRecord(
            student_id=student_id,
            engine=extraction.engine,
            vector=extraction.vector,
            source_image_path=source_image_path,
            quality_score=self._normalize_quality_score(extraction.quality_score),
            created_at=now,
            updated_at=now,
        )
        self.face_embedding_sample_repository.upsert(sample_record)

        all_samples = self.face_embedding_sample_repository.list_by_student_id(student_id)
        stable_vectors = self._select_stable_vectors(all_samples)
        averaged_vector = self._average_vectors(stable_vectors)
        next_samples_count = len(all_samples)

        embedding = FaceEmbeddingRecord(
            id=existing_embedding.id if existing_embedding else "",
            student_id=student_id,
            engine=extraction.engine,
            vector=averaged_vector,
            samples_count=next_samples_count,
            source_image_path=source_image_path,
            created_at=existing_embedding.created_at if existing_embedding else now,
            updated_at=now,
        )
        self.face_embedding_repository.upsert(embedding)
        return FaceEnrollResponse(student=self.to_response(updated_student), engine=embedding.engine, enrolled_at=now)

    def to_response(self, student: StudentRecord) -> StudentResponse:
        class_record = self._ensure_class_exists(student.class_id)
        embedding = self.face_embedding_repository.get_by_student_id(student.id)
        return StudentResponse(
            id=student.id,
            full_name=student.full_name,
            class_id=student.class_id,
            class_name=class_record.name,
            class_display_name=f"{class_record.school_year.value} - {class_record.name}",
            school_year=class_record.school_year,
            photo_url=build_media_url(student.photo_path),
            has_face_enrolled=embedding is not None,
            created_at=student.created_at,
            updated_at=student.updated_at,
        )

    def sync_student_media_location(self, student_id: str, class_record: ClassRecord) -> StudentRecord:
        student = self.get_student_record(student_id)
        student = self._ensure_student_media_folder(student, class_record)
        return self._relocate_student_media(student, student, target_class=class_record)

    def _migrate_student_legacy_media(self, student: StudentRecord, class_record: ClassRecord) -> None:
        if not self._is_legacy_student_media(student):
            return

        now = datetime.now(UTC)
        migrated_student = student
        if not migrated_student.media_folder:
            next_media_folder = self._build_unique_media_folder(
                class_record.id,
                migrated_student.full_name,
                exclude_student_id=migrated_student.id,
            )
            migrated_student = self.student_repository.update(
                migrated_student.model_copy(update={"media_folder": next_media_folder, "updated_at": now})
            )

        if not migrated_student.media_folder:
            return

        target_dir = build_student_media_directory(class_record, migrated_student.media_folder)
        target_front = f"{target_dir}/front.jpg"
        target_right = f"{target_dir}/right.jpg"
        target_left = f"{target_dir}/left.jpg"

        old_front = student.photo_path
        old_right = student.photo_right_path
        old_left = student.photo_left_path

        path_remap: dict[str, str] = {}
        front_exists = self._move_file_if_exists(old_front, target_front, move=True)
        if old_front and front_exists:
            path_remap[old_front] = target_front

        right_exists = self._move_file_if_exists(old_right, target_right, move=True)
        if old_right and right_exists:
            path_remap[old_right] = target_right

        left_exists = self._move_file_if_exists(old_left, target_left, move=True)
        if old_left and left_exists:
            path_remap[old_left] = target_left

        if not front_exists:
            if right_exists:
                self._copy_file_if_exists(target_right, target_front)
                front_exists = self._file_exists(target_front)
            elif left_exists:
                self._copy_file_if_exists(target_left, target_front)
                front_exists = self._file_exists(target_front)

        if front_exists and not right_exists:
            self._copy_file_if_exists(target_front, target_right)
            right_exists = self._file_exists(target_right)
        if front_exists and not left_exists:
            self._copy_file_if_exists(target_front, target_left)
            left_exists = self._file_exists(target_left)

        student_updates: dict[str, object] = {"updated_at": datetime.now(UTC)}
        student_updates["photo_path"] = target_front if front_exists else None
        student_updates["photo_right_path"] = target_right if right_exists else None
        student_updates["photo_left_path"] = target_left if left_exists else None
        persisted_student = self.student_repository.update(migrated_student.model_copy(update=student_updates))

        existing_embedding = self.face_embedding_repository.get_by_student_id(persisted_student.id)
        if existing_embedding and existing_embedding.source_image_path:
            next_source = path_remap.get(existing_embedding.source_image_path)
            if not next_source and self._is_legacy_path(existing_embedding.source_image_path):
                legacy_source_filename = Path(existing_embedding.source_image_path).name
                next_source_candidate = f"{target_dir}/{legacy_source_filename}"
                if self._move_file_if_exists(existing_embedding.source_image_path, next_source_candidate, move=True):
                    next_source = next_source_candidate
            if not next_source and front_exists:
                next_source = target_front
            if next_source and next_source != existing_embedding.source_image_path:
                self.face_embedding_repository.upsert(
                    existing_embedding.model_copy(
                        update={
                            "source_image_path": next_source,
                            "updated_at": datetime.now(UTC),
                        }
                    )
                )

    def _list_cycle_sample_assets(
        self,
        class_record: ClassRecord,
        student: StudentRecord,
    ) -> list[StudentFaceAssetItem]:
        if not student.media_folder:
            return []

        media_dir_relative = build_student_media_directory(class_record, student.media_folder)
        media_dir_absolute = self.settings.photos_root_path / media_dir_relative
        if not media_dir_absolute.exists() or not media_dir_absolute.is_dir():
            return []

        assets: list[StudentFaceAssetItem] = []
        for item in sorted(media_dir_absolute.glob("cycle-*.jpg")):
            if not item.is_file():
                continue
            filename = item.name
            stem = Path(filename).stem.casefold()
            if not stem.startswith("cycle-"):
                continue
            relative = (Path(media_dir_relative) / filename).as_posix()
            url = build_media_url(relative)
            if not url:
                continue
            assets.append(StudentFaceAssetItem(filename=filename, url=url))
        return assets

    def _list_student_sample_relative_paths(
        self,
        class_record: ClassRecord,
        student: StudentRecord,
    ) -> list[str]:
        cycle_assets = self._list_cycle_sample_assets(class_record, student)
        if cycle_assets:
            media_dir_relative = build_student_media_directory(class_record, student.media_folder or "")
            paths = [
                (Path(media_dir_relative) / item.filename).as_posix()
                for item in cycle_assets
            ]
            return [path for path in paths if path.strip()]

        ordered_paths: list[str] = []
        seen: set[str] = set()
        for value in (student.photo_path, student.photo_right_path, student.photo_left_path):
            if not value:
                continue
            normalized = value.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered_paths.append(normalized)
        return ordered_paths

    def _extract_reenroll_vectors(
        self,
        *,
        mode: RegistrationCaptureMode,
        files: list[ReenrollFilePayload],
    ) -> list[ReenrollVectorPayload]:
        extracted: list[ReenrollVectorPayload] = []
        expected_length: int | None = None

        for index, payload in enumerate(files):
            extraction = self.face_engine.extract_embedding(payload["image_bytes"])
            if extraction.status != RecognitionStatus.success or not extraction.vector:
                raise AppError(
                    400,
                    f"Falha na {self._reenroll_position_label(mode, index)}: {extraction.message}",
                )

            if expected_length is None:
                expected_length = len(extraction.vector)
            elif len(extraction.vector) != expected_length:
                raise AppError(
                    400,
                    f"Falha na {self._reenroll_position_label(mode, index)}: dimensao de embedding inconsistente.",
                )

            extracted.append(
                ReenrollVectorPayload(
                    image_bytes=payload["image_bytes"],
                    storage_image_bytes=extraction.cropped_image_bytes or payload["image_bytes"],
                    engine=extraction.engine,
                    vector=extraction.vector,
                    quality_score=self._normalize_quality_score(extraction.quality_score),
                )
            )
        return extracted

    @staticmethod
    def _resolve_reenroll_filename(*, mode: RegistrationCaptureMode, index: int) -> str:
        if mode == "three_photos":
            if index == 0:
                return "front.jpg"
            if index == 1:
                return "right.jpg"
            return "left.jpg"

        cycle = (index // 25) + 1
        position = (index % 25) + 1
        return f"cycle-{cycle:02d}-{position:03d}.jpg"

    @staticmethod
    def _average_vectors(vectors: list[list[float]]) -> list[float]:
        if not vectors:
            return []
        vector_size = len(vectors[0])
        totals = [0.0] * vector_size
        for vector in vectors:
            for index, value in enumerate(vector):
                totals[index] += value
        count = float(len(vectors))
        return [value / count for value in totals]

    @staticmethod
    def _normalize_quality_score(raw_value: float | None) -> float:
        if raw_value is None:
            return 0.5
        return max(0.0, min(1.0, float(raw_value)))

    def _select_stable_vectors(self, samples: list[FaceEmbeddingSampleRecord]) -> list[list[float]]:
        if not samples:
            return []

        min_quality = self._min_sample_quality()
        filtered = [
            sample
            for sample in samples
            if sample.vector and sample.quality_score >= min_quality
        ]
        source = filtered if filtered else [sample for sample in samples if sample.vector]
        if not source:
            return []

        ranked = sorted(
            source,
            key=lambda sample: (sample.quality_score, sample.updated_at.timestamp()),
            reverse=True,
        )
        selected = ranked[: self._stable_sample_limit()]
        return [sample.vector for sample in selected]

    def _stable_sample_limit(self) -> int:
        profile = str(self.settings.recognition_profile).strip().casefold()
        if profile in {"naogazei_like", "naogazei", "aggressive"}:
            return max(20, int(self.settings.recognition_naogazei_stable_sample_limit))
        return DEFAULT_STABLE_SAMPLE_LIMIT

    def _min_sample_quality(self) -> float:
        profile = str(self.settings.recognition_profile).strip().casefold()
        if profile in {"naogazei_like", "naogazei", "aggressive"}:
            return max(0.0, min(1.0, float(self.settings.recognition_naogazei_min_quality_score)))
        return DEFAULT_MIN_SAMPLE_QUALITY

    @staticmethod
    def _reenroll_position_label(mode: RegistrationCaptureMode, index: int) -> str:
        if mode == "three_photos":
            labels = ["foto 1/3 (frente)", "foto 2/3 (lado direito)", "foto 3/3 (lado esquerdo)"]
            if 0 <= index < len(labels):
                return labels[index]
            return f"foto {index + 1}/3"

        cycle = (index // 25) + 1
        position = (index % 25) + 1
        return f"foto {position}/25 do ciclo {cycle}"

    def _ensure_class_exists(self, class_id: str) -> ClassRecord:
        class_record = self.class_repository.get_by_id(class_id)
        if not class_record:
            raise AppError(404, "Turma não encontrada.")
        return class_record

    def _move_file_if_exists(self, source_relative: str | None, target_relative: str, *, move: bool) -> bool:
        if not source_relative:
            return False
        source_absolute = self.settings.photos_root_path / source_relative
        target_absolute = self.settings.photos_root_path / target_relative

        if source_absolute.resolve() == target_absolute.resolve():
            return source_absolute.exists() and source_absolute.is_file()
        if not source_absolute.exists() or not source_absolute.is_file():
            return False

        target_absolute.parent.mkdir(parents=True, exist_ok=True)
        if target_absolute.exists() and target_absolute.is_file():
            target_absolute.unlink()

        if move:
            source_absolute.replace(target_absolute)
        else:
            shutil.copy2(source_absolute, target_absolute)
        return True

    def _copy_file_if_exists(self, source_relative: str, target_relative: str) -> bool:
        return self._move_file_if_exists(source_relative, target_relative, move=False)

    def _file_exists(self, relative_path: str) -> bool:
        absolute_path = self.settings.photos_root_path / relative_path
        return absolute_path.exists() and absolute_path.is_file()

    def _is_legacy_student_media(self, student: StudentRecord) -> bool:
        if not student.media_folder:
            return True
        for path in (student.photo_path, student.photo_right_path, student.photo_left_path):
            if self._is_legacy_path(path):
                return True
        return False

    @staticmethod
    def _is_legacy_path(path: str | None) -> bool:
        if not path:
            return False
        return len(Path(path).parts) < 4

    def _save_named_photo(
        self,
        student: StudentRecord,
        class_record: ClassRecord,
        image_bytes: bytes,
        filename: str,
    ) -> str:
        if not student.media_folder:
            raise AppError(500, "Pasta de mídia do aluno não definida.")
        relative_path = build_photo_relative_path(class_record, student.media_folder, filename)
        absolute_path = self.settings.photos_root_path / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(image_bytes)
        return relative_path

    def _delete_photo(self, relative_path: str | None) -> None:
        if not relative_path:
            return
        absolute_path = self.settings.photos_root_path / relative_path
        if absolute_path.exists() and absolute_path.is_file():
            absolute_path.unlink()

    def _delete_student_media_directory(self, student: StudentRecord) -> None:
        class_record = self.class_repository.get_by_id(student.class_id)
        candidate_dirs: set[str] = set()
        if class_record and student.media_folder:
            candidate_dirs.add(build_student_media_directory(class_record, student.media_folder))
        resolved_dir = self._resolve_student_media_dir_from_paths(student)
        if resolved_dir:
            candidate_dirs.add(resolved_dir)
        if not candidate_dirs:
            return

        for relative_dir in candidate_dirs:
            absolute_dir = self.settings.photos_root_path / relative_dir
            if absolute_dir.exists() and absolute_dir.is_dir():
                shutil.rmtree(absolute_dir, ignore_errors=True)

    def _relocate_student_media(
        self,
        previous_student: StudentRecord,
        updated_student: StudentRecord,
        target_class: ClassRecord | None = None,
    ) -> StudentRecord:
        class_record = target_class or self._ensure_class_exists(updated_student.class_id)
        previous_dir = self._resolve_student_media_dir_from_paths(previous_student)
        target_dir = (
            build_student_media_directory(class_record, updated_student.media_folder)
            if updated_student.media_folder
            else None
        )

        if previous_dir and target_dir and previous_dir != target_dir:
            previous_absolute_dir = self.settings.photos_root_path / previous_dir
            target_absolute_dir = self.settings.photos_root_path / target_dir
            if previous_absolute_dir.exists() and previous_absolute_dir.is_dir():
                target_absolute_dir.parent.mkdir(parents=True, exist_ok=True)
                if target_absolute_dir.exists():
                    shutil.rmtree(target_absolute_dir, ignore_errors=True)
                previous_absolute_dir.replace(target_absolute_dir)

        path_updates = self._rebase_student_paths(previous_student, target_dir)
        if not path_updates:
            return updated_student

        persisted = self.student_repository.update(
            updated_student.model_copy(update={**path_updates, "updated_at": datetime.now(UTC)})
        )
        existing_embedding = self.face_embedding_repository.get_by_student_id(updated_student.id)
        if (
            existing_embedding
            and existing_embedding.source_image_path
            and previous_dir
            and target_dir
            and existing_embedding.source_image_path.startswith(f"{previous_dir}/")
        ):
            new_source_path = f"{target_dir}/{existing_embedding.source_image_path.removeprefix(f'{previous_dir}/')}"
            self.face_embedding_repository.upsert(
                existing_embedding.model_copy(
                    update={
                        "source_image_path": new_source_path,
                        "updated_at": datetime.now(UTC),
                    }
                )
            )
        if previous_dir and target_dir:
            sample_records = self.face_embedding_sample_repository.list_by_student_id(updated_student.id)
            for sample in sample_records:
                if not sample.source_image_path.startswith(f"{previous_dir}/"):
                    continue
                next_source = f"{target_dir}/{sample.source_image_path.removeprefix(f'{previous_dir}/')}"
                if next_source == sample.source_image_path:
                    continue
                self.face_embedding_sample_repository.upsert(
                    sample.model_copy(
                        update={
                            "source_image_path": next_source,
                            "updated_at": datetime.now(UTC),
                        }
                    )
                )
        return persisted

    def _rebase_student_paths(self, student: StudentRecord, target_dir: str | None) -> dict[str, str | None]:
        if not target_dir:
            return {}

        updates: dict[str, str | None] = {}
        for field_name in ("photo_path", "photo_right_path", "photo_left_path"):
            current_path = getattr(student, field_name)
            if not current_path:
                continue
            current_parts = Path(current_path).parts
            filename = Path(current_path).name
            if len(current_parts) >= 4:
                current_dir = Path(current_path).parent.as_posix()
                rebased_path = f"{target_dir}/{filename}"
                if current_dir != target_dir and rebased_path != current_path:
                    updates[field_name] = rebased_path
            else:
                updates[field_name] = f"{target_dir}/{filename}"
                source_absolute_path = self.settings.photos_root_path / current_path
                target_absolute_path = self.settings.photos_root_path / updates[field_name]
                if source_absolute_path.exists() and source_absolute_path.is_file():
                    target_absolute_path.parent.mkdir(parents=True, exist_ok=True)
                    if target_absolute_path.exists():
                        target_absolute_path.unlink()
                    source_absolute_path.replace(target_absolute_path)
        return updates

    def _ensure_student_media_folder(self, student: StudentRecord, class_record: ClassRecord) -> StudentRecord:
        if student.media_folder:
            return student

        inferred = self._infer_media_folder(student)
        next_media_folder = inferred or self._build_unique_media_folder(
            class_record.id,
            student.full_name,
            exclude_student_id=student.id,
        )
        updated = self.student_repository.update(
            student.model_copy(update={"media_folder": next_media_folder, "updated_at": datetime.now(UTC)})
        )
        return self._relocate_student_media(student, updated, target_class=class_record)

    def _build_unique_media_folder(
        self,
        class_id: str,
        full_name: str,
        *,
        exclude_student_id: str | None,
    ) -> str:
        base_folder = slugify_segment(full_name)
        students = self.student_repository.list_by_class_id(class_id)
        used_folders: set[str] = set()
        for item in students:
            if exclude_student_id and item.id == exclude_student_id:
                continue
            item_folder = item.media_folder or self._infer_media_folder(item)
            if item_folder:
                used_folders.add(item_folder.casefold())

        candidate = base_folder
        suffix = 1
        while candidate.casefold() in used_folders:
            candidate = f"{base_folder}-{suffix}"
            suffix += 1
        return candidate

    @staticmethod
    def _resolve_capture_kind(filename: str | None) -> tuple[CaptureKind, int | None, int | None]:
        if not filename:
            return "unknown", None, None

        stem = Path(filename).stem.casefold()
        if any(token in stem for token in ("right", "direita")):
            return "right", None, None
        if any(token in stem for token in ("left", "esquerda")):
            return "left", None, None
        if any(token in stem for token in ("front", "frente", "principal", "main")):
            return "front", None, None
        if "cycle-" in stem:
            parts = stem.replace("_", "-").split("-")
            try:
                cycle = int(parts[-2])
                index = int(parts[-1])
                return "sample", max(1, cycle), max(1, index)
            except (ValueError, IndexError):
                return "sample", None, None
        return "unknown", None, None

    @staticmethod
    def _infer_media_folder(student: StudentRecord) -> str | None:
        media_dir = StudentService._resolve_student_media_dir_from_paths(student)
        if not media_dir:
            return None
        parts = Path(media_dir).parts
        if len(parts) < 3:
            return None
        return str(parts[-1])

    @staticmethod
    def _resolve_student_media_dir_from_paths(student: StudentRecord) -> str | None:
        for relative_path in (student.photo_path, student.photo_right_path, student.photo_left_path):
            if not relative_path:
                continue
            path = Path(relative_path)
            parts = path.parts
            if len(parts) >= 4:
                return path.parent.as_posix()
        return None

    @staticmethod
    def _normalize_and_validate_cpf(value: str) -> str:
        normalized = normalize_cpf(value)
        if not is_valid_cpf(normalized):
            raise AppError(400, "CPF inválido. Informe um CPF válido com 11 dígitos.")
        return normalized

    def _parse_month(self, month_value: str | None) -> datetime:
        if not month_value:
            today = school_today(self.settings)
            return datetime(today.year, today.month, 1)

        try:
            return datetime.strptime(month_value, "%Y-%m")
        except ValueError as exc:
            raise AppError(400, "Use o mês no formato YYYY-MM.") from exc


def normalize_uppercase_text(value: str) -> str:
    return " ".join(value.split()).upper()
