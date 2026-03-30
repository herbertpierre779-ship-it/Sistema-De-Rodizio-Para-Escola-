from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import MealType, SchoolYear
from app.schemas.meal_entries import MealEntryResponse
from app.schemas.settings import RegistrationCaptureMode


class StudentResponse(BaseModel):
    id: str
    full_name: str
    class_id: str
    class_name: str
    class_display_name: str
    school_year: SchoolYear
    photo_url: str | None
    has_face_enrolled: bool
    created_at: datetime
    updated_at: datetime


class StudentCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=3, max_length=120)
    class_id: str = Field(min_length=1)
    cpf: str = Field(min_length=11, max_length=14)


class StudentUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=3, max_length=120)
    class_id: str | None = Field(default=None, min_length=1)
    cpf: str | None = Field(default=None, min_length=11, max_length=14)


class FaceEnrollResponse(BaseModel):
    student: StudentResponse
    engine: str
    enrolled_at: datetime


class StudentFaceAssetItem(BaseModel):
    filename: str
    url: str


class StudentFaceAssetsResponse(BaseModel):
    student_id: str
    full_name: str
    cpf: str
    class_id: str
    school_year: SchoolYear
    mode_hint: RegistrationCaptureMode
    samples_count: int
    front_url: str | None
    right_url: str | None
    left_url: str | None
    sample_urls: list[StudentFaceAssetItem]


class AttendanceTotalsResponse(BaseModel):
    almoco: int
    merenda: int
    sem_rodizio: int


class AttendanceCalendarDayResponse(BaseModel):
    date: str
    meal_types: list[MealType]


class StudentAttendanceSummaryResponse(BaseModel):
    student: StudentResponse
    month: str
    attendance_days: int
    totals_by_meal: AttendanceTotalsResponse
    calendar_days: list[AttendanceCalendarDayResponse]
    recent_entries: list[MealEntryResponse]
