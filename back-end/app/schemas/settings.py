from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


RegistrationCaptureMode = Literal["three_photos", "hundred_photos"]
MealScheduleProfileScope = Literal["funcionario", "coordenadora"]
PermissionModule = Literal[
    "operacao",
    "cadastro_aluno",
    "criar_turma",
    "estatisticas",
    "config_usuarios",
    "config_modo_captura",
    "config_horarios_refeicoes",
    "config_permissoes",
]


class RegistrationCaptureModeResponse(BaseModel):
    mode: RegistrationCaptureMode


class RegistrationCaptureModeUpdateRequest(BaseModel):
    mode: RegistrationCaptureMode


class MealScheduleWindow(BaseModel):
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class MealScheduleMealConfig(BaseModel):
    enabled: bool = False
    windows: list[MealScheduleWindow] = Field(default_factory=list)


class MealScheduleMeals(BaseModel):
    almoco: MealScheduleMealConfig
    merenda: MealScheduleMealConfig
    sem_rodizio: MealScheduleMealConfig


class MealScheduleSettingsBase(BaseModel):
    profiles: list[MealScheduleProfileScope] = Field(default_factory=list)
    meals: MealScheduleMeals

    @model_validator(mode="after")
    def dedupe_profiles(self) -> "MealScheduleSettingsBase":
        seen: set[str] = set()
        next_profiles: list[MealScheduleProfileScope] = []
        for item in self.profiles:
            if item in seen:
                continue
            seen.add(item)
            next_profiles.append(item)
        self.profiles = next_profiles
        return self


class MealScheduleSettingsResponse(MealScheduleSettingsBase):
    pass


class MealScheduleSettingsUpdateRequest(MealScheduleSettingsBase):
    pass


class PermissionMap(BaseModel):
    operacao: bool = False
    cadastro_aluno: bool = False
    criar_turma: bool = False
    estatisticas: bool = False
    config_usuarios: bool = False
    config_modo_captura: bool = False
    config_horarios_refeicoes: bool = False
    config_permissoes: bool = False


class PermissionOverrideMap(BaseModel):
    operacao: bool | None = None
    cadastro_aluno: bool | None = None
    criar_turma: bool | None = None
    estatisticas: bool | None = None
    config_usuarios: bool | None = None
    config_modo_captura: bool | None = None
    config_horarios_refeicoes: bool | None = None
    config_permissoes: bool | None = None


class PermissionProfileSettings(BaseModel):
    coordenadora: PermissionMap
    funcionario: PermissionMap


class PermissionsSettingsBase(BaseModel):
    profiles: PermissionProfileSettings
    user_overrides: dict[str, PermissionOverrideMap] = Field(default_factory=dict)


class PermissionsSettingsResponse(PermissionsSettingsBase):
    pass


class PermissionsSettingsUpdateRequest(PermissionsSettingsBase):
    pass


class PermissionsEffectiveResponse(BaseModel):
    modules: PermissionMap


class EmbeddingsRebuildStatusResponse(BaseModel):
    running: bool
    total_students: int
    processed_students: int
    total_samples: int
    processed_samples: int
    failed_students: int
    started_at: str | None = None
    finished_at: str | None = None
    last_error: str | None = None
