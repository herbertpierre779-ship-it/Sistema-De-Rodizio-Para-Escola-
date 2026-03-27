from __future__ import annotations

import math
from uuid import uuid4

from app.adapters.face.engine import BaseFaceEngine
from app.core.clock import utc_now
from app.core.config import Settings
from app.core.cpf import is_valid_cpf, normalize_cpf
from app.core.exceptions import AppError
from app.core.media import build_media_url
from app.models.entities import (
    ClassRecord,
    MealType,
    RecognitionAttemptRecord,
    RecognitionStatus,
    SchoolYear,
    StudentRecord,
)
from app.repositories.contracts import (
    ClassRepository,
    FaceEmbeddingRepository,
    RecognitionAttemptRepository,
    StudentRepository,
)
from app.schemas.recognition import RecognitionIdentifyResponse, RecognitionStudentResponse
from app.services.meal_entry_service import MealEntryService


class RecognitionService:
    def __init__(
        self,
        settings: Settings,
        student_repository: StudentRepository,
        class_repository: ClassRepository,
        face_embedding_repository: FaceEmbeddingRepository,
        recognition_attempt_repository: RecognitionAttemptRepository,
        face_engine: BaseFaceEngine,
        meal_entry_service: MealEntryService,
    ) -> None:
        self.settings = settings
        self.student_repository = student_repository
        self.class_repository = class_repository
        self.face_embedding_repository = face_embedding_repository
        self.recognition_attempt_repository = recognition_attempt_repository
        self.face_engine = face_engine
        self.meal_entry_service = meal_entry_service

    def identify(self, image_bytes: bytes, *, meal_type: MealType | None = None) -> RecognitionIdentifyResponse:
        extraction = self.face_engine.extract_embedding(image_bytes)
        if extraction.status in {
            RecognitionStatus.no_face_detected,
            RecognitionStatus.multiple_faces_detected,
        }:
            self._record_attempt(extraction.status, None, None, None)
            return RecognitionIdentifyResponse(
                status=extraction.status,
                matched=False,
                confidence=None,
                threshold=self.settings.recognition_match_threshold,
                message=extraction.message,
                meal_type=meal_type,
                student=None,
            )

        if not extraction.vector:
            self._record_attempt(RecognitionStatus.not_found, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=None,
                threshold=self.settings.recognition_match_threshold,
                message="Não foi possível gerar um embedding para identificação.",
                meal_type=meal_type,
                student=None,
            )

        embeddings = self.face_embedding_repository.list_embeddings()
        best_score = -1.0
        second_best_score = -1.0
        best_student_id: str | None = None

        for embedding in embeddings:
            if not embedding.vector or len(embedding.vector) != len(extraction.vector):
                continue
            score = cosine_similarity(extraction.vector, embedding.vector)
            if score > best_score:
                second_best_score = best_score
                best_score = score
                best_student_id = embedding.student_id
            elif score > second_best_score:
                second_best_score = score

        if best_student_id is None:
            self._record_attempt(RecognitionStatus.not_found, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=None,
                threshold=self.settings.recognition_match_threshold,
                message="Não há embeddings cadastrados para comparação.",
                meal_type=meal_type,
                student=None,
            )

        student = self.student_repository.get_by_id(best_student_id)
        if not student:
            self._record_attempt(RecognitionStatus.not_found, best_score, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=round(best_score, 4),
                threshold=self.settings.recognition_match_threshold,
                message="Correspondência encontrada, mas o aluno não está mais cadastrado.",
                meal_type=meal_type,
                student=None,
            )

        class_record = self.class_repository.get_by_id(student.class_id)
        student_summary = self._to_student_response(student, class_record)
        already_recorded_today = bool(meal_type and self.meal_entry_service.has_entry_today(student.id, meal_type))
        already_recorded_message = (
            self.meal_entry_service.duplicate_message(meal_type) if already_recorded_today and meal_type else None
        )

        rounded_score = round(best_score, 4)
        min_score_gap = max(0.0, self.settings.recognition_min_score_gap)
        score_gap = best_score - second_best_score if second_best_score >= 0 else 1.0
        ambiguous_match = second_best_score >= 0 and score_gap < min_score_gap
        if best_score >= self.settings.recognition_match_threshold and not ambiguous_match:
            self._record_attempt(RecognitionStatus.success, best_score, student, class_record)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.success,
                matched=True,
                confidence=rounded_score,
                threshold=self.settings.recognition_match_threshold,
                message="Aluno identificado com confiança suficiente.",
                meal_type=meal_type,
                already_recorded_today=already_recorded_today,
                already_recorded_message=already_recorded_message,
                student=student_summary,
            )

        if best_score >= self.settings.recognition_low_confidence_threshold:
            self._record_attempt(RecognitionStatus.low_confidence, best_score, student, class_record)
            low_confidence_message = (
                "Foi encontrada uma correspondência, mas existem alunos com pontuação muito próxima."
                if ambiguous_match
                else "Foi encontrada uma correspondência, mas a confiança ficou baixa."
            )
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.low_confidence,
                matched=False,
                confidence=rounded_score,
                threshold=self.settings.recognition_match_threshold,
                message=low_confidence_message,
                meal_type=meal_type,
                already_recorded_today=already_recorded_today,
                already_recorded_message=already_recorded_message,
                student=student_summary,
            )

        self._record_attempt(RecognitionStatus.not_found, best_score, student, class_record)
        return RecognitionIdentifyResponse(
            status=RecognitionStatus.not_found,
            matched=False,
            confidence=rounded_score,
            threshold=self.settings.recognition_match_threshold,
            message="Nenhum aluno atingiu a confiança mínima de identificação.",
            meal_type=meal_type,
            student=None,
        )

    def identify_by_cpf(self, cpf: str, *, meal_type: MealType) -> RecognitionIdentifyResponse:
        normalized_cpf = normalize_cpf(cpf)
        if not is_valid_cpf(normalized_cpf):
            raise AppError(400, "CPF inválido. Informe um CPF válido com 11 dígitos.")

        student = self.student_repository.get_by_cpf(normalized_cpf)
        if not student:
            self._record_attempt(RecognitionStatus.not_found, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=None,
                threshold=self.settings.recognition_match_threshold,
                message="Aluno com esse CPF não foi encontrado.",
                meal_type=meal_type,
                student=None,
            )

        class_record = self.class_repository.get_by_id(student.class_id)
        student_summary = self._to_student_response(student, class_record)
        already_recorded_today = self.meal_entry_service.has_entry_today(student.id, meal_type)
        already_recorded_message = (
            self.meal_entry_service.duplicate_message(meal_type) if already_recorded_today else None
        )

        self._record_attempt(RecognitionStatus.low_confidence, None, student, class_record)
        return RecognitionIdentifyResponse(
            status=RecognitionStatus.low_confidence,
            matched=True,
            confidence=None,
            threshold=self.settings.recognition_match_threshold,
            message="Aluno localizado por CPF. Conferência manual obrigatória.",
            meal_type=meal_type,
            already_recorded_today=already_recorded_today,
            already_recorded_message=already_recorded_message,
            student=student_summary,
        )

    def _to_student_response(
        self,
        student: StudentRecord,
        class_record: ClassRecord | None,
    ) -> RecognitionStudentResponse:
        class_name = class_record.name if class_record else "Turma removida"
        school_year = class_record.school_year if class_record else SchoolYear.primeiro_ano
        return RecognitionStudentResponse(
            id=student.id,
            full_name=student.full_name,
            class_id=student.class_id,
            class_name=class_name,
            class_display_name=f"{school_year.value} - {class_name}",
            school_year=school_year,
            photo_url=build_media_url(student.photo_path),
        )

    def _record_attempt(
        self,
        status: RecognitionStatus,
        confidence: float | None,
        student: StudentRecord | None,
        class_record: ClassRecord | None,
    ) -> None:
        self.recognition_attempt_repository.create(
            RecognitionAttemptRecord(
                id=uuid4().hex,
                status=status,
                confidence=round(confidence, 4) if confidence is not None else None,
                student_id=student.id if student else None,
                class_id=class_record.id if class_record else None,
                recorded_at=utc_now(),
            )
        )


def cosine_similarity(left: list[float], right: list[float]) -> float:
    numerator = sum(left_item * right_item for left_item, right_item in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(1.0, numerator / (left_norm * right_norm)))
