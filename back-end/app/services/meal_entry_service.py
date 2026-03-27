from __future__ import annotations

from datetime import date
from uuid import uuid4

from app.core.clock import school_today, to_school_datetime, utc_now
from app.core.config import Settings
from app.core.exceptions import AppError
from app.models.entities import MealEntryRecord, MealType, UserRecord
from app.repositories.contracts import ClassRepository, MealEntryFilters, MealEntryRepository, StudentRepository
from app.schemas.meal_entries import MealEntryCreateRequest, MealEntryResponse


class MealEntryService:
    def __init__(
        self,
        settings: Settings,
        meal_entry_repository: MealEntryRepository,
        student_repository: StudentRepository,
        class_repository: ClassRepository,
    ) -> None:
        self.settings = settings
        self.meal_entry_repository = meal_entry_repository
        self.student_repository = student_repository
        self.class_repository = class_repository

    def create_entry(self, payload: MealEntryCreateRequest, *, current_user: UserRecord) -> MealEntryResponse:
        student = self.student_repository.get_by_id(payload.student_id)
        if not student:
            raise AppError(404, "Aluno não encontrado.")
        class_record = self.class_repository.get_by_id(student.class_id)
        if not class_record:
            raise AppError(404, "Turma do aluno não encontrada.")

        existing_today = self._get_today_entry(payload.student_id, payload.meal_type)
        if existing_today:
            if payload.meal_type == MealType.sem_rodizio:
                # Sem rodizio aceita nova validacao no dia, sem nova contagem.
                return self.to_response(existing_today)
            raise AppError(409, self.duplicate_message(payload.meal_type))

        record = MealEntryRecord(
            id=uuid4().hex,
            student_id=student.id,
            student_name=student.full_name,
            class_id=class_record.id,
            class_name=class_record.name,
            class_display_name=f"{class_record.school_year.value} - {class_record.name}",
            school_year=class_record.school_year,
            meal_type=payload.meal_type,
            recorded_at=utc_now(),
            recorded_by_user_id=current_user.id,
            recorded_by_name=current_user.full_name,
            source=payload.source,
            confidence=payload.confidence,
        )
        return self.to_response(self.meal_entry_repository.create(record))

    def has_entry_today(self, student_id: str, meal_type: MealType) -> bool:
        return self._get_today_entry(student_id, meal_type) is not None

    @staticmethod
    def duplicate_message(meal_type: MealType) -> str:
        meal_label = {
            MealType.almoco: "almoço",
            MealType.merenda: "merenda",
            MealType.sem_rodizio: "sem rodízio",
        }[meal_type]
        return f"Esse aluno já recebeu {meal_label} hoje."

    def list_entries(
        self,
        *,
        date_value: str | None = None,
        class_id: str | None = None,
        student_id: str | None = None,
        meal_type: MealType | None = None,
    ) -> list[MealEntryResponse]:
        parsed_date = None
        if date_value:
            try:
                parsed_date = date.fromisoformat(date_value)
            except ValueError as exc:
                raise AppError(400, "Use a data no formato YYYY-MM-DD.") from exc

        entries = self.meal_entry_repository.list_entries(
            MealEntryFilters(class_id=class_id, student_id=student_id, meal_type=meal_type)
        )
        if parsed_date:
            entries = [
                entry for entry in entries if to_school_datetime(self.settings, entry.recorded_at).date() == parsed_date
            ]
        return [self.to_response(entry) for entry in entries]

    def _get_today_entry(self, student_id: str, meal_type: MealType) -> MealEntryRecord | None:
        today = school_today(self.settings)
        existing_entries = self.meal_entry_repository.list_entries(
            MealEntryFilters(student_id=student_id, meal_type=meal_type)
        )
        for entry in existing_entries:
            if to_school_datetime(self.settings, entry.recorded_at).date() == today:
                return entry
        return None

    @staticmethod
    def to_response(entry: MealEntryRecord) -> MealEntryResponse:
        return MealEntryResponse(
            id=entry.id,
            student_id=entry.student_id,
            student_name=entry.student_name,
            class_id=entry.class_id,
            class_name=entry.class_name,
            class_display_name=entry.class_display_name,
            school_year=entry.school_year,
            meal_type=entry.meal_type,
            recorded_at=entry.recorded_at,
            recorded_by_user_id=entry.recorded_by_user_id,
            recorded_by_name=entry.recorded_by_name,
            source=entry.source,
            confidence=entry.confidence,
        )
