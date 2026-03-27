from __future__ import annotations

from app.core.config import Settings
from app.core.exceptions import AppError
from app.core.security import create_access_token, verify_password
from app.models.entities import UserRecord
from app.repositories.contracts import UserRepository
from app.schemas.auth import AuthUserResponse, LoginRequest, LoginResponse


class AuthService:
    def __init__(self, settings: Settings, user_repository: UserRepository) -> None:
        self.settings = settings
        self.user_repository = user_repository

    def login(self, payload: LoginRequest) -> LoginResponse:
        user = self.user_repository.get_by_username(payload.username)
        if not user or not verify_password(payload.password, user.password_hash):
            raise AppError(401, "Usuário ou senha inválidos.")
        if not user.is_active:
            raise AppError(403, "Usuário inativo.")

        token, expires_at = create_access_token(
            self.settings,
            subject=user.id,
            role=user.role.value,
        )
        return LoginResponse(
            access_token=token,
            expires_at=expires_at,
            user=self.to_auth_user(user),
        )

    @staticmethod
    def to_auth_user(user: UserRecord) -> AuthUserResponse:
        return AuthUserResponse(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
