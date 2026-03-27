from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.entities import MealType, SchoolYear


class MealEntryCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    student_id: str
    meal_type: MealType
    source: str = "manual"
    confidence: float | None = None


class MealEntryResponse(BaseModel):
    id: str
    student_id: str
    student_name: str
    class_id: str
    class_name: str
    class_display_name: str
    school_year: SchoolYear
    meal_type: MealType
    recorded_at: datetime
    recorded_by_user_id: str
    recorded_by_name: str
    source: str
    confidence: float | None
