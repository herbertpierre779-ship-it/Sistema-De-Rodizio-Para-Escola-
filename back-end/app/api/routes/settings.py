from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import (
    get_container,
    get_current_user,
    require_module_permission,
    require_roles,
)
from app.core.container import AppContainer
from app.models.entities import UserRecord, UserRole
from app.schemas.settings import (
    EmbeddingsRebuildStatusResponse,
    MealScheduleSettingsResponse,
    MealScheduleSettingsUpdateRequest,
    PermissionsEffectiveResponse,
    PermissionsSettingsResponse,
    PermissionsSettingsUpdateRequest,
    RegistrationCaptureModeResponse,
    RegistrationCaptureModeUpdateRequest,
)


router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/registration-capture-mode", response_model=RegistrationCaptureModeResponse)
def get_registration_capture_mode(
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> RegistrationCaptureModeResponse:
    return container.app_settings_service.get_registration_capture_mode()


@router.put("/registration-capture-mode", response_model=RegistrationCaptureModeResponse)
def set_registration_capture_mode(
    payload: RegistrationCaptureModeUpdateRequest,
    _: UserRecord = Depends(require_module_permission("config_modo_captura")),
    container: AppContainer = Depends(get_container),
) -> RegistrationCaptureModeResponse:
    return container.app_settings_service.set_registration_capture_mode(payload.mode)


@router.get("/meal-schedule", response_model=MealScheduleSettingsResponse)
def get_meal_schedule(
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> MealScheduleSettingsResponse:
    return container.app_settings_service.get_meal_schedule()


@router.put("/meal-schedule", response_model=MealScheduleSettingsResponse)
def set_meal_schedule(
    payload: MealScheduleSettingsUpdateRequest,
    _: UserRecord = Depends(require_module_permission("config_horarios_refeicoes")),
    container: AppContainer = Depends(get_container),
) -> MealScheduleSettingsResponse:
    return container.app_settings_service.set_meal_schedule(payload)


@router.get("/permissions/effective", response_model=PermissionsEffectiveResponse)
def get_permissions_effective(
    current_user: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> PermissionsEffectiveResponse:
    return container.app_settings_service.get_effective_permissions(current_user)


@router.get("/permissions", response_model=PermissionsSettingsResponse)
def get_permissions_settings(
    current_user: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> PermissionsSettingsResponse:
    container.app_settings_service.ensure_module_access(current_user, "config_permissoes")
    return container.app_settings_service.get_permissions_settings()


@router.put("/permissions", response_model=PermissionsSettingsResponse)
def set_permissions_settings(
    payload: PermissionsSettingsUpdateRequest,
    current_user: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> PermissionsSettingsResponse:
    container.app_settings_service.ensure_module_access(current_user, "config_permissoes")
    return container.app_settings_service.set_permissions_settings(payload)


@router.get("/embeddings-rebuild", response_model=EmbeddingsRebuildStatusResponse)
def get_embeddings_rebuild_status(
    _: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> EmbeddingsRebuildStatusResponse:
    return container.embeddings_rebuild_service.get_status()


@router.post("/embeddings-rebuild", response_model=EmbeddingsRebuildStatusResponse)
def start_embeddings_rebuild(
    _: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> EmbeddingsRebuildStatusResponse:
    return container.embeddings_rebuild_service.start_rebuild()
