from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    diretor = "diretor"
    coordenadora = "coordenadora"
    funcionario = "funcionario"


class SchoolYear(str, Enum):
    primeiro_ano = "1 ano"
    segundo_ano = "2 ano"
    terceiro_ano = "3 ano"


class MealType(str, Enum):
    almoco = "almoco"
    merenda = "merenda"
    sem_rodizio = "sem_rodizio"


class RecognitionStatus(str, Enum):
    success = "success"
    low_confidence = "low_confidence"
    not_found = "not_found"
    no_face_detected = "no_face_detected"
    multiple_faces_detected = "multiple_faces_detected"


class UserRecord(BaseModel):
    id: str
    username: str
    full_name: str
    role: UserRole
    password_hash: str
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class ClassRecord(BaseModel):
    id: str
    name: str
    school_year: SchoolYear
    created_at: datetime
    updated_at: datetime


class StudentRecord(BaseModel):
    id: str
    full_name: str
    class_id: str
    cpf: str | None = None
    photo_path: str | None = None
    photo_right_path: str | None = None
    photo_left_path: str | None = None
    created_at: datetime
    updated_at: datetime


class FaceEmbeddingRecord(BaseModel):
    id: str
    student_id: str
    engine: str
    vector: list[float] = Field(default_factory=list)
    samples_count: int = 1
    source_image_path: str | None = None
    created_at: datetime
    updated_at: datetime


class RecognitionAttemptRecord(BaseModel):
    id: str
    status: RecognitionStatus
    confidence: float | None = None
    student_id: str | None = None
    class_id: str | None = None
    recorded_at: datetime


class MealEntryRecord(BaseModel):
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
    source: str = "manual"
    confidence: float | None = None
