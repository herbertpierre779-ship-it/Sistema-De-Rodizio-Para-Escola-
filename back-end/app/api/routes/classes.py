from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies import get_container, get_current_user, require_roles
from app.core.container import AppContainer
from app.models.entities import UserRecord, UserRole
from app.schemas.classes import ClassCreateRequest, ClassResponse, ClassUpdateRequest


router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("", response_model=list[ClassResponse])
def list_classes(
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> list[ClassResponse]:
    return container.class_service.list_classes()


@router.post("", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
def create_class(
    payload: ClassCreateRequest,
    _: UserRecord = Depends(require_roles(UserRole.diretor, UserRole.coordenadora)),
    container: AppContainer = Depends(get_container),
) -> ClassResponse:
    return container.class_service.create_class(payload)


@router.patch("/{class_id}", response_model=ClassResponse)
def update_class(
    class_id: str,
    payload: ClassUpdateRequest,
    _: UserRecord = Depends(require_roles(UserRole.diretor, UserRole.coordenadora)),
    container: AppContainer = Depends(get_container),
) -> ClassResponse:
    return container.class_service.update_class(class_id, payload)


@router.delete("/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_class(
    class_id: str,
    _: UserRecord = Depends(require_roles(UserRole.diretor, UserRole.coordenadora)),
    container: AppContainer = Depends(get_container),
) -> Response:
    container.class_service.delete_class(class_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
