from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_container, get_current_user
from app.core.container import AppContainer
from app.models.entities import UserRecord
from app.schemas.auth import AuthUserResponse, LoginRequest, LoginResponse


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, container: AppContainer = Depends(get_container)) -> LoginResponse:
    return container.auth_service.login(payload)


@router.get("/me", response_model=AuthUserResponse)
def me(current_user: UserRecord = Depends(get_current_user)) -> AuthUserResponse:
    return AuthUserResponse(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
    )
