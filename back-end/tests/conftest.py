from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def photos_root(tmp_path: Path) -> Path:
    return tmp_path / "fotos"


@pytest.fixture()
def database_file(tmp_path: Path) -> Path:
    return tmp_path / "cantina.db"


@pytest.fixture()
def legacy_data_file(tmp_path: Path) -> Path:
    return tmp_path / "dev_store.json"


@pytest.fixture()
def meal_entries_file(tmp_path: Path) -> Path:
    return tmp_path / "meal_entries.json"


@pytest.fixture()
def recognition_attempts_file(tmp_path: Path) -> Path:
    return tmp_path / "recognition_attempts.json"


@pytest.fixture()
def client(
    photos_root: Path,
    database_file: Path,
    legacy_data_file: Path,
    meal_entries_file: Path,
    recognition_attempts_file: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    monkeypatch.setenv("CANTINA_DATABASE_FILE", str(database_file))
    monkeypatch.setenv("CANTINA_LEGACY_DATA_FILE", str(legacy_data_file))
    monkeypatch.setenv("CANTINA_MEAL_ENTRIES_FILE", str(meal_entries_file))
    monkeypatch.setenv("CANTINA_RECOGNITION_ATTEMPTS_FILE", str(recognition_attempts_file))
    monkeypatch.setenv("CANTINA_PHOTOS_ROOT", str(photos_root))
    monkeypatch.setenv("CANTINA_FACE_ENGINE", "mock")
    monkeypatch.setenv("CANTINA_SECRET_KEY", "test-secret-key-with-32-characters")
    monkeypatch.setenv("CANTINA_FRONTEND_ORIGINS_RAW", "http://localhost:5173,http://127.0.0.1:5173")
    monkeypatch.setenv("CANTINA_SCHOOL_TIMEZONE", "America/Sao_Paulo")
    monkeypatch.setenv("CANTINA_BOOTSTRAP_DIRECTOR_USERNAME", "diretor")
    monkeypatch.setenv("CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD", "123456")
    monkeypatch.setenv("CANTINA_BOOTSTRAP_DIRECTOR_FULL_NAME", "Diretor Teste")

    os.environ.pop("PYTHONPATH", None)

    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
