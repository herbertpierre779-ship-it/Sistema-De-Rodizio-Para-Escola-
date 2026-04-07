from __future__ import annotations

import logging
import math

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
    UserRecord,
)
from app.repositories.contracts import (
    ClassRepository,
    FaceEmbeddingRepository,
    FaceEmbeddingSampleRepository,
    RecognitionAttemptRepository,
    StudentRepository,
)
from app.schemas.recognition import RecognitionIdentifyResponse, RecognitionStudentResponse
from app.services.app_settings_service import AppSettingsService
from app.services.meal_entry_service import MealEntryService

logger = logging.getLogger(__name__)


class RecognitionService:
    def __init__(
        self,
        settings: Settings,
        student_repository: StudentRepository,
        class_repository: ClassRepository,
        face_embedding_repository: FaceEmbeddingRepository,
        face_embedding_sample_repository: FaceEmbeddingSampleRepository,
        recognition_attempt_repository: RecognitionAttemptRepository,
        face_engine: BaseFaceEngine,
        app_settings_service: AppSettingsService,
        meal_entry_service: MealEntryService,
    ) -> None:
        self.settings = settings
        self.student_repository = student_repository
        self.class_repository = class_repository
        self.face_embedding_repository = face_embedding_repository
        self.face_embedding_sample_repository = face_embedding_sample_repository
        self.recognition_attempt_repository = recognition_attempt_repository
        self.face_engine = face_engine
        self.app_settings_service = app_settings_service
        self.meal_entry_service = meal_entry_service

    def identify(
        self,
        image_bytes: bytes,
        *,
        meal_type: MealType | None = None,
        current_user: UserRecord,
    ) -> RecognitionIdentifyResponse:
        profile_name = self._profile_name()
        match_threshold = self._match_threshold(profile_name)
        low_confidence_threshold = self._low_confidence_threshold(profile_name)
        candidate_top_k = self._candidate_top_k(profile_name)
        sample_window = self._sample_window(profile_name)
        max_weight, mean_weight = self._sample_weights(profile_name)
        use_score_gap = self._use_score_gap(profile_name)
        min_score_gap = self._min_score_gap(profile_name)

        if meal_type and not self.app_settings_service.is_meal_available_for_role(meal_type, current_user.role):
            raise AppError(403, self.app_settings_service.unavailable_meal_message(meal_type))

        try:
            extraction = self.face_engine.extract_embedding(image_bytes)
        except Exception:
            logger.exception("Falha inesperada ao extrair embedding facial.")
            self._record_attempt(RecognitionStatus.no_face_detected, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.no_face_detected,
                matched=False,
                confidence=None,
                threshold=match_threshold,
                message="Falha temporaria ao analisar o rosto. Tente novamente.",
                meal_type=meal_type,
                student=None,
            )
        if extraction.status in {
            RecognitionStatus.no_face_detected,
            RecognitionStatus.multiple_faces_detected,
        }:
            self._record_attempt(extraction.status, None, None, None)
            return RecognitionIdentifyResponse(
                status=extraction.status,
                matched=False,
                confidence=None,
                threshold=match_threshold,
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
                threshold=match_threshold,
                message="Nao foi possivel gerar um embedding para identificacao.",
                meal_type=meal_type,
                student=None,
            )

        best_score = -1.0
        second_best_score = -1.0
        best_student_id: str | None = None
        candidate_scores: dict[str, float] = {}

        if self._is_naogazei_like(profile_name):
            # Perfil agressivo: preserva centroides (legado) e refina com amostras dos Top-K candidatos.
            centroid_scores = self._centroid_scores(extraction.vector)
            candidate_scores = centroid_scores.copy()

            if centroid_scores:
                ranked_ids = [
                    student_id
                    for student_id, _ in sorted(
                        centroid_scores.items(),
                        key=lambda item: item[1],
                        reverse=True,
                    )[:candidate_top_k]
                ]
            else:
                ranked_ids = [student.id for student in self.student_repository.list_students()]

            if ranked_ids:
                sample_records = self.face_embedding_sample_repository.list_by_student_ids(ranked_ids)
                preferred_engine = self.face_engine.engine_name
                preferred_scores: dict[str, list[float]] = {}
                fallback_scores: dict[str, list[float]] = {}

                for sample in sample_records:
                    if not sample.vector or len(sample.vector) != len(extraction.vector):
                        continue
                    similarity = cosine_similarity(extraction.vector, sample.vector)
                    target = preferred_scores if sample.engine == preferred_engine else fallback_scores
                    target.setdefault(sample.student_id, []).append(similarity)

                for student_id in ranked_ids:
                    sample_scores = preferred_scores.get(student_id) or fallback_scores.get(student_id)
                    if not sample_scores:
                        continue
                    refined_score = combine_sample_scores(
                        sample_scores,
                        top_window=sample_window,
                        max_weight=max_weight,
                        mean_weight=mean_weight,
                    )
                    current = candidate_scores.get(student_id, -1.0)
                    if refined_score > current:
                        candidate_scores[student_id] = refined_score
        else:
            centroid_scores = self._centroid_scores(extraction.vector)
            candidate_scores = centroid_scores.copy()

            if centroid_scores:
                ranked_ids = [
                    student_id
                    for student_id, _ in sorted(
                        centroid_scores.items(),
                        key=lambda item: item[1],
                        reverse=True,
                    )[:candidate_top_k]
                ]
                sample_records = self.face_embedding_sample_repository.list_by_student_ids(ranked_ids)
                per_student_scores: dict[str, list[float]] = {}
                for sample in sample_records:
                    if not sample.vector or len(sample.vector) != len(extraction.vector):
                        continue
                    similarity = cosine_similarity(extraction.vector, sample.vector)
                    per_student_scores.setdefault(sample.student_id, []).append(similarity)

                for student_id, scores in per_student_scores.items():
                    refined_score = combine_sample_scores(
                        scores,
                        top_window=sample_window,
                        max_weight=max_weight,
                        mean_weight=mean_weight,
                    )
                    current = candidate_scores.get(student_id, -1.0)
                    if refined_score > current:
                        candidate_scores[student_id] = refined_score

        if candidate_scores:
            ordered_candidates = sorted(candidate_scores.items(), key=lambda item: item[1], reverse=True)
            best_student_id, best_score = ordered_candidates[0]
            second_best_score = ordered_candidates[1][1] if len(ordered_candidates) > 1 else -1.0

        if best_student_id is None:
            self._record_attempt(RecognitionStatus.not_found, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=None,
                threshold=match_threshold,
                message="Nao ha embeddings cadastrados para comparacao.",
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
                threshold=match_threshold,
                message="Correspondencia encontrada, mas o aluno nao esta mais cadastrado.",
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
        score_gap = best_score - second_best_score if second_best_score >= 0 else 1.0
        ambiguous_match = use_score_gap and second_best_score >= 0 and score_gap < min_score_gap
        if best_score >= match_threshold and not ambiguous_match:
            self._record_attempt(RecognitionStatus.success, best_score, student, class_record)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.success,
                matched=True,
                confidence=rounded_score,
                threshold=match_threshold,
                message="Aluno identificado com confianca suficiente.",
                meal_type=meal_type,
                already_recorded_today=already_recorded_today,
                already_recorded_message=already_recorded_message,
                student=student_summary,
            )

        if best_score >= low_confidence_threshold:
            self._record_attempt(RecognitionStatus.low_confidence, best_score, student, class_record)
            low_confidence_message = (
                "Foi encontrada uma correspondencia, mas existem alunos com pontuacao muito proxima."
                if ambiguous_match
                else "Foi encontrada uma correspondencia, mas a confianca ficou baixa."
            )
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.low_confidence,
                matched=False,
                confidence=rounded_score,
                threshold=match_threshold,
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
            threshold=match_threshold,
            message="Nenhum aluno atingiu a confianca minima de identificacao.",
            meal_type=meal_type,
            student=None,
        )

    def identify_by_cpf(
        self,
        cpf: str,
        *,
        meal_type: MealType,
        current_user: UserRecord,
    ) -> RecognitionIdentifyResponse:
        match_threshold = self._match_threshold(self._profile_name())
        if not self.app_settings_service.is_meal_available_for_role(meal_type, current_user.role):
            raise AppError(403, self.app_settings_service.unavailable_meal_message(meal_type))
        normalized_cpf = normalize_cpf(cpf)
        if not is_valid_cpf(normalized_cpf):
            raise AppError(400, "CPF invalido. Informe um CPF valido com 11 digitos.")

        student = self.student_repository.get_by_cpf(normalized_cpf)
        if not student:
            self._record_attempt(RecognitionStatus.not_found, None, None, None)
            return RecognitionIdentifyResponse(
                status=RecognitionStatus.not_found,
                matched=False,
                confidence=None,
                threshold=match_threshold,
                message="Aluno com esse CPF nao foi encontrado.",
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
            threshold=match_threshold,
            message="Aluno localizado por CPF. Conferencia manual obrigatoria.",
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
                status=status,
                confidence=round(confidence, 4) if confidence is not None else None,
                student_id=student.id if student else None,
                class_id=class_record.id if class_record else None,
                recorded_at=utc_now(),
            )
        )

    def _profile_name(self) -> str:
        value = str(self.settings.recognition_profile).strip().casefold()
        return value or "default"

    @staticmethod
    def _is_naogazei_like(profile_name: str) -> bool:
        return profile_name in {"naogazei_like", "naogazei", "aggressive"}

    def _match_threshold(self, profile_name: str) -> float:
        if self._is_naogazei_like(profile_name):
            return _clamp(float(self.settings.recognition_naogazei_match_threshold), 0.0, 1.0)
        return _clamp(float(self.settings.recognition_match_threshold), 0.0, 1.0)

    def _low_confidence_threshold(self, profile_name: str) -> float:
        if self._is_naogazei_like(profile_name):
            return _clamp(float(self.settings.recognition_naogazei_low_confidence_threshold), 0.0, 1.0)
        return _clamp(float(self.settings.recognition_low_confidence_threshold), 0.0, 1.0)

    def _candidate_top_k(self, profile_name: str) -> int:
        if self._is_naogazei_like(profile_name):
            return max(12, int(self.settings.recognition_naogazei_candidate_top_k))
        return 12

    def _sample_window(self, profile_name: str) -> int:
        if self._is_naogazei_like(profile_name):
            return max(3, int(self.settings.recognition_naogazei_top_samples_window))
        return 3

    def _sample_weights(self, profile_name: str) -> tuple[float, float]:
        if self._is_naogazei_like(profile_name):
            max_weight = _clamp(float(self.settings.recognition_naogazei_score_max_weight), 0.0, 1.0)
            mean_weight = _clamp(float(self.settings.recognition_naogazei_score_mean_weight), 0.0, 1.0)
            total = max_weight + mean_weight
            if total <= 0:
                return (1.0, 0.0)
            return (max_weight / total, mean_weight / total)
        return (0.65, 0.35)

    def _use_score_gap(self, profile_name: str) -> bool:
        return not self._is_naogazei_like(profile_name)

    def _min_score_gap(self, profile_name: str) -> float:
        if self._is_naogazei_like(profile_name):
            return 0.0
        return max(0.0, float(self.settings.recognition_min_score_gap))

    def _centroid_scores(self, query_vector: list[float]) -> dict[str, float]:
        preferred_scores: dict[str, float] = {}
        fallback_scores: dict[str, float] = {}
        preferred_engine = self.face_engine.engine_name
        for embedding in self.face_embedding_repository.list_embeddings():
            if not embedding.vector or len(embedding.vector) != len(query_vector):
                continue
            similarity = cosine_similarity(query_vector, embedding.vector)
            bucket = preferred_scores if embedding.engine == preferred_engine else fallback_scores
            current = bucket.get(embedding.student_id)
            if current is None or similarity > current:
                bucket[embedding.student_id] = similarity
        if preferred_scores:
            merged = fallback_scores.copy()
            merged.update(preferred_scores)
            return merged
        return fallback_scores


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def cosine_similarity(left: list[float], right: list[float]) -> float:
    numerator = sum(left_item * right_item for left_item, right_item in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(1.0, numerator / (left_norm * right_norm)))


def combine_sample_scores(
    scores: list[float],
    *,
    top_window: int,
    max_weight: float,
    mean_weight: float,
) -> float:
    if not scores:
        return 0.0
    ranked = sorted(scores, reverse=True)
    top_max = ranked[0]
    window_size = max(1, min(top_window, len(ranked)))
    top_mean_window = ranked[:window_size]
    mean_top = sum(top_mean_window) / float(len(top_mean_window))
    return max(0.0, min(1.0, (top_max * max_weight) + (mean_top * mean_weight)))
