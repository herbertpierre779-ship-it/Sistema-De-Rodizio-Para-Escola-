from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.container import AppContainer
from app.core.exceptions import AppError
from app.core.security import decode_access_token
from app.models.entities import UserRecord, UserRole
from app.schemas.settings import PermissionModule


bearer_scheme = HTTPBearer(auto_error=False)


def get_container(request: Request) -> AppContainer:
    return request.app.state.container  # type: ignore[return-value]


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    container: AppContainer = Depends(get_container),
) -> UserRecord:
    if not credentials:
        raise AppError(401, "Autenticacao obrigatoria.")
    payload = decode_access_token(container.settings, credentials.credentials)
    user = container.user_service.get_user(payload["sub"])
    if not user.is_active:
        raise AppError(403, "Usuario inativo.")
    return user


def require_roles(*roles: UserRole) -> Callable[[UserRecord], UserRecord]:
    def dependency(current_user: UserRecord = Depends(get_current_user)) -> UserRecord:
        if current_user.role not in roles:
            raise AppError(403, "Voce nao tem permissao para acessar este recurso.")
        return current_user

    return dependency


def require_module_permission(module: PermissionModule) -> Callable[[UserRecord, AppContainer], UserRecord]:
    def dependency(
        current_user: UserRecord = Depends(get_current_user),
        container: AppContainer = Depends(get_container),
    ) -> UserRecord:
        container.app_settings_service.ensure_module_access(current_user, module)
        return current_user

    return dependency
