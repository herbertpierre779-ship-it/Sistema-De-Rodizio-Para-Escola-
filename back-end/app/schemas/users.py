from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import UserRole


class UserResponse(BaseModel):
    id: str
    username: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(min_length=3, max_length=50)
    full_name: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=3, max_length=128)
    role: UserRole
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=3, max_length=120)
    password: str | None = Field(default=None, min_length=3, max_length=128)
    role: UserRole | None = None
    is_active: bool | None = None
