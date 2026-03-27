from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.core.exceptions import AppError
from app.core.security import hash_password
from app.models.entities import UserRecord, UserRole
from app.repositories.contracts import RoleRepository, UserRepository
from app.schemas.auth import AuthUserResponse
from app.schemas.users import UserCreateRequest, UserResponse, UserUpdateRequest


class UserService:
    def __init__(self, user_repository: UserRepository, role_repository: RoleRepository) -> None:
        self.user_repository = user_repository
        self.role_repository = role_repository

    def list_users(self) -> list[UserResponse]:
        users = sorted(self.user_repository.list_users(), key=lambda item: item.full_name.casefold())
        return [self.to_response(user) for user in users]

    def get_user(self, user_id: str) -> UserRecord:
        user = self.user_repository.get_by_id(user_id)
        if not user:
            raise AppError(404, "Usuário não encontrado.")
        return user

    def get_auth_user(self, user_id: str) -> AuthUserResponse:
        return AuthUserResponse.model_validate(self.to_response(self.get_user(user_id)).model_dump())

    def create_user(self, payload: UserCreateRequest) -> UserResponse:
        if not self.role_repository.exists(payload.role):
            raise AppError(400, "Perfil de acesso inválido.")
        if self.user_repository.get_by_username(payload.username):
            raise AppError(409, "Já existe um usuário com esse login.")

        now = datetime.now(UTC)
        user = UserRecord(
            id=uuid4().hex,
            username=payload.username,
            full_name=payload.full_name,
            role=payload.role,
            password_hash=hash_password(payload.password),
            is_active=payload.is_active,
            created_at=now,
            updated_at=now,
        )
        return self.to_response(self.user_repository.create(user))

    def update_user(self, user_id: str, payload: UserUpdateRequest, *, acting_user_id: str) -> UserResponse:
        user = self.get_user(user_id)

        next_role = payload.role or user.role
        next_active = user.is_active if payload.is_active is None else payload.is_active
        if user.role == UserRole.diretor and (next_role != UserRole.diretor or not next_active):
            self._ensure_not_last_director(ignore_user_id=user.id)
        if acting_user_id == user.id and next_active is False:
            raise AppError(400, "Você não pode desativar o próprio usuário.")

        updated = user.model_copy(
            update={
                "full_name": payload.full_name or user.full_name,
                "role": next_role,
                "is_active": next_active,
                "password_hash": hash_password(payload.password) if payload.password else user.password_hash,
                "updated_at": datetime.now(UTC),
            }
        )
        return self.to_response(self.user_repository.update(updated))

    def delete_user(self, user_id: str, *, acting_user_id: str) -> None:
        user = self.get_user(user_id)
        if acting_user_id == user_id:
            raise AppError(400, "Você não pode excluir o próprio usuário.")
        if user.role == UserRole.diretor:
            self._ensure_not_last_director(ignore_user_id=user.id)
        self.user_repository.delete(user_id)

    def ensure_bootstrap_director(self, *, username: str, password: str, full_name: str) -> UserResponse:
        existing = self.user_repository.get_by_username(username)
        if existing:
            if existing.role == UserRole.diretor and existing.is_active:
                return self.to_response(existing)

            updated = existing.model_copy(
                update={
                    "full_name": full_name or existing.full_name,
                    "role": UserRole.diretor,
                    "is_active": True,
                    "password_hash": hash_password(password),
                    "updated_at": datetime.now(UTC),
                }
            )
            return self.to_response(self.user_repository.update(updated))

        payload = UserCreateRequest(
            username=username,
            full_name=full_name,
            password=password,
            role=UserRole.diretor,
            is_active=True,
        )
        return self.create_user(payload)

    def _ensure_not_last_director(self, *, ignore_user_id: str) -> None:
        remaining_directors = [
            user
            for user in self.user_repository.list_users()
            if user.role == UserRole.diretor and user.is_active and user.id != ignore_user_id
        ]
        if not remaining_directors:
            raise AppError(400, "É necessário manter pelo menos um diretor ativo.")

    @staticmethod
    def to_response(user: UserRecord) -> UserResponse:
        return UserResponse(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
