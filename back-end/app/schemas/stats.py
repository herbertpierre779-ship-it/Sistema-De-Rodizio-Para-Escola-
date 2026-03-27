from __future__ import annotations

from pydantic import BaseModel

from app.schemas.meal_entries import MealEntryResponse


class ChartPoint(BaseModel):
    label: str
    value: int


class RecognitionSummary(BaseModel):
    success: int
    low_confidence: int
    not_found: int


class StatsOverviewResponse(BaseModel):
    total_students: int
    total_classes: int
    total_users: int
    entries_today: int
    entries_last_7_days: int
    lunch_today: int
    snack_today: int
    no_rotation_today: int
    recognition_summary: RecognitionSummary
    recent_entries: list[MealEntryResponse]


class StatsChartsResponse(BaseModel):
    daily_entries: list[ChartPoint]
    meal_breakdown: list[ChartPoint]
    class_breakdown: list[ChartPoint]
    year_breakdown: list[ChartPoint]
    recognition_breakdown: list[ChartPoint]
