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
def client(tmp_path: Path, photos_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("CANTINA_DATA_FILE", str(tmp_path / "dev_store.json"))
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
