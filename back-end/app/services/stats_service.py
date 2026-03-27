from __future__ import annotations

from collections import Counter
from datetime import timedelta

from app.core.clock import school_today, to_school_datetime
from app.core.config import Settings
from app.models.entities import MealType, RecognitionStatus
from app.repositories.contracts import (
    ClassRepository,
    MealEntryRepository,
    RecognitionAttemptRepository,
    StudentRepository,
    UserRepository,
)
from app.schemas.stats import ChartPoint, RecognitionSummary, StatsChartsResponse, StatsOverviewResponse
from app.services.meal_entry_service import MealEntryService


class StatsService:
    def __init__(
        self,
        settings: Settings,
        user_repository: UserRepository,
        class_repository: ClassRepository,
        student_repository: StudentRepository,
        meal_entry_repository: MealEntryRepository,
        recognition_attempt_repository: RecognitionAttemptRepository,
        meal_entry_service: MealEntryService,
    ) -> None:
        self.settings = settings
        self.user_repository = user_repository
        self.class_repository = class_repository
        self.student_repository = student_repository
        self.meal_entry_repository = meal_entry_repository
        self.recognition_attempt_repository = recognition_attempt_repository
        self.meal_entry_service = meal_entry_service

    def overview(self) -> StatsOverviewResponse:
        today = school_today(self.settings)
        all_entries = self.meal_entry_repository.list_entries()
        today_entries = [
            entry for entry in all_entries if to_school_datetime(self.settings, entry.recorded_at).date() == today
        ]
        entries_last_7_days = self._entries_in_last_days(all_entries, 7)
        recognition_summary = self._recognition_summary(self._attempts_in_last_days(7))

        return StatsOverviewResponse(
            total_students=len(self.student_repository.list_students()),
            total_classes=len(self.class_repository.list_classes()),
            total_users=len(self.user_repository.list_users()),
            entries_today=len(today_entries),
            entries_last_7_days=len(entries_last_7_days),
            lunch_today=sum(1 for entry in today_entries if entry.meal_type == MealType.almoco),
            snack_today=sum(1 for entry in today_entries if entry.meal_type == MealType.merenda),
            no_rotation_today=sum(1 for entry in today_entries if entry.meal_type == MealType.sem_rodizio),
            recognition_summary=recognition_summary,
            recent_entries=[self.meal_entry_service.to_response(entry) for entry in all_entries[:8]],
        )

    def charts(self, *, meal_type: MealType | None = None) -> StatsChartsResponse:
        weekly_entries = self._entries_in_last_days(self.meal_entry_repository.list_entries(), 7)
        if meal_type is not None:
            weekly_entries = [entry for entry in weekly_entries if entry.meal_type == meal_type]
        weekly_attempts = self._attempts_in_last_days(7)
        daily_entries = self._daily_entries(weekly_entries)
        meal_breakdown_counter = Counter(entry.meal_type.value for entry in weekly_entries)
        class_breakdown_counter = Counter(entry.class_display_name for entry in weekly_entries)
        year_breakdown_counter = Counter(entry.school_year.value for entry in weekly_entries)
        recognition_breakdown_counter = self._recognition_counter(weekly_attempts)

        return StatsChartsResponse(
            daily_entries=daily_entries,
            meal_breakdown=[
                ChartPoint(label="Almoço", value=meal_breakdown_counter.get(MealType.almoco.value, 0)),
                ChartPoint(label="Merenda", value=meal_breakdown_counter.get(MealType.merenda.value, 0)),
                ChartPoint(label="Sem rodízio", value=meal_breakdown_counter.get(MealType.sem_rodizio.value, 0)),
            ],
            class_breakdown=[
                ChartPoint(label=label, value=value)
                for label, value in class_breakdown_counter.most_common(8)
            ],
            year_breakdown=[
                ChartPoint(label=label, value=value)
                for label, value in year_breakdown_counter.most_common()
            ],
            recognition_breakdown=[
                ChartPoint(label="Sucesso", value=recognition_breakdown_counter["success"]),
                ChartPoint(label="Baixa confiança", value=recognition_breakdown_counter["low_confidence"]),
                ChartPoint(label="Não encontrado", value=recognition_breakdown_counter["not_found"]),
            ],
        )

    def _daily_entries(self, entries) -> list[ChartPoint]:
        today = school_today(self.settings)
        points: list[ChartPoint] = []
        for days_ago in range(6, -1, -1):
            current_day = today - timedelta(days=days_ago)
            count = sum(
                1
                for entry in entries
                if to_school_datetime(self.settings, entry.recorded_at).date() == current_day
            )
            points.append(ChartPoint(label=current_day.strftime("%d/%m"), value=count))
        return points

    def _entries_in_last_days(self, entries, days: int):
        today = school_today(self.settings)
        start_day = today - timedelta(days=days - 1)
        return [
            entry
            for entry in entries
            if start_day <= to_school_datetime(self.settings, entry.recorded_at).date() <= today
        ]

    def _attempts_in_last_days(self, days: int):
        today = school_today(self.settings)
        start_day = today - timedelta(days=days - 1)
        return [
            attempt
            for attempt in self.recognition_attempt_repository.list_attempts()
            if start_day <= to_school_datetime(self.settings, attempt.recorded_at).date() <= today
        ]

    def _recognition_summary(self, attempts) -> RecognitionSummary:
        counter = self._recognition_counter(attempts)
        return RecognitionSummary(
            success=counter["success"],
            low_confidence=counter["low_confidence"],
            not_found=counter["not_found"],
        )

    @staticmethod
    def _recognition_counter(attempts):
        counter = Counter({"success": 0, "low_confidence": 0, "not_found": 0})
        for attempt in attempts:
            if attempt.status == RecognitionStatus.success:
                counter["success"] += 1
            elif attempt.status == RecognitionStatus.low_confidence:
                counter["low_confidence"] += 1
            else:
                counter["not_found"] += 1
        return counter
