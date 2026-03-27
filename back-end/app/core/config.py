from __future__ import annotations

from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Cantina API"
    app_env: str = "development"
    secret_key: str = "troque-esta-chave-em-producao"
    token_expire_minutes: int = 720
    jwt_algorithm: str = "HS256"
    frontend_origins_raw: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:4173,"
        "http://127.0.0.1:4173"
    )
    frontend_origin_regex: str = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
        r")(?::\d+)?$"
    )
    data_file: str = "back-end/data/dev_store.json"
    photos_root: str = "fotos"
    bootstrap_director_username: str = "diretor"
    bootstrap_director_password: str = "123456"
    bootstrap_director_full_name: str = "Diretor Geral"
    face_engine: str = Field(default="auto", description="auto, mock, opencv, face_recognition")
    recognition_match_threshold: float = 0.90
    recognition_low_confidence_threshold: float = 0.75
    recognition_min_score_gap: float = 0.03
    school_timezone: str = "America/Sao_Paulo"

    model_config = SettingsConfigDict(
        env_prefix="CANTINA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def backend_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    @property
    def data_file_path(self) -> Path:
        configured = Path(self.data_file)
        return configured if configured.is_absolute() else self.backend_root.parent / configured

    @property
    def photos_root_path(self) -> Path:
        configured = Path(self.photos_root)
        return configured if configured.is_absolute() else self.backend_root.parent / configured

    @property
    def frontend_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins_raw.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.app_env.strip().lower() not in {"prod", "production"}:
            return self

        if self.secret_key.strip() in {"", "troque-esta-chave-em-producao", "troque-esta-chave"}:
            raise ValueError(
                "Em produção, configure CANTINA_SECRET_KEY com uma chave forte."
            )
        if self.bootstrap_director_password.strip() in {"", "123456"}:
            raise ValueError(
                "Em produção, configure CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD com uma senha forte."
            )
        return self
