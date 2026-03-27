from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from app.adapters.face.engine import BaseFaceEngine
from app.core.clock import school_today, to_school_datetime
from app.core.config import Settings
from app.core.cpf import is_valid_cpf, normalize_cpf
from app.core.exceptions import AppError
from app.core.media import PhotoPose, build_media_url, build_photo_relative_path
from app.models.entities import ClassRecord, FaceEmbeddingRecord, MealType, RecognitionStatus, StudentRecord
from app.repositories.contracts import (
    ClassRepository,
    FaceEmbeddingRepository,
    MealEntryFilters,
    MealEntryRepository,
    RecognitionAttemptRepository,
    StudentRepository,
)
from app.schemas.students import (
    AttendanceCalendarDayResponse,
    AttendanceTotalsResponse,
    FaceEnrollResponse,
    StudentAttendanceSummaryResponse,
    StudentCreateRequest,
    StudentResponse,
    StudentUpdateRequest,
)
from app.services.meal_entry_service import MealEntryService

CapturePose = Literal["front", "right", "left", "unknown"]


class StudentService:
    def __init__(
        self,
        settings: Settings,
        student_repository: StudentRepository,
        class_repository: ClassRepository,
        face_embedding_repository: FaceEmbeddingRepository,
        meal_entry_repository: MealEntryRepository,
        recognition_attempt_repository: RecognitionAttemptRepository,
        face_engine: BaseFaceEngine,
    ) -> None:
        self.settings = settings
        self.student_repository = student_repository
        self.class_repository = class_repository
        self.face_embedding_repository = face_embedding_repository
        self.meal_entry_repository = meal_entry_repository
        self.recognition_attempt_repository = recognition_attempt_repository
        self.face_engine = face_engine

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
        now = datetime.now(UTC)
        student = StudentRecord(
            id=uuid4().hex,
            full_name=normalize_uppercase_text(payload.full_name),
            class_id=payload.class_id,
            cpf=normalized_cpf,
            created_at=now,
            updated_at=now,
        )
        return self.to_response(self.student_repository.create(student))

    def update_student(self, student_id: str, payload: StudentUpdateRequest) -> StudentResponse:
        student = self.get_student_record(student_id)
        current_class = self._ensure_class_exists(student.class_id)
        next_class_id = payload.class_id or student.class_id
        next_class = self._ensure_class_exists(next_class_id)
        next_cpf = student.cpf
        if payload.cpf is not None:
            normalized_cpf = self._normalize_and_validate_cpf(payload.cpf)
            existing_with_cpf = self.student_repository.get_by_cpf(normalized_cpf)
            if existing_with_cpf and existing_with_cpf.id != student.id:
                raise AppError(409, "Já existe um aluno cadastrado com esse CPF.")
            next_cpf = normalized_cpf

        updated = student.model_copy(
            update={
                "full_name": normalize_uppercase_text(payload.full_name) if payload.full_name else student.full_name,
                "class_id": next_class_id,
                "cpf": next_cpf,
                "updated_at": datetime.now(UTC),
            }
        )
        persisted = self.student_repository.update(updated)
        if current_class.id != next_class.id:
            persisted = self._move_student_media_if_needed(persisted, next_class)
        return self.to_response(persisted)

    def delete_student(self, student_id: str) -> None:
        student = self.get_student_record(student_id)
        self.face_embedding_repository.delete_by_student_id(student_id)
        self.meal_entry_repository.delete_by_student_id(student_id)
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
        extraction = self.face_engine.extract_embedding(image_bytes)
        if extraction.status != RecognitionStatus.success or not extraction.vector:
            raise AppError(400, extraction.message)

        now = datetime.now(UTC)
        existing_embedding = self.face_embedding_repository.get_by_student_id(student_id)
        capture_pose = self._resolve_capture_pose(filename)
        student_updates: dict[str, object] = {}
        source_image_path = student.photo_path

        if capture_pose == "front":
            front_path = self._save_photo(student_id, image_bytes, pose="front")
            student_updates["photo_path"] = front_path
            source_image_path = front_path
        elif capture_pose == "right":
            right_path = self._save_photo(student_id, image_bytes, pose="right")
            student_updates["photo_right_path"] = right_path
            source_image_path = right_path
            if not student.photo_path:
                student_updates["photo_path"] = self._save_photo(student_id, image_bytes, pose="front")
        elif capture_pose == "left":
            left_path = self._save_photo(student_id, image_bytes, pose="left")
            student_updates["photo_left_path"] = left_path
            source_image_path = left_path
            if not student.photo_path:
                student_updates["photo_path"] = self._save_photo(student_id, image_bytes, pose="front")
        elif not student.photo_path:
            fallback_front_path = self._save_photo(student_id, image_bytes, pose="front")
            student_updates["photo_path"] = fallback_front_path
            source_image_path = fallback_front_path

        if student_updates:
            student_updates["updated_at"] = now
            updated_student = self.student_repository.update(student.model_copy(update=student_updates))
        else:
            updated_student = student

        source_image_path = source_image_path or updated_student.photo_path

        averaged_vector = extraction.vector
        next_samples_count = 1
        if existing_embedding and existing_embedding.vector and len(existing_embedding.vector) == len(extraction.vector):
            previous_samples = max(existing_embedding.samples_count, 1)
            total_samples = previous_samples + 1
            averaged_vector = [
                ((existing_embedding.vector[index] * previous_samples) + extraction.vector[index]) / total_samples
                for index in range(len(extraction.vector))
            ]
            next_samples_count = total_samples
        elif existing_embedding:
            next_samples_count = max(existing_embedding.samples_count, 1) + 1

        embedding = FaceEmbeddingRecord(
            id=existing_embedding.id if existing_embedding else uuid4().hex,
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
        return self._move_student_media_if_needed(student, class_record)

    def _ensure_class_exists(self, class_id: str) -> ClassRecord:
        class_record = self.class_repository.get_by_id(class_id)
        if not class_record:
            raise AppError(404, "Turma não encontrada.")
        return class_record

    def _save_photo(
        self,
        student_id: str,
        image_bytes: bytes,
        *,
        pose: PhotoPose,
    ) -> str:
        class_record = self._ensure_class_exists(self.get_student_record(student_id).class_id)
        relative_path = build_photo_relative_path(class_record, student_id, ".jpg", pose=pose)
        absolute_path = self.settings.photos_root_path / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(image_bytes)
        return relative_path

    def _delete_photo(self, relative_path: str | None) -> None:
        if not relative_path:
            return
        absolute_path = self.settings.photos_root_path / relative_path
        if absolute_path.exists():
            absolute_path.unlink()

    def _move_student_media_if_needed(self, student: StudentRecord, class_record: ClassRecord) -> StudentRecord:
        if not any((student.photo_path, student.photo_right_path, student.photo_left_path)):
            return student

        previous_paths = {
            "photo_path": student.photo_path,
            "photo_right_path": student.photo_right_path,
            "photo_left_path": student.photo_left_path,
        }
        next_paths = {
            "photo_path": self._move_photo_for_class(student.id, student.photo_path, class_record, pose="front"),
            "photo_right_path": self._move_photo_for_class(
                student.id, student.photo_right_path, class_record, pose="right"
            ),
            "photo_left_path": self._move_photo_for_class(student.id, student.photo_left_path, class_record, pose="left"),
        }

        student_updates = {
            field_name: next_value
            for field_name, next_value in next_paths.items()
            if next_value != previous_paths[field_name]
        }
        if not student_updates:
            return student

        moved_path_map = {
            previous_paths[field_name]: next_value
            for field_name, next_value in student_updates.items()
            if previous_paths[field_name]
        }

        student_updates["updated_at"] = datetime.now(UTC)
        updated_student = self.student_repository.update(student.model_copy(update=student_updates))
        existing_embedding = self.face_embedding_repository.get_by_student_id(student.id)
        if (
            existing_embedding
            and existing_embedding.source_image_path
            and existing_embedding.source_image_path in moved_path_map
        ):
            self.face_embedding_repository.upsert(
                existing_embedding.model_copy(
                    update={
                        "source_image_path": moved_path_map[existing_embedding.source_image_path],
                        "updated_at": datetime.now(UTC),
                    }
                )
            )
        return updated_student

    @staticmethod
    def _resolve_capture_pose(filename: str | None) -> CapturePose:
        if not filename:
            return "unknown"

        normalized_name = Path(filename).stem.casefold()
        if any(token in normalized_name for token in ("right", "direita")):
            return "right"
        if any(token in normalized_name for token in ("left", "esquerda")):
            return "left"
        if any(token in normalized_name for token in ("front", "frente", "principal", "main")):
            return "front"
        return "unknown"

    def _move_photo_for_class(
        self,
        student_id: str,
        current_relative_path: str | None,
        class_record: ClassRecord,
        *,
        pose: PhotoPose,
    ) -> str | None:
        if not current_relative_path:
            return None

        current_absolute_path = self.settings.photos_root_path / current_relative_path
        extension = Path(current_relative_path).suffix.lower() or ".jpg"
        next_relative_path = build_photo_relative_path(class_record, student_id, extension, pose=pose)
        if next_relative_path == current_relative_path:
            return current_relative_path
        if not current_absolute_path.exists():
            return current_relative_path

        next_absolute_path = self.settings.photos_root_path / next_relative_path
        next_absolute_path.parent.mkdir(parents=True, exist_ok=True)
        if next_absolute_path.exists() and next_absolute_path != current_absolute_path:
            next_absolute_path.unlink()
        current_absolute_path.replace(next_absolute_path)
        return next_relative_path

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
