from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import SchoolYear


class ClassResponse(BaseModel):
    id: str
    name: str
    school_year: SchoolYear
    display_name: str
    student_count: int
    created_at: datetime
    updated_at: datetime


class ClassCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    school_year: SchoolYear
    name: str = Field(min_length=1, max_length=60)


class ClassUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    school_year: SchoolYear
    name: str = Field(min_length=1, max_length=60)
