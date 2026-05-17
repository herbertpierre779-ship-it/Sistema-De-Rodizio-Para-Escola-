from __future__ import annotations

import json
from datetime import datetime
from typing import cast

from app.core.clock import to_school_datetime, utc_now
from app.core.config import Settings
from app.core.exceptions import AppError
from app.models.entities import MealType, UserRecord, UserRole
from app.repositories.contracts import AppSettingsRepository, UserRepository
from app.schemas.settings import (
    MealScheduleMealConfig,
    MealScheduleSettingsResponse,
    MealScheduleSettingsUpdateRequest,
    MealScheduleWindow,
    PermissionMap,
    PermissionModule,
    PermissionOverrideMap,
    PermissionsEffectiveResponse,
    PermissionsSettingsResponse,
    PermissionsSettingsUpdateRequest,
    RegistrationCaptureMode,
    RegistrationCaptureModeResponse,
)


REGISTRATION_CAPTURE_MODE_KEY = "registration_capture_mode"
DEFAULT_REGISTRATION_CAPTURE_MODE: RegistrationCaptureMode = "hundred_photos"
MEAL_SCHEDULE_KEY = "meal_schedule_v1"
PERMISSIONS_KEY = "permissions_v1"
MEAL_PROFILE_ORDER = ["funcionario", "coordenadora"]
MEAL_RESTRICTED_ROLES = {UserRole.funcionario, UserRole.coordenadora}
PERMISSION_MODULES: tuple[PermissionModule, ...] = (
    "operacao",
    "cadastro_aluno",
    "criar_turma",
    "estatisticas",
    "config_usuarios",
    "config_modo_captura",
    "config_horarios_refeicoes",
    "config_permissoes",
)
MEAL_LABELS = {
    MealType.almoco: "almoco",
    MealType.merenda: "merenda",
    MealType.sem_rodizio: "sem rodizio",
}
PERMISSION_DENIED_MESSAGE = "Voce nao tem permissao para acessar este modulo."


