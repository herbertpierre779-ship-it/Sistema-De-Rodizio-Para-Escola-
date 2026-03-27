from __future__ import annotations

from pydantic import BaseModel

from app.models.entities import MealType, RecognitionStatus, SchoolYear


class RecognitionStudentResponse(BaseModel):
    id: str
    full_name: str
    class_id: str
    class_name: str
    class_display_name: str
    school_year: SchoolYear
    photo_url: str | None


class RecognitionIdentifyResponse(BaseModel):
    status: RecognitionStatus
    matched: bool
    confidence: float | None
    threshold: float
    message: str
    meal_type: MealType | None
    already_recorded_today: bool = False
    already_recorded_message: str | None = None
    student: RecognitionStudentResponse | None


class RecognitionIdentifyByCpfRequest(BaseModel):
    cpf: str
    meal_type: MealType
