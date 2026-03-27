from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies import get_container, require_roles
from app.core.container import AppContainer
from app.models.entities import UserRecord, UserRole
from app.schemas.users import UserCreateRequest, UserResponse, UserUpdateRequest


router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
def list_users(
    _: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> list[UserResponse]:
    return container.user_service.list_users()


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    _: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> UserResponse:
    return container.user_service.create_user(payload)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    current_user: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> UserResponse:
    return container.user_service.update_user(user_id, payload, acting_user_id=current_user.id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    current_user: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> Response:
    container.user_service.delete_user(user_id, acting_user_id=current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