class AppSettingsService:
    def __init__(
        self,
        settings: Settings,
        repository: AppSettingsRepository,
        user_repository: UserRepository,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.user_repository = user_repository

    def get_registration_capture_mode(self) -> RegistrationCaptureModeResponse:
        raw_value = self.repository.get_value(REGISTRATION_CAPTURE_MODE_KEY)
        mode = self._normalize_mode(raw_value)
        if raw_value != mode:
            self.repository.set_value(REGISTRATION_CAPTURE_MODE_KEY, mode)
        return RegistrationCaptureModeResponse(mode=mode)

    def set_registration_capture_mode(self, mode: RegistrationCaptureMode) -> RegistrationCaptureModeResponse:
        normalized_mode = self._normalize_mode(mode)
        self.repository.set_value(REGISTRATION_CAPTURE_MODE_KEY, normalized_mode)
        return RegistrationCaptureModeResponse(mode=normalized_mode)

    def get_meal_schedule(self) -> MealScheduleSettingsResponse:
        raw_value = self.repository.get_value(MEAL_SCHEDULE_KEY)
        if raw_value is None:
            default_payload = self._default_meal_schedule()
            self._save_meal_schedule(default_payload)
            return default_payload

        try:
            parsed_payload = json.loads(raw_value)
            typed_payload = MealScheduleSettingsUpdateRequest.model_validate(parsed_payload)
        except Exception:
            default_payload = self._default_meal_schedule()
            self._save_meal_schedule(default_payload)
            return default_payload

        normalized_payload = self._normalize_meal_schedule(typed_payload)
        serialized = self._serialize_meal_schedule(normalized_payload)
        if serialized != raw_value:
            self.repository.set_value(MEAL_SCHEDULE_KEY, serialized)
        return normalized_payload

    def set_meal_schedule(self, payload: MealScheduleSettingsUpdateRequest) -> MealScheduleSettingsResponse:
        normalized_payload = self._normalize_meal_schedule(payload)
        self._save_meal_schedule(normalized_payload)
        return normalized_payload

    def get_permissions_settings(self) -> PermissionsSettingsResponse:
        raw_value = self.repository.get_value(PERMISSIONS_KEY)
        if raw_value is None:
            default_payload = self._default_permissions_settings()
            self._save_permissions_settings(default_payload)
            return default_payload

        try:
            parsed_payload = json.loads(raw_value)
            typed_payload = PermissionsSettingsUpdateRequest.model_validate(parsed_payload)
        except Exception:
            default_payload = self._default_permissions_settings()
            self._save_permissions_settings(default_payload)
            return default_payload

        normalized_payload = self._normalize_permissions_settings(typed_payload)
        serialized = self._serialize_permissions_settings(normalized_payload)
        if serialized != raw_value:
            self.repository.set_value(PERMISSIONS_KEY, serialized)
        return normalized_payload

    def set_permissions_settings(
        self,
        payload: PermissionsSettingsUpdateRequest,
    ) -> PermissionsSettingsResponse:
        normalized_payload = self._normalize_permissions_settings(payload)
        self._save_permissions_settings(normalized_payload)
        return normalized_payload

    def get_effective_permissions(self, user: UserRecord) -> PermissionsEffectiveResponse:
        if user.role == UserRole.diretor:
            return PermissionsEffectiveResponse(modules=self._all_true_permission_map())

        settings = self.get_permissions_settings()
        if user.role == UserRole.coordenadora:
            resolved_modules = settings.profiles.coordenadora.model_dump()
        elif user.role == UserRole.funcionario:
            resolved_modules = settings.profiles.funcionario.model_dump()
        else:
            resolved_modules = self._empty_permission_map().model_dump()

        override = settings.user_overrides.get(user.id)
        if override:
            for module_name, value in override.model_dump(exclude_none=True).items():
                resolved_modules[module_name] = bool(value)

        return PermissionsEffectiveResponse(modules=PermissionMap.model_validate(resolved_modules))

    def has_module_access(self, user: UserRecord, module: PermissionModule) -> bool:
        if user.role == UserRole.diretor:
            return True
        effective = self.get_effective_permissions(user)
        return bool(getattr(effective.modules, module))

    def ensure_module_access(self, user: UserRecord, module: PermissionModule) -> None:
        if not self.has_module_access(user, module):
            raise AppError(403, PERMISSION_DENIED_MESSAGE)

    def is_meal_available_for_role(
        self,
        meal_type: MealType,
        role: UserRole,
        *,
        reference_time: datetime | None = None,
    ) -> bool:
        if role == UserRole.diretor:
            return True

        if role not in MEAL_RESTRICTED_ROLES:
            return True

        schedule = self.get_meal_schedule()
        config = getattr(schedule.meals, meal_type.value)
        if not config.enabled:
            return True
        if not config.windows:
            return False

        now = to_school_datetime(self.settings, reference_time or utc_now())
        now_minutes = now.hour * 60 + now.minute
        for window in config.windows:
            start = self._time_to_minutes(window.start)
            end = self._time_to_minutes(window.end)
            if start <= now_minutes < end:
                return True
        return False

    def unavailable_meal_message(self, meal_type: MealType) -> str:
        label = MEAL_LABELS[meal_type]
        return f"A refeicao {label} esta indisponivel neste horario para seu perfil."

    @staticmethod
    def _normalize_mode(raw_value: str | None) -> RegistrationCaptureMode:
        if raw_value in {"three_photos", "hundred_photos"}:
            return raw_value
        if raw_value is None:
            return DEFAULT_REGISTRATION_CAPTURE_MODE
        raise AppError(400, "Modo de captura invalido. Use three_photos ou hundred_photos.")

    def _normalize_meal_schedule(
        self,
        payload: MealScheduleSettingsUpdateRequest,
    ) -> MealScheduleSettingsResponse:
        profiles = [item for item in MEAL_PROFILE_ORDER]
        meals = {
            MealType.almoco: payload.meals.almoco,
            MealType.merenda: payload.meals.merenda,
            MealType.sem_rodizio: payload.meals.sem_rodizio,
        }
        normalized_meals: dict[MealType, MealScheduleMealConfig] = {}
        for meal_type, config in meals.items():
            normalized_windows = self._normalize_windows(config.windows, meal_type)
            if config.enabled and not normalized_windows:
                raise AppError(400, f"Defina ao menos um horario para {MEAL_LABELS[meal_type]}.")
            normalized_meals[meal_type] = MealScheduleMealConfig(
                enabled=config.enabled,
                windows=normalized_windows,
            )
        return MealScheduleSettingsResponse(
            profiles=profiles,
            meals={
                "almoco": normalized_meals[MealType.almoco],
                "merenda": normalized_meals[MealType.merenda],
                "sem_rodizio": normalized_meals[MealType.sem_rodizio],
            },
        )

    def _normalize_permissions_settings(
        self,
        payload: PermissionsSettingsUpdateRequest,
    ) -> PermissionsSettingsResponse:
        normalized_profiles = {
            "coordenadora": self._normalize_permission_map(payload.profiles.coordenadora),
            "funcionario": self._normalize_permission_map(payload.profiles.funcionario),
        }

        normalized_overrides: dict[str, PermissionOverrideMap] = {}
        for raw_user_id, override in payload.user_overrides.items():
            user = self.user_repository.get_by_id(raw_user_id)
            if not user or user.role == UserRole.diretor:
                continue

            normalized_override = self._normalize_permission_override_map(override)
            if not normalized_override.model_dump(exclude_none=True):
                continue

            normalized_overrides[user.id] = normalized_override

        return PermissionsSettingsResponse(
            profiles=normalized_profiles,
            user_overrides=normalized_overrides,
        )

    @staticmethod
    def _normalize_permission_map(permission_map: PermissionMap) -> PermissionMap:
        normalized_payload = {
            module: bool(getattr(permission_map, module))
            for module in PERMISSION_MODULES
        }
        return PermissionMap.model_validate(normalized_payload)

    @staticmethod
    def _normalize_permission_override_map(override_map: PermissionOverrideMap) -> PermissionOverrideMap:
        normalized_payload = {
            module: cast(bool | None, getattr(override_map, module))
            for module in PERMISSION_MODULES
        }
        return PermissionOverrideMap.model_validate(normalized_payload)

    def _normalize_windows(
        self,
        windows: list[MealScheduleWindow],
        meal_type: MealType,
    ) -> list[MealScheduleWindow]:
        ranked_windows: list[tuple[int, int, MealScheduleWindow]] = []
        for window in windows:
            start_minutes = self._time_to_minutes(window.start)
            end_minutes = self._time_to_minutes(window.end)
            if start_minutes >= end_minutes:
                raise AppError(
                    400,
                    f"Intervalo invalido em {MEAL_LABELS[meal_type]}: {window.start}-{window.end}.",
                )
            ranked_windows.append((start_minutes, end_minutes, window))
        ranked_windows.sort(key=lambda item: (item[0], item[1]))

        normalized: list[MealScheduleWindow] = []
        previous_end: int | None = None
        for start_minutes, end_minutes, window in ranked_windows:
            if previous_end is not None and start_minutes < previous_end:
                raise AppError(
                    400,
                    f"Ha sobreposicao de horarios em {MEAL_LABELS[meal_type]}.",
                )
            previous_end = end_minutes
            if normalized and normalized[-1].start == window.start and normalized[-1].end == window.end:
                continue
            normalized.append(MealScheduleWindow(start=window.start, end=window.end))
        return normalized

    @staticmethod
    def _time_to_minutes(value: str) -> int:
        try:
            hour_raw, minute_raw = value.split(":", maxsplit=1)
            hour = int(hour_raw)
            minute = int(minute_raw)
        except (ValueError, TypeError):
            raise AppError(400, f"Horario invalido: {value}. Use HH:MM.")
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise AppError(400, f"Horario invalido: {value}. Use HH:MM.")
        return hour * 60 + minute

    def _save_meal_schedule(self, payload: MealScheduleSettingsResponse) -> None:
        self.repository.set_value(MEAL_SCHEDULE_KEY, self._serialize_meal_schedule(payload))

    def _save_permissions_settings(self, payload: PermissionsSettingsResponse) -> None:
        self.repository.set_value(PERMISSIONS_KEY, self._serialize_permissions_settings(payload))

    @staticmethod
    def _serialize_meal_schedule(payload: MealScheduleSettingsResponse) -> str:
        return payload.model_dump_json(by_alias=True, exclude_none=True)

    @staticmethod
    def _serialize_permissions_settings(payload: PermissionsSettingsResponse) -> str:
        return payload.model_dump_json(by_alias=True, exclude_none=True)

    @staticmethod
    def _all_true_permission_map() -> PermissionMap:
        return PermissionMap.model_validate({module: True for module in PERMISSION_MODULES})

    @staticmethod
    def _empty_permission_map() -> PermissionMap:
        return PermissionMap.model_validate({module: False for module in PERMISSION_MODULES})

    @staticmethod
    def _default_permissions_settings() -> PermissionsSettingsResponse:
        return PermissionsSettingsResponse(
            profiles={
                "coordenadora": {
                    "operacao": True,
                    "cadastro_aluno": True,
                    "criar_turma": True,
                    "estatisticas": True,
                    "config_usuarios": False,
                    "config_modo_captura": False,
                    "config_horarios_refeicoes": True,
                    "config_permissoes": False,
                },
                "funcionario": {
                    "operacao": True,
                    "cadastro_aluno": True,
                    "criar_turma": False,
                    "estatisticas": False,
                    "config_usuarios": False,
                    "config_modo_captura": False,
                    "config_horarios_refeicoes": False,
                    "config_permissoes": False,
                },
            },
            user_overrides={},
        )

    @staticmethod
    def _default_meal_schedule() -> MealScheduleSettingsResponse:
        return MealScheduleSettingsResponse(
            profiles=["funcionario", "coordenadora"],
            meals={
                "almoco": {"enabled": True, "windows": [{"start": "12:20", "end": "14:20"}]},
                "merenda": {"enabled": True, "windows": [{"start": "10:00", "end": "10:20"}]},
                "sem_rodizio": {"enabled": False, "windows": []},
            },
        )
