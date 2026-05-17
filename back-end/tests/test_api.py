from __future__ import annotations

import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.face.engine import build_face_engine
from app.adapters.persistence.json_collection_store import JsonCollectionStore
from app.adapters.persistence.sqlite_repositories import SqliteUserRepository, StaticRoleRepository
from app.adapters.persistence.sqlite_store import SqliteStore
from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.models.entities import UserRecord, UserRole
from app.services.user_service import UserService


def login(client: TestClient, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _cpf_digit(base: str, start_factor: int) -> int:
    total = sum(int(char) * factor for char, factor in zip(base, range(start_factor, 1, -1), strict=True))
    remainder = total % 11
    return 0 if remainder < 2 else 11 - remainder


def build_valid_cpf(seed: int) -> str:
    first_nine = f"{seed:09d}"
    first_digit = _cpf_digit(first_nine, 10)
    second_digit = _cpf_digit(f"{first_nine}{first_digit}", 11)
    return f"{first_nine}{first_digit}{second_digit}"


def _minutes_to_hhmm(total_minutes: int) -> str:
    safe_minutes = max(0, min(1439, total_minutes))
    hour = safe_minutes // 60
    minute = safe_minutes % 60
    return f"{hour:02d}:{minute:02d}"


def build_window_outside_now() -> tuple[str, str]:
    now = datetime.now(UTC) + timedelta(hours=-3)
    current_minutes = now.hour * 60 + now.minute

    if current_minutes <= 1410:
        start = current_minutes + 20
        end = start + 10
        return _minutes_to_hhmm(start), _minutes_to_hhmm(end)

    if current_minutes >= 30:
        start = current_minutes - 30
        end = start + 10
        return _minutes_to_hhmm(start), _minutes_to_hhmm(end)

    return "23:40", "23:50"


def create_class(
    client: TestClient,
    token: str,
    *,
    name: str,
    school_year: str,
) -> dict:
    response = client.post(
        "/classes",
        headers=auth_headers(token),
        json={"name": name, "school_year": school_year},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_login_and_role_protection(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    invalid_login = client.post("/auth/login", json={"username": "diretor", "password": "senha-errada"})
    assert invalid_login.status_code == 401

    create_user = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "funcionario",
            "full_name": "Funcionario Teste",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_user.status_code == 201, create_user.text

    create_coordinator = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "coordenadora",
            "full_name": "Coordenadora Teste",
            "password": "123456",
            "role": "coordenadora",
            "is_active": True,
        },
    )
    assert create_coordinator.status_code == 201, create_coordinator.text

    employee_token = login(client, "funcionario", "123456")
    coordinator_token = login(client, "coordenadora", "123456")

    employee_cannot_manage = client.get("/stats/overview", headers=auth_headers(employee_token))
    assert employee_cannot_manage.status_code == 403

    employee_cannot_create_class = client.post(
        "/classes",
        headers=auth_headers(employee_token),
        json={"name": "A", "school_year": "1 ano"},
    )
    assert employee_cannot_create_class.status_code == 403

    coordinator_can_manage_class = client.post(
        "/classes",
        headers=auth_headers(coordinator_token),
        json={"name": "A", "school_year": "1 ano"},
    )
    assert coordinator_can_manage_class.status_code == 201, coordinator_can_manage_class.text
    payload = coordinator_can_manage_class.json()
    assert payload["school_year"] == "1 ano"
    assert payload["display_name"] == "1 ano - A"

    employee_can_list_classes = client.get("/classes", headers=auth_headers(employee_token))
    assert employee_can_list_classes.status_code == 200
    assert employee_can_list_classes.json()[0]["display_name"] == "1 ano - A"

    coordinator_stats = client.get("/stats/overview", headers=auth_headers(coordinator_token))
    assert coordinator_stats.status_code == 200

    filtered_stats = client.get("/stats/charts?meal_type=almoco", headers=auth_headers(coordinator_token))
    assert filtered_stats.status_code == 200

    coordinator_users = client.get("/users", headers=auth_headers(coordinator_token))
    assert coordinator_users.status_code == 403


def test_user_deactivation_blocks_active_sessions_and_prevents_self_deactivation(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    create_employee = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_sessao",
            "full_name": "Funcionario Sessao",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_employee.status_code == 201, create_employee.text
    employee_id = create_employee.json()["id"]
    employee_token = login(client, "func_sessao", "123456")

    deactivate_employee = client.patch(
        f"/users/{employee_id}",
        headers=auth_headers(director_token),
        json={"is_active": False},
    )
    assert deactivate_employee.status_code == 200, deactivate_employee.text
    assert deactivate_employee.json()["is_active"] is False

    employee_me = client.get("/auth/me", headers=auth_headers(employee_token))
    assert employee_me.status_code == 403
    assert "inativo" in employee_me.json()["detail"].casefold()

    employee_login_after_deactivation = client.post(
        "/auth/login",
        json={"username": "func_sessao", "password": "123456"},
    )
    assert employee_login_after_deactivation.status_code == 403
    assert "inativo" in employee_login_after_deactivation.json()["detail"].casefold()

    create_second_director = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "diretor_b",
            "full_name": "Diretor B",
            "password": "123456",
            "role": "diretor",
            "is_active": True,
        },
    )
    assert create_second_director.status_code == 201, create_second_director.text

    director_me = client.get("/auth/me", headers=auth_headers(director_token))
    assert director_me.status_code == 200, director_me.text
    director_id = director_me.json()["id"]

    self_deactivation_attempt = client.patch(
        f"/users/{director_id}",
        headers=auth_headers(director_token),
        json={"is_active": False},
    )
    assert self_deactivation_attempt.status_code == 400
    assert "desativar o próprio usuário" in self_deactivation_attempt.json()["detail"].casefold()


def test_classes_and_students_crud(client: TestClient) -> None:
    token = login(client, "diretor", "123456")

    class_a = create_class(client, token, name="B", school_year="2 ano")
    class_b = create_class(client, token, name="C", school_year="3 ano")

    list_classes = client.get("/classes", headers=auth_headers(token))
    assert list_classes.status_code == 200
    assert [item["display_name"] for item in list_classes.json()] == ["2 ano - B", "3 ano - C"]

    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Maria da Silva", "class_id": class_a["id"], "cpf": build_valid_cpf(1)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    get_student = client.get(f"/students/{student_id}", headers=auth_headers(token))
    assert get_student.status_code == 200
    assert get_student.json()["full_name"] == "MARIA DA SILVA"
    assert get_student.json()["school_year"] == "2 ano"
    assert get_student.json()["class_display_name"] == "2 ano - B"

    update_student = client.patch(
        f"/students/{student_id}",
        headers=auth_headers(token),
        json={"full_name": "Maria Atualizada", "class_id": class_b["id"]},
    )
    assert update_student.status_code == 200
    assert update_student.json()["full_name"] == "MARIA ATUALIZADA"
    assert update_student.json()["school_year"] == "3 ano"
    assert update_student.json()["class_display_name"] == "3 ano - C"

    delete_student = client.delete(f"/students/{student_id}", headers=auth_headers(token))
    assert delete_student.status_code == 204

    delete_class_a = client.delete(f"/classes/{class_a['id']}", headers=auth_headers(token))
    assert delete_class_a.status_code == 204

    delete_class_b = client.delete(f"/classes/{class_b['id']}", headers=auth_headers(token))
    assert delete_class_b.status_code == 204


def test_delete_student_removes_media_even_when_media_folder_is_inconsistent(
    client: TestClient,
    database_file: Path,
    photos_root: Path,
) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="MIDIA", school_year="2 ano")

    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Midia", "class_id": class_response["id"], "cpf": build_valid_cpf(901)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    enroll_response = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("front.jpg", b"vector:0.1,0.2,0.3", "image/jpeg")},
    )
    assert enroll_response.status_code == 200, enroll_response.text

    student_get = client.get(f"/students/{student_id}", headers=auth_headers(token))
    assert student_get.status_code == 200, student_get.text
    photo_url = student_get.json()["photo_url"]
    assert photo_url
    relative_photo_path = unquote(photo_url.removeprefix("/media/"))
    real_media_dir = photos_root / Path(relative_photo_path).parent
    assert real_media_dir.exists()

    with sqlite3.connect(database_file) as connection:
        connection.execute(
            "UPDATE students SET media_folder = ? WHERE id = ?",
            ("mismatch-folder", int(student_id)),
        )
        connection.commit()

    delete_response = client.delete(f"/students/{student_id}", headers=auth_headers(token))
    assert delete_response.status_code == 204, delete_response.text
    assert not real_media_dir.exists()


def test_student_creation_rejects_invalid_or_duplicate_cpf(client: TestClient) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="CPF", school_year="1 ano")

    invalid_cpf = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno CPF Invalido", "class_id": class_response["id"], "cpf": "123.456.789-00"},
    )
    assert invalid_cpf.status_code == 400
    assert "cpf" in invalid_cpf.json()["detail"].casefold()

    valid_cpf = build_valid_cpf(11)
    first_create = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno CPF Duplicado", "class_id": class_response["id"], "cpf": valid_cpf},
    )
    assert first_create.status_code == 201, first_create.text

    duplicate_cpf = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Outro Aluno CPF Duplicado", "class_id": class_response["id"], "cpf": valid_cpf},
    )
    assert duplicate_cpf.status_code == 409
    assert "cpf" in duplicate_cpf.json()["detail"].casefold()


def test_identify_by_cpf_flow(client: TestClient) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="R", school_year="1 ano")
    student_cpf = build_valid_cpf(12)

    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno CPF Operacao", "class_id": class_response["id"], "cpf": student_cpf},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    found = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": f"{student_cpf[:3]}.{student_cpf[3:6]}.{student_cpf[6:9]}-{student_cpf[9:]}", "meal_type": "almoco"},
    )
    assert found.status_code == 200, found.text
    found_payload = found.json()
    assert found_payload["status"] == "low_confidence"
    assert found_payload["matched"] is True
    assert found_payload["student"]["id"] == student_id
    assert "cpf" not in found_payload["student"]

    meal_entry = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert meal_entry.status_code == 201, meal_entry.text

    duplicate = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": student_cpf, "meal_type": "almoco"},
    )
    assert duplicate.status_code == 200, duplicate.text
    duplicate_payload = duplicate.json()
    assert duplicate_payload["already_recorded_today"] is True
    assert "almo" in duplicate_payload["already_recorded_message"].lower()

    sem_found = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": student_cpf, "meal_type": "sem_rodizio"},
    )
    assert sem_found.status_code == 200, sem_found.text
    sem_found_payload = sem_found.json()
    assert sem_found_payload["status"] == "low_confidence"
    assert sem_found_payload["student"]["id"] == student_id

    sem_entry = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "sem_rodizio", "source": "manual"},
    )
    assert sem_entry.status_code == 201, sem_entry.text

    sem_duplicate = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": student_cpf, "meal_type": "sem_rodizio"},
    )
    assert sem_duplicate.status_code == 200, sem_duplicate.text
    sem_duplicate_payload = sem_duplicate.json()
    assert sem_duplicate_payload["already_recorded_today"] is True
    assert "sem" in sem_duplicate_payload["already_recorded_message"].lower()

    not_found = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": build_valid_cpf(999), "meal_type": "almoco"},
    )
    assert not_found.status_code == 200, not_found.text
    not_found_payload = not_found.json()
    assert not_found_payload["status"] == "not_found"
    assert not_found_payload["student"] is None

    invalid_cpf = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": "123.123.123-12", "meal_type": "almoco"},
    )
    assert invalid_cpf.status_code == 400
    assert "cpf" in invalid_cpf.json()["detail"].casefold()


def test_registration_capture_mode_settings(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    create_user = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_mode",
            "full_name": "Funcionario Modo",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_user.status_code == 201, create_user.text
    employee_token = login(client, "func_mode", "123456")

    get_default = client.get("/settings/registration-capture-mode", headers=auth_headers(director_token))
    assert get_default.status_code == 200
    assert get_default.json()["mode"] == "hundred_photos"

    employee_cannot_put = client.put(
        "/settings/registration-capture-mode",
        headers=auth_headers(employee_token),
        json={"mode": "three_photos"},
    )
    assert employee_cannot_put.status_code == 403

    director_put = client.put(
        "/settings/registration-capture-mode",
        headers=auth_headers(director_token),
        json={"mode": "three_photos"},
    )
    assert director_put.status_code == 200
    assert director_put.json()["mode"] == "three_photos"

    get_updated = client.get("/settings/registration-capture-mode", headers=auth_headers(director_token))
    assert get_updated.status_code == 200
    assert get_updated.json()["mode"] == "three_photos"

    invalid_mode = client.put(
        "/settings/registration-capture-mode",
        headers=auth_headers(director_token),
        json={"mode": "invalid"},
    )
    assert invalid_mode.status_code == 422


def test_embeddings_rebuild_endpoints_and_permissions(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    create_class_response = create_class(client, director_token, name="EMB", school_year="1 ano")
    create_student_response = client.post(
        "/students",
        headers=auth_headers(director_token),
        json={
            "full_name": "Aluno Embedding",
            "class_id": create_class_response["id"],
            "cpf": build_valid_cpf(333),
        },
    )
    assert create_student_response.status_code == 201, create_student_response.text
    student_id = create_student_response.json()["id"]

    for index in range(3):
        enroll_response = client.post(
            f"/students/{student_id}/face-enroll",
            headers=auth_headers(director_token),
            files={"file": (f"face-front-{index}.jpg", b"vector:0.11,0.22,0.33", "image/jpeg")},
        )
        assert enroll_response.status_code == 200, enroll_response.text

    create_employee = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_rebuild",
            "full_name": "Funcionario Rebuild",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_employee.status_code == 201, create_employee.text
    employee_token = login(client, "func_rebuild", "123456")

    employee_cannot_start = client.post(
        "/settings/embeddings-rebuild",
        headers=auth_headers(employee_token),
    )
    assert employee_cannot_start.status_code == 403

    start_response = client.post(
        "/settings/embeddings-rebuild",
        headers=auth_headers(director_token),
    )
    assert start_response.status_code == 200, start_response.text

    final_payload = start_response.json()
    for _ in range(60):
        status_response = client.get(
            "/settings/embeddings-rebuild",
            headers=auth_headers(director_token),
        )
        assert status_response.status_code == 200, status_response.text
        final_payload = status_response.json()
        if not final_payload["running"]:
            break
        time.sleep(0.05)

    assert final_payload["running"] is False
    assert final_payload["processed_students"] == final_payload["total_students"]
    assert final_payload["total_students"] >= 1

    identify_response = client.post(
        "/recognition/identify",
        headers=auth_headers(director_token),
        data={"meal_type": "almoco"},
        files={"file": ("identify.jpg", b"vector:0.11,0.22,0.33", "image/jpeg")},
    )
    assert identify_response.status_code == 200, identify_response.text
    identify_payload = identify_response.json()
    assert identify_payload["student"] is not None


def test_embeddings_rebuild_preserves_existing_embedding_when_samples_are_invalid(
    client: TestClient,
    photos_root: Path,
    database_file: Path,
) -> None:
    director_token = login(client, "diretor", "123456")
    class_response = create_class(client, director_token, name="RB", school_year="1 ano")

    student_response = client.post(
        "/students",
        headers=auth_headers(director_token),
        json={
            "full_name": "Aluno Rebuild Invalido",
            "class_id": class_response["id"],
            "cpf": build_valid_cpf(334),
        },
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    enroll_response = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(director_token),
        files={"file": ("face-front.jpg", b"vector:0.11,0.22,0.33", "image/jpeg")},
    )
    assert enroll_response.status_code == 200, enroll_response.text

    stored_photo = photos_root / "1 ano" / "rb" / "aluno-rebuild-invalido" / "front.jpg"
    assert stored_photo.exists()
    stored_photo.write_bytes(b"no-face")

    start_response = client.post(
        "/settings/embeddings-rebuild",
        headers=auth_headers(director_token),
    )
    assert start_response.status_code == 200, start_response.text

    final_payload = start_response.json()
    for _ in range(60):
        status_response = client.get(
            "/settings/embeddings-rebuild",
            headers=auth_headers(director_token),
        )
        assert status_response.status_code == 200, status_response.text
        final_payload = status_response.json()
        if not final_payload["running"]:
            break
        time.sleep(0.05)

    assert final_payload["running"] is False
    assert final_payload["failed_students"] >= 1
    assert "ALUNO REBUILD INVALIDO" in (final_payload["last_error"] or "")

    with sqlite3.connect(database_file) as connection:
        row = connection.execute(
            """
            SELECT samples_count, source_image_path
            FROM face_embeddings
            WHERE student_id = ?
            """,
            (int(student_id),),
        ).fetchone()
    assert row is not None
    assert int(row[0]) == 1
    assert row[1] == "1 ano/rb/aluno-rebuild-invalido/front.jpg"

    identify_response = client.post(
        "/recognition/identify",
        headers=auth_headers(director_token),
        files={"file": ("identify.jpg", b"vector:0.11,0.22,0.33", "image/jpeg")},
    )
    assert identify_response.status_code == 200, identify_response.text
    identify_payload = identify_response.json()
    assert identify_payload["status"] == "success"
    assert identify_payload["student"] is not None
    assert identify_payload["student"]["id"] == student_id


def test_naogazei_engine_fails_fast_when_models_are_missing(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    with pytest.raises(RuntimeError, match="Modelo obrigatorio ausente"):
        build_face_engine("naogazei_face", models_dir=models_dir)


def test_meal_schedule_settings_defaults_and_update(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    create_employee_user = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_schedule",
            "full_name": "Funcionario Schedule",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_employee_user.status_code == 201, create_employee_user.text
    employee_token = login(client, "func_schedule", "123456")

    create_coordinator_user = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "coord_schedule",
            "full_name": "Coordenadora Schedule",
            "password": "123456",
            "role": "coordenadora",
            "is_active": True,
        },
    )
    assert create_coordinator_user.status_code == 201, create_coordinator_user.text
    coordinator_token = login(client, "coord_schedule", "123456")

    default_response = client.get("/settings/meal-schedule", headers=auth_headers(director_token))
    assert default_response.status_code == 200, default_response.text
    default_payload = default_response.json()
    assert default_payload["profiles"] == ["funcionario", "coordenadora"]
    assert default_payload["meals"]["almoco"]["enabled"] is True
    assert default_payload["meals"]["almoco"]["windows"] == [{"start": "12:20", "end": "14:20"}]
    assert default_payload["meals"]["merenda"]["enabled"] is True
    assert default_payload["meals"]["merenda"]["windows"] == [{"start": "10:00", "end": "10:20"}]
    assert default_payload["meals"]["sem_rodizio"]["enabled"] is False
    assert default_payload["meals"]["sem_rodizio"]["windows"] == []

    employee_put = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(employee_token),
        json=default_payload,
    )
    assert employee_put.status_code == 403

    updated_payload = {
        "profiles": ["funcionario"],
        "meals": {
            "almoco": {"enabled": True, "windows": [{"start": "12:00", "end": "13:30"}]},
            "merenda": {"enabled": True, "windows": [{"start": "09:40", "end": "10:10"}]},
            "sem_rodizio": {"enabled": True, "windows": [{"start": "07:00", "end": "07:30"}]},
        },
    }
    coordinator_put = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(coordinator_token),
        json=updated_payload,
    )
    assert coordinator_put.status_code == 200, coordinator_put.text
    assert coordinator_put.json()["profiles"] == ["funcionario", "coordenadora"]

    normalize_profiles_put = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(director_token),
        json={
            "profiles": [],
            "meals": updated_payload["meals"],
        },
    )
    assert normalize_profiles_put.status_code == 200, normalize_profiles_put.text
    assert normalize_profiles_put.json()["profiles"] == ["funcionario", "coordenadora"]

    overlap_payload = {
        "profiles": ["funcionario"],
        "meals": {
            "almoco": {
                "enabled": True,
                "windows": [
                    {"start": "12:00", "end": "13:00"},
                    {"start": "12:30", "end": "13:10"},
                ],
            },
            "merenda": {"enabled": True, "windows": [{"start": "09:40", "end": "10:10"}]},
            "sem_rodizio": {"enabled": False, "windows": []},
        },
    }
    overlap_response = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(director_token),
        json=overlap_payload,
    )
    assert overlap_response.status_code == 400
    assert "sobrepos" in overlap_response.json()["detail"].casefold()

    invalid_interval_payload = {
        "profiles": ["funcionario"],
        "meals": {
            "almoco": {"enabled": True, "windows": [{"start": "14:00", "end": "13:00"}]},
            "merenda": {"enabled": True, "windows": [{"start": "09:40", "end": "10:10"}]},
            "sem_rodizio": {"enabled": False, "windows": []},
        },
    }
    invalid_interval_response = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(director_token),
        json=invalid_interval_payload,
    )
    assert invalid_interval_response.status_code == 400
    assert "intervalo" in invalid_interval_response.json()["detail"].casefold()


def test_meal_schedule_blocks_api_for_restricted_profiles(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")
    class_response = create_class(client, director_token, name="Horario", school_year="1 ano")
    cpf_value = build_valid_cpf(321)

    student_response = client.post(
        "/students",
        headers=auth_headers(director_token),
        json={"full_name": "Aluno Horario", "class_id": class_response["id"], "cpf": cpf_value},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    create_user = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_bloq",
            "full_name": "Funcionario Bloqueio",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_user.status_code == 201, create_user.text
    employee_token = login(client, "func_bloq", "123456")

    blocked_start, blocked_end = build_window_outside_now()
    block_payload = {
        "profiles": ["funcionario", "coordenadora"],
        "meals": {
            "almoco": {"enabled": True, "windows": [{"start": blocked_start, "end": blocked_end}]},
            "merenda": {"enabled": True, "windows": [{"start": blocked_start, "end": blocked_end}]},
            "sem_rodizio": {"enabled": True, "windows": [{"start": blocked_start, "end": blocked_end}]},
        },
    }
    update_schedule = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(director_token),
        json=block_payload,
    )
    assert update_schedule.status_code == 200, update_schedule.text

    blocked_identify = client.post(
        "/recognition/identify",
        headers=auth_headers(employee_token),
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
        data={"meal_type": "almoco"},
    )
    assert blocked_identify.status_code == 403

    blocked_identify_by_cpf = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(employee_token),
        json={"cpf": cpf_value, "meal_type": "almoco"},
    )
    assert blocked_identify_by_cpf.status_code == 403

    blocked_meal_entry = client.post(
        "/meal-entries",
        headers=auth_headers(employee_token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert blocked_meal_entry.status_code == 403

    director_allowed = client.post(
        "/recognition/identify",
        headers=auth_headers(director_token),
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
        data={"meal_type": "almoco"},
    )
    assert director_allowed.status_code == 200

    director_allowed_by_cpf = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(director_token),
        json={"cpf": cpf_value, "meal_type": "almoco"},
    )
    assert director_allowed_by_cpf.status_code == 200

    director_allowed_meal_entry = client.post(
        "/meal-entries",
        headers=auth_headers(director_token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert director_allowed_meal_entry.status_code == 201


def test_permissions_settings_and_effective_resolution(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")
    director_me = client.get("/auth/me", headers=auth_headers(director_token))
    assert director_me.status_code == 200
    director_id = director_me.json()["id"]

    create_coordinator = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "coord_perm",
            "full_name": "Coordenadora Permissao",
            "password": "123456",
            "role": "coordenadora",
            "is_active": True,
        },
    )
    assert create_coordinator.status_code == 201, create_coordinator.text
    coordinator_id = create_coordinator.json()["id"]
    coordinator_token = login(client, "coord_perm", "123456")

    create_employee = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "func_perm",
            "full_name": "Funcionario Permissao",
            "password": "123456",
            "role": "funcionario",
            "is_active": True,
        },
    )
    assert create_employee.status_code == 201, create_employee.text
    _ = create_employee.json()["id"]

    get_default_settings = client.get("/settings/permissions", headers=auth_headers(director_token))
    assert get_default_settings.status_code == 200, get_default_settings.text
    default_settings = get_default_settings.json()
    assert default_settings["profiles"]["coordenadora"]["operacao"] is True
    assert default_settings["profiles"]["funcionario"]["cadastro_aluno"] is True

    coordinator_cannot_get_matrix = client.get("/settings/permissions", headers=auth_headers(coordinator_token))
    assert coordinator_cannot_get_matrix.status_code == 403

    coordinator_effective_before = client.get(
        "/settings/permissions/effective",
        headers=auth_headers(coordinator_token),
    )
    assert coordinator_effective_before.status_code == 200, coordinator_effective_before.text
    assert coordinator_effective_before.json()["modules"]["operacao"] is True
    assert coordinator_effective_before.json()["modules"]["config_usuarios"] is False

    updated_settings = json.loads(json.dumps(default_settings))
    updated_settings["profiles"]["coordenadora"]["operacao"] = False
    updated_settings["profiles"]["coordenadora"]["estatisticas"] = False
    updated_settings["profiles"]["funcionario"]["cadastro_aluno"] = False
    updated_settings["user_overrides"] = {
        coordinator_id: {"operacao": True, "estatisticas": True},
        director_id: {"config_usuarios": False},
        "999999": {"operacao": True},
    }

    put_settings = client.put(
        "/settings/permissions",
        headers=auth_headers(director_token),
        json=updated_settings,
    )
    assert put_settings.status_code == 200, put_settings.text
    saved_settings = put_settings.json()
    assert coordinator_id in saved_settings["user_overrides"]
    assert director_id not in saved_settings["user_overrides"]
    assert "999999" not in saved_settings["user_overrides"]

    coordinator_effective_after = client.get(
        "/settings/permissions/effective",
        headers=auth_headers(coordinator_token),
    )
    assert coordinator_effective_after.status_code == 200, coordinator_effective_after.text
    modules_after = coordinator_effective_after.json()["modules"]
    assert modules_after["operacao"] is True
    assert modules_after["estatisticas"] is True
    assert modules_after["criar_turma"] is True

    director_effective = client.get("/settings/permissions/effective", headers=auth_headers(director_token))
    assert director_effective.status_code == 200, director_effective.text
    assert all(bool(value) for value in director_effective.json()["modules"].values())


def test_permissions_module_enforcement_and_user_override(client: TestClient) -> None:
    director_token = login(client, "diretor", "123456")

    create_coordinator = client.post(
        "/users",
        headers=auth_headers(director_token),
        json={
            "username": "coord_override",
            "full_name": "Coordenadora Override",
            "password": "123456",
            "role": "coordenadora",
            "is_active": True,
        },
    )
    assert create_coordinator.status_code == 201, create_coordinator.text
    coordinator_id = create_coordinator.json()["id"]
    coordinator_token = login(client, "coord_override", "123456")

    get_settings = client.get("/settings/permissions", headers=auth_headers(director_token))
    assert get_settings.status_code == 200, get_settings.text
    permissions_payload = get_settings.json()
    permissions_payload["profiles"]["coordenadora"]["criar_turma"] = False
    permissions_payload["profiles"]["coordenadora"]["config_horarios_refeicoes"] = False
    permissions_payload["profiles"]["coordenadora"]["config_usuarios"] = False
    permissions_payload["user_overrides"] = {}

    save_restricted = client.put(
        "/settings/permissions",
        headers=auth_headers(director_token),
        json=permissions_payload,
    )
    assert save_restricted.status_code == 200, save_restricted.text

    blocked_create_class = client.post(
        "/classes",
        headers=auth_headers(coordinator_token),
        json={"name": "BLOQ", "school_year": "1 ano"},
    )
    assert blocked_create_class.status_code == 403

    blocked_update_schedule = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(coordinator_token),
        json={
            "profiles": ["funcionario", "coordenadora"],
            "meals": {
                "almoco": {"enabled": True, "windows": [{"start": "12:20", "end": "14:20"}]},
                "merenda": {"enabled": True, "windows": [{"start": "10:00", "end": "10:20"}]},
                "sem_rodizio": {"enabled": False, "windows": []},
            },
        },
    )
    assert blocked_update_schedule.status_code == 403

    blocked_users_access = client.get("/users", headers=auth_headers(coordinator_token))
    assert blocked_users_access.status_code == 403

    permissions_payload["user_overrides"] = {
        coordinator_id: {
            "criar_turma": True,
            "config_horarios_refeicoes": True,
            "config_usuarios": True,
        }
    }
    save_override = client.put(
        "/settings/permissions",
        headers=auth_headers(director_token),
        json=permissions_payload,
    )
    assert save_override.status_code == 200, save_override.text

    allowed_users_access = client.get("/users", headers=auth_headers(coordinator_token))
    assert allowed_users_access.status_code == 200, allowed_users_access.text

    allowed_create_class = client.post(
        "/classes",
        headers=auth_headers(coordinator_token),
        json={"name": "LIB", "school_year": "2 ano"},
    )
    assert allowed_create_class.status_code == 201, allowed_create_class.text

    allowed_update_schedule = client.put(
        "/settings/meal-schedule",
        headers=auth_headers(coordinator_token),
        json={
            "profiles": ["funcionario", "coordenadora"],
            "meals": {
                "almoco": {"enabled": True, "windows": [{"start": "12:20", "end": "14:20"}]},
                "merenda": {"enabled": True, "windows": [{"start": "10:00", "end": "10:20"}]},
                "sem_rodizio": {"enabled": False, "windows": []},
            },
        },
    )
    assert allowed_update_schedule.status_code == 200, allowed_update_schedule.text


def test_face_enrollment_and_identification_statuses(client: TestClient, photos_root: Path) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="A", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Face", "class_id": class_response["id"], "cpf": build_valid_cpf(2)},
    )
    student_id = student_response.json()["id"]

    enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face.txt", b"vector:1,0", "text/plain")},
    )
    assert enroll.status_code == 200, enroll.text
    enrolled_student = enroll.json()["student"]
    assert enrolled_student["has_face_enrolled"] is True
    assert enrolled_student["class_display_name"] == "1 ano - A"
    assert enrolled_student["school_year"] == "1 ano"
    assert enrolled_student["photo_url"] == "/media/1%20ano/a/aluno-face/front.jpg"

    expected_photo_path = photos_root / "1 ano" / "a" / "aluno-face" / "front.jpg"
    assert expected_photo_path.exists()

    update_enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face2.txt", b"vector:1,0", "text/plain")},
    )
    assert update_enroll.status_code == 200

    no_face = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("no-face.txt", b"no-face", "text/plain")},
    )
    assert no_face.status_code == 400

    multiple_faces = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("multiple-faces.txt", b"multiple-faces", "text/plain")},
    )
    assert multiple_faces.status_code == 400

    success_identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
    )
    assert success_identify.status_code == 200
    assert success_identify.json()["status"] == "success"
    assert success_identify.json()["student"]["class_display_name"] == "1 ano - A"

    low_confidence = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0.8,0.6", "text/plain")},
    )
    assert low_confidence.status_code == 200
    assert low_confidence.json()["status"] in {"success", "low_confidence"}

    not_found = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0,1", "text/plain")},
    )
    assert not_found.status_code == 200
    assert not_found.json()["status"] == "not_found"


def test_face_enroll_uses_three_samples_for_embedding_average(
    client: TestClient, photos_root: Path, database_file: Path
) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="M", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Multi Foto", "class_id": class_response["id"], "cpf": build_valid_cpf(3)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    first_enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-front.txt", b"vector:1,0,0", "text/plain")},
    )
    assert first_enroll.status_code == 200, first_enroll.text

    second_enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-right.txt", b"vector:0,1,0", "text/plain")},
    )
    assert second_enroll.status_code == 200, second_enroll.text

    third_enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-left.txt", b"vector:0,0,1", "text/plain")},
    )
    assert third_enroll.status_code == 200, third_enroll.text

    primary_photo_path = photos_root / "1 ano" / "m" / "aluno-multi-foto" / "front.jpg"
    right_photo_path = photos_root / "1 ano" / "m" / "aluno-multi-foto" / "right.jpg"
    left_photo_path = photos_root / "1 ano" / "m" / "aluno-multi-foto" / "left.jpg"
    assert primary_photo_path.exists()
    assert right_photo_path.exists()
    assert left_photo_path.exists()
    assert primary_photo_path.read_bytes() == b"vector:1,0,0"
    assert right_photo_path.read_bytes() == b"vector:0,1,0"
    assert left_photo_path.read_bytes() == b"vector:0,0,1"

    identify_with_average = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0.34,0.34,0.34", "text/plain")},
    )
    assert identify_with_average.status_code == 200, identify_with_average.text
    identify_payload = identify_with_average.json()
    assert identify_payload["status"] == "success"
    assert identify_payload["student"]["id"] == student_id

    with sqlite3.connect(database_file) as connection:
        row = connection.execute(
            """
            SELECT student_id, samples_count, source_image_path, vector_json
            FROM face_embeddings
            """
        ).fetchone()

    assert row is not None
    assert str(row[0]) == student_id
    assert row[1] == 3
    assert row[2] == "1 ano/m/aluno-multi-foto/left.jpg"
    vector = json.loads(row[3])
    assert len(vector) == 128
    assert all(value == pytest.approx(1 / 3, rel=1e-3, abs=1e-3) for value in vector[:3])


def test_face_enroll_uses_hundred_samples_and_keeps_last_source_path(
    client: TestClient, photos_root: Path, database_file: Path
) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="Cem", school_year="2 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Cem Fotos", "class_id": class_response["id"], "cpf": build_valid_cpf(55)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    for cycle in range(1, 3):
        for index in range(1, 26):
            filename = f"cycle-{cycle:02d}-{index:03d}.jpg"
            enroll = client.post(
                f"/students/{student_id}/face-enroll",
                headers=auth_headers(token),
                files={"file": (filename, b"vector:1,0,0", "text/plain")},
            )
            assert enroll.status_code == 200, enroll.text

    identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:1,0,0", "text/plain")},
    )
    assert identify.status_code == 200, identify.text
    assert identify.json()["status"] == "success"
    assert identify.json()["student"]["id"] == student_id

    with sqlite3.connect(database_file) as connection:
        row = connection.execute(
            """
            SELECT student_id, samples_count, source_image_path
            FROM face_embeddings
            """
        ).fetchone()
    assert row is not None
    assert str(row[0]) == student_id
    assert int(row[1]) == 50
    assert row[2] == "2 ano/cem/aluno-cem-fotos/cycle-02-025.jpg"

    expected_first = photos_root / "2 ano" / "cem" / "aluno-cem-fotos" / "cycle-01-001.jpg"
    expected_last = photos_root / "2 ano" / "cem" / "aluno-cem-fotos" / "cycle-02-025.jpg"
    assert expected_first.exists()
    assert expected_last.exists()


def test_face_assets_and_face_reenroll_three_photos_replace_only_facial_data(
    client: TestClient, photos_root: Path, database_file: Path
) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="Rec", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Recaptura Tres", "class_id": class_response["id"], "cpf": build_valid_cpf(61)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    for filename, payload in (
        ("face-front.jpg", b"vector:1,0,0"),
        ("face-right.jpg", b"vector:0,1,0"),
        ("face-left.jpg", b"vector:0,0,1"),
    ):
        enroll = client.post(
            f"/students/{student_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": (filename, payload, "text/plain")},
        )
        assert enroll.status_code == 200, enroll.text

    initial_assets = client.get(f"/students/{student_id}/face-assets", headers=auth_headers(token))
    assert initial_assets.status_code == 200, initial_assets.text
    initial_payload = initial_assets.json()
    assert initial_payload["mode_hint"] == "three_photos"
    assert initial_payload["samples_count"] == 3
    assert initial_payload["front_url"] is not None
    assert initial_payload["right_url"] is not None
    assert initial_payload["left_url"] is not None
    assert initial_payload["sample_urls"] == []
    assert initial_payload["cpf"] == build_valid_cpf(61)

    meal_entry = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert meal_entry.status_code == 201, meal_entry.text

    invalid_reenroll = client.post(
        f"/students/{student_id}/face-reenroll",
        headers=auth_headers(token),
        data={"mode": "three_photos"},
        files=[
            ("files", ("face-front.jpg", b"vector:1,0,0", "text/plain")),
            ("files", ("face-right.jpg", b"vector:0,1,0", "text/plain")),
        ],
    )
    assert invalid_reenroll.status_code == 400

    reenroll = client.post(
        f"/students/{student_id}/face-reenroll",
        headers=auth_headers(token),
        data={"mode": "three_photos"},
        files=[
            ("files", ("face-front.jpg", b"vector:0,1,0", "text/plain")),
            ("files", ("face-right.jpg", b"vector:0,1,0", "text/plain")),
            ("files", ("face-left.jpg", b"vector:0,1,0", "text/plain")),
        ],
    )
    assert reenroll.status_code == 200, reenroll.text

    identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0,1,0", "text/plain")},
    )
    assert identify.status_code == 200, identify.text
    assert identify.json()["status"] == "success"
    assert identify.json()["student"]["id"] == student_id

    with sqlite3.connect(database_file) as connection:
        row = connection.execute(
            """
            SELECT samples_count, source_image_path
            FROM face_embeddings
            WHERE student_id = ?
            """,
            (int(student_id),),
        ).fetchone()
    assert row is not None
    assert row[0] == 3
    assert row[1] == "1 ano/rec/aluno-recaptura-tres/left.jpg"

    entries_after = client.get("/meal-entries", headers=auth_headers(token))
    assert entries_after.status_code == 200, entries_after.text
    assert len(entries_after.json()) == 1
    assert entries_after.json()[0]["student_id"] == student_id

    front = photos_root / "1 ano" / "rec" / "aluno-recaptura-tres" / "front.jpg"
    right = photos_root / "1 ano" / "rec" / "aluno-recaptura-tres" / "right.jpg"
    left = photos_root / "1 ano" / "rec" / "aluno-recaptura-tres" / "left.jpg"
    assert front.exists()
    assert right.exists()
    assert left.exists()


def test_face_reenroll_hundred_photos_replaces_three_photos_set(
    client: TestClient, photos_root: Path, database_file: Path
) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="R100", school_year="2 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Recaptura Cem", "class_id": class_response["id"], "cpf": build_valid_cpf(62)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    for filename, payload in (
        ("face-front.jpg", b"vector:1,0,0"),
        ("face-right.jpg", b"vector:0,1,0"),
        ("face-left.jpg", b"vector:0,0,1"),
    ):
        enroll = client.post(
            f"/students/{student_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": (filename, payload, "text/plain")},
        )
        assert enroll.status_code == 200, enroll.text

    files_payload = []
    for cycle in range(1, 3):
        for index in range(1, 26):
            files_payload.append(
                (
                    "files",
                    (f"cycle-{cycle:02d}-{index:03d}.jpg", b"vector:1,0,0", "text/plain"),
                )
            )

    reenroll = client.post(
        f"/students/{student_id}/face-reenroll",
        headers=auth_headers(token),
        data={"mode": "hundred_photos"},
        files=files_payload,
    )
    assert reenroll.status_code == 200, reenroll.text

    with sqlite3.connect(database_file) as connection:
        row = connection.execute(
            """
            SELECT samples_count, source_image_path
            FROM face_embeddings
            WHERE student_id = ?
            """,
            (int(student_id),),
        ).fetchone()
    assert row is not None
    assert int(row[0]) == 50
    assert row[1] == "2 ano/r100/aluno-recaptura-cem/cycle-02-025.jpg"

    assets = client.get(f"/students/{student_id}/face-assets", headers=auth_headers(token))
    assert assets.status_code == 200, assets.text
    assets_payload = assets.json()
    assert assets_payload["mode_hint"] == "hundred_photos"
    assert assets_payload["samples_count"] == 50
    assert assets_payload["right_url"] is None
    assert assets_payload["left_url"] is None
    assert len(assets_payload["sample_urls"]) == 50

    cycle_first = photos_root / "2 ano" / "r100" / "aluno-recaptura-cem" / "cycle-01-001.jpg"
    cycle_last = photos_root / "2 ano" / "r100" / "aluno-recaptura-cem" / "cycle-02-025.jpg"
    old_right = photos_root / "2 ano" / "r100" / "aluno-recaptura-cem" / "right.jpg"
    old_left = photos_root / "2 ano" / "r100" / "aluno-recaptura-cem" / "left.jpg"
    assert cycle_first.exists()
    assert cycle_last.exists()
    assert not old_right.exists()
    assert not old_left.exists()


def test_legacy_media_migration_moves_to_name_folder_and_duplicates_sides(
    client: TestClient, photos_root: Path
) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="Mig", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Legado Midia", "class_id": class_response["id"], "cpf": build_valid_cpf(56)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-front.jpg", b"vector:1,0,0", "text/plain")},
    )
    assert enroll.status_code == 200, enroll.text

    container = client.app.state.container
    student_repo = container.student_repository
    class_repo = container.class_repository
    embedding_repo = container.face_embedding_repository
    settings_repo = container.app_settings_repository

    student = student_repo.get_by_id(student_id)
    assert student is not None
    class_record = class_repo.get_by_id(student.class_id)
    assert class_record is not None
    assert student.photo_path is not None

    legacy_relative_path = f"{class_record.school_year.value}/mig/{student_id}.jpg"
    source_path = photos_root / student.photo_path
    legacy_path = photos_root / legacy_relative_path
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.replace(legacy_path)

    updated_student = student_repo.update(
        student.model_copy(
            update={
                "media_folder": None,
                "photo_path": legacy_relative_path,
                "photo_right_path": None,
                "photo_left_path": None,
                "updated_at": datetime.now(UTC),
            }
        )
    )
    embedding = embedding_repo.get_by_student_id(student_id)
    assert embedding is not None
    embedding_repo.upsert(
        embedding.model_copy(
            update={
                "source_image_path": legacy_relative_path,
                "updated_at": datetime.now(UTC),
            }
        )
    )

    settings_repo.set_value("legacy_media_migration_v1_done", "pending")
    container.student_service.migrate_legacy_media_if_needed()

    migrated = student_repo.get_by_id(student_id)
    assert migrated is not None
    assert migrated.media_folder == "aluno-legado-midia"
    assert migrated.photo_path == "1 ano/mig/aluno-legado-midia/front.jpg"
    assert migrated.photo_right_path == "1 ano/mig/aluno-legado-midia/right.jpg"
    assert migrated.photo_left_path == "1 ano/mig/aluno-legado-midia/left.jpg"
    assert (photos_root / migrated.photo_path).exists()
    assert (photos_root / migrated.photo_right_path).exists()
    assert (photos_root / migrated.photo_left_path).exists()
    assert (photos_root / migrated.photo_path).read_bytes() == (photos_root / migrated.photo_right_path).read_bytes()
    assert (photos_root / migrated.photo_path).read_bytes() == (photos_root / migrated.photo_left_path).read_bytes()

    migrated_embedding = embedding_repo.get_by_student_id(student_id)
    assert migrated_embedding is not None
    assert migrated_embedding.source_image_path == "1 ano/mig/aluno-legado-midia/front.jpg"

    container.student_service.migrate_legacy_media_if_needed()
    migrated_again = student_repo.get_by_id(student_id)
    assert migrated_again is not None
    assert migrated_again.photo_path == migrated.photo_path
    assert migrated_again.photo_right_path == migrated.photo_right_path
    assert migrated_again.photo_left_path == migrated.photo_left_path


def test_face_enroll_unknown_pose_filename_uses_primary_fallback(client: TestClient, photos_root: Path) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="Q", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Fallback", "class_id": class_response["id"], "cpf": build_valid_cpf(4)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("captura-sem-pose.txt", b"vector:1,0", "text/plain")},
    )
    assert enroll.status_code == 200, enroll.text
    assert enroll.json()["student"]["photo_url"] == "/media/1%20ano/q/aluno-fallback/front.jpg"

    primary_photo_path = photos_root / "1 ano" / "q" / "aluno-fallback" / "front.jpg"
    assert primary_photo_path.exists()
    assert primary_photo_path.read_bytes() == b"vector:1,0"


def test_update_student_moves_front_right_and_left_images(client: TestClient, photos_root: Path) -> None:
    token = login(client, "diretor", "123456")
    class_origin = create_class(client, token, name="A", school_year="1 ano")
    class_target = create_class(client, token, name="B", school_year="1 ano")

    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Mudanca Turma", "class_id": class_origin["id"], "cpf": build_valid_cpf(5)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    for filename, payload in (
        ("face-front.txt", b"vector:1,0,0"),
        ("face-right.txt", b"vector:0,1,0"),
        ("face-left.txt", b"vector:0,0,1"),
    ):
        enroll = client.post(
            f"/students/{student_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": (filename, payload, "text/plain")},
        )
        assert enroll.status_code == 200, enroll.text

    original_front = photos_root / "1 ano" / "a" / "aluno-mudanca-turma" / "front.jpg"
    original_right = photos_root / "1 ano" / "a" / "aluno-mudanca-turma" / "right.jpg"
    original_left = photos_root / "1 ano" / "a" / "aluno-mudanca-turma" / "left.jpg"
    assert original_front.exists()
    assert original_right.exists()
    assert original_left.exists()

    update_response = client.patch(
        f"/students/{student_id}",
        headers=auth_headers(token),
        json={"class_id": class_target["id"]},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["photo_url"] == "/media/1%20ano/b/aluno-mudanca-turma/front.jpg"

    moved_front = photos_root / "1 ano" / "b" / "aluno-mudanca-turma" / "front.jpg"
    moved_right = photos_root / "1 ano" / "b" / "aluno-mudanca-turma" / "right.jpg"
    moved_left = photos_root / "1 ano" / "b" / "aluno-mudanca-turma" / "left.jpg"
    assert moved_front.exists()
    assert moved_right.exists()
    assert moved_left.exists()
    assert not original_front.exists()
    assert not original_right.exists()
    assert not original_left.exists()

    identify_after_move = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0.34,0.34,0.34", "text/plain")},
    )
    assert identify_after_move.status_code == 200, identify_after_move.text
    assert identify_after_move.json()["status"] == "success"
    assert identify_after_move.json()["student"]["id"] == student_id


def test_students_with_same_name_get_media_folder_suffix(client: TestClient, photos_root: Path) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="S", school_year="2 ano")

    first_student = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Nome Repetido", "class_id": class_response["id"], "cpf": build_valid_cpf(555)},
    )
    assert first_student.status_code == 201, first_student.text
    first_id = first_student.json()["id"]

    second_student = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Nome Repetido", "class_id": class_response["id"], "cpf": build_valid_cpf(556)},
    )
    assert second_student.status_code == 201, second_student.text
    second_id = second_student.json()["id"]

    first_enroll = client.post(
        f"/students/{first_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-front.txt", b"vector:1,0,0", "text/plain")},
    )
    assert first_enroll.status_code == 200, first_enroll.text

    second_enroll = client.post(
        f"/students/{second_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-front.txt", b"vector:0,1,0", "text/plain")},
    )
    assert second_enroll.status_code == 200, second_enroll.text

    first_path = photos_root / "2 ano" / "s" / "nome-repetido" / "front.jpg"
    second_path = photos_root / "2 ano" / "s" / "nome-repetido-1" / "front.jpg"
    assert first_path.exists()
    assert second_path.exists()

    assert first_enroll.json()["student"]["photo_url"] == "/media/2%20ano/s/nome-repetido/front.jpg"
    assert second_enroll.json()["student"]["photo_url"] == "/media/2%20ano/s/nome-repetido-1/front.jpg"


def test_identification_uses_score_gap_to_avoid_ambiguous_success(client: TestClient) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="D", school_year="1 ano")

    student_primary = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Principal", "class_id": class_response["id"], "cpf": build_valid_cpf(6)},
    )
    assert student_primary.status_code == 201, student_primary.text
    student_primary_id = student_primary.json()["id"]

    student_secondary = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Secundario", "class_id": class_response["id"], "cpf": build_valid_cpf(7)},
    )
    assert student_secondary.status_code == 201, student_secondary.text
    student_secondary_id = student_secondary.json()["id"]

    enroll_primary = client.post(
        f"/students/{student_primary_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-primary.txt", b"vector:1,0", "text/plain")},
    )
    assert enroll_primary.status_code == 200, enroll_primary.text

    enroll_secondary = client.post(
        f"/students/{student_secondary_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face-secondary.txt", b"vector:0.98,0.2", "text/plain")},
    )
    assert enroll_secondary.status_code == 200, enroll_secondary.text

    ambiguous_identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0.995,0.02", "text/plain")},
    )
    assert ambiguous_identify.status_code == 200
    payload = ambiguous_identify.json()
    assert payload["status"] in {"success", "low_confidence"}
    assert payload["student"] is not None
    assert payload["student"]["id"] == student_primary_id


def test_naogazei_like_profile_uses_aggressive_threshold(client: TestClient) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="Perfil", school_year="1 ano")
    student_a = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Perfil A", "class_id": class_response["id"], "cpf": build_valid_cpf(991)},
    )
    assert student_a.status_code == 201, student_a.text
    student_a_id = student_a.json()["id"]

    student_b = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Perfil B", "class_id": class_response["id"], "cpf": build_valid_cpf(992)},
    )
    assert student_b.status_code == 201, student_b.text
    student_b_id = student_b.json()["id"]

    assert (
        client.post(
            f"/students/{student_a_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": ("a.txt", b"vector:1,0", "text/plain")},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/students/{student_b_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": ("b.txt", b"vector:0.98,0.2", "text/plain")},
        ).status_code
        == 200
    )

    identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("query.txt", b"vector:0.995,0.02", "text/plain")},
    )
    assert identify.status_code == 200, identify.text
    payload = identify.json()
    assert payload["status"] == "success"
    assert payload["threshold"] == pytest.approx(0.4, rel=1e-3, abs=1e-3)


def test_naogazei_like_profile_keeps_centroid_candidates_without_samples(
    client: TestClient,
    database_file: Path,
) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="PerfilMix", school_year="1 ano")
    student_primary = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Centroide", "class_id": class_response["id"], "cpf": build_valid_cpf(993)},
    )
    assert student_primary.status_code == 201, student_primary.text
    primary_id = student_primary.json()["id"]

    student_secondary = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Samples", "class_id": class_response["id"], "cpf": build_valid_cpf(994)},
    )
    assert student_secondary.status_code == 201, student_secondary.text
    secondary_id = student_secondary.json()["id"]

    assert (
        client.post(
            f"/students/{primary_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": ("a.txt", b"vector:1,0", "text/plain")},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/students/{secondary_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": ("b.txt", b"vector:0,1", "text/plain")},
        ).status_code
        == 200
    )

    with sqlite3.connect(database_file) as connection:
        connection.execute(
            "DELETE FROM face_embedding_samples WHERE student_id = ?",
            (int(primary_id),),
        )
        connection.commit()

    identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("query.txt", b"vector:1,0", "text/plain")},
    )
    assert identify.status_code == 200, identify.text
    payload = identify.json()
    assert payload["status"] == "success"
    assert payload["student"] is not None
    assert payload["student"]["id"] == primary_id


def test_meal_entries_and_stats(client: TestClient) -> None:
    token = login(client, "diretor", "123456")

    coordinator_user = client.post(
        "/users",
        headers=auth_headers(token),
        json={
            "username": "coord_stats",
            "full_name": "Coordenadora Estatisticas",
            "password": "123456",
            "role": "coordenadora",
            "is_active": True,
        },
    )
    assert coordinator_user.status_code == 201, coordinator_user.text
    coordinator_token = login(client, "coord_stats", "123456")

    class_response = create_class(client, token, name="C", school_year="3 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Refeicao", "class_id": class_response["id"], "cpf": build_valid_cpf(8)},
    )
    student_id = student_response.json()["id"]

    enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face.txt", b"vector:1,0", "text/plain")},
    )
    assert enroll.status_code == 200, enroll.text

    identify_success = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
    )
    assert identify_success.status_code == 200
    assert identify_success.json()["status"] == "success"

    identify_not_found = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0,1", "text/plain")},
    )
    assert identify_not_found.status_code == 200
    assert identify_not_found.json()["status"] == "not_found"

    first_meal = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert first_meal.status_code == 201, first_meal.text
    assert first_meal.json()["class_display_name"] == "3 ano - C"

    duplicate_meal = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "manual"},
    )
    assert duplicate_meal.status_code == 409

    duplicate_detection = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        data={"meal_type": "almoco"},
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
    )
    assert duplicate_detection.status_code == 200
    duplicate_payload = duplicate_detection.json()
    assert duplicate_payload["status"] in {"success", "low_confidence"}
    assert duplicate_payload["already_recorded_today"] is True
    assert "almo" in duplicate_payload["already_recorded_message"].lower()

    no_rotation = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "sem_rodizio", "source": "manual"},
    )
    assert no_rotation.status_code == 201
    first_no_rotation_entry = no_rotation.json()

    duplicate_no_rotation_detection = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        data={"meal_type": "sem_rodizio"},
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
    )
    assert duplicate_no_rotation_detection.status_code == 200
    duplicate_no_rotation_payload = duplicate_no_rotation_detection.json()
    assert duplicate_no_rotation_payload["status"] in {"success", "low_confidence"}
    assert duplicate_no_rotation_payload["already_recorded_today"] is True
    assert "rod" in duplicate_no_rotation_payload["already_recorded_message"].lower()

    duplicate_no_rotation = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "sem_rodizio", "source": "manual"},
    )
    assert duplicate_no_rotation.status_code == 201
    assert duplicate_no_rotation.json()["id"] == first_no_rotation_entry["id"]

    list_entries = client.get("/meal-entries", headers=auth_headers(token))
    assert list_entries.status_code == 200
    assert len(list_entries.json()) == 2

    overview = client.get("/stats/overview", headers=auth_headers(token))
    assert overview.status_code == 200
    assert overview.json()["entries_today"] == 2
    assert overview.json()["entries_last_7_days"] == 2
    assert overview.json()["lunch_today"] == 1
    assert overview.json()["no_rotation_today"] == 1
    assert overview.json()["recognition_summary"] == {
        "success": 3,
        "low_confidence": 0,
        "not_found": 1,
    }

    coordinator_overview = client.get("/stats/overview", headers=auth_headers(coordinator_token))
    assert coordinator_overview.status_code == 200

    attendance_summary = client.get(f"/students/{student_id}/attendance-summary", headers=auth_headers(token))
    assert attendance_summary.status_code == 200
    attendance_payload = attendance_summary.json()
    assert attendance_payload["student"]["id"] == student_id
    assert attendance_payload["totals_by_meal"]["almoco"] == 1
    assert attendance_payload["totals_by_meal"]["sem_rodizio"] == 1
    assert attendance_payload["attendance_days"] >= 1
    assert len(attendance_payload["recent_entries"]) == 2

    coordinator_can_view_attendance = client.get(
        f"/students/{student_id}/attendance-summary",
        headers=auth_headers(coordinator_token),
    )
    assert coordinator_can_view_attendance.status_code == 200

    charts = client.get("/stats/charts", headers=auth_headers(token))
    assert charts.status_code == 200
    chart_payload = charts.json()
    assert any(point["label"] == "Almoço" for point in chart_payload["meal_breakdown"])
    assert any(point["label"] == "Sem rodízio" for point in chart_payload["meal_breakdown"])
    assert any(point["label"] == "3 ano - C" for point in chart_payload["class_breakdown"])
    assert any(point["label"] == "3 ano" for point in chart_payload["year_breakdown"])
    assert any(point["label"] == "Sucesso" for point in chart_payload["recognition_breakdown"])
    assert any(point["label"] == "Baixa confiança" for point in chart_payload["recognition_breakdown"])
    assert any(point["label"] == "Não encontrado" for point in chart_payload["recognition_breakdown"])

    filtered_charts = client.get("/stats/charts?meal_type=almoco", headers=auth_headers(token))
    assert filtered_charts.status_code == 200
    filtered_payload = filtered_charts.json()
    assert sum(point["value"] for point in filtered_payload["daily_entries"]) == 1

    delete_student = client.delete(f"/students/{student_id}", headers=auth_headers(token))
    assert delete_student.status_code == 204

    entries_after_delete = client.get("/meal-entries", headers=auth_headers(token))
    assert entries_after_delete.status_code == 200
    assert entries_after_delete.json() == []

    overview_after_delete = client.get("/stats/overview", headers=auth_headers(token))
    assert overview_after_delete.status_code == 200
    assert overview_after_delete.json()["entries_today"] == 0
    assert overview_after_delete.json()["entries_last_7_days"] == 0
    assert overview_after_delete.json()["recent_entries"] == []
    assert overview_after_delete.json()["recognition_summary"] == {
        "success": 0,
        "low_confidence": 0,
        "not_found": 0,
    }


def test_lunch_exception_source_and_recognition_regression(client: TestClient) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="EXC", school_year="2 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Excecao", "class_id": class_response["id"], "cpf": build_valid_cpf(91)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]
    student_cpf = build_valid_cpf(91)

    enroll = client.post(
        f"/students/{student_id}/face-enroll",
        headers=auth_headers(token),
        files={"file": ("face.txt", b"vector:1,0", "text/plain")},
    )
    assert enroll.status_code == 200, enroll.text

    identify = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:1,0", "text/plain")},
        data={"meal_type": "almoco"},
    )
    assert identify.status_code == 200, identify.text
    assert identify.json()["status"] in {"success", "low_confidence"}

    identify_by_cpf = client.post(
        "/recognition/identify-by-cpf",
        headers=auth_headers(token),
        json={"cpf": student_cpf, "meal_type": "almoco"},
    )
    assert identify_by_cpf.status_code == 200, identify_by_cpf.text
    assert identify_by_cpf.json()["status"] == "low_confidence"
    assert identify_by_cpf.json()["student"]["id"] == student_id

    create_exception_entry = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "excecao"},
    )
    assert create_exception_entry.status_code == 201, create_exception_entry.text
    assert create_exception_entry.json()["source"] == "excecao"

    duplicate_exception_entry = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "almoco", "source": "excecao"},
    )
    assert duplicate_exception_entry.status_code == 409


def test_delete_student_removes_all_saved_face_images(client: TestClient, photos_root: Path) -> None:
    token = login(client, "diretor", "123456")
    class_response = create_class(client, token, name="L", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Excluir Fotos", "class_id": class_response["id"], "cpf": build_valid_cpf(9)},
    )
    assert student_response.status_code == 201, student_response.text
    student_id = student_response.json()["id"]

    for filename, payload in (
        ("face-front.txt", b"vector:1,0,0"),
        ("face-right.txt", b"vector:0,1,0"),
        ("face-left.txt", b"vector:0,0,1"),
    ):
        enroll = client.post(
            f"/students/{student_id}/face-enroll",
            headers=auth_headers(token),
            files={"file": (filename, payload, "text/plain")},
        )
        assert enroll.status_code == 200, enroll.text

    front_path = photos_root / "1 ano" / "l" / "aluno-excluir-fotos" / "front.jpg"
    right_path = photos_root / "1 ano" / "l" / "aluno-excluir-fotos" / "right.jpg"
    left_path = photos_root / "1 ano" / "l" / "aluno-excluir-fotos" / "left.jpg"
    assert front_path.exists()
    assert right_path.exists()
    assert left_path.exists()

    delete_student = client.delete(f"/students/{student_id}", headers=auth_headers(token))
    assert delete_student.status_code == 204

    assert not front_path.exists()
    assert not right_path.exists()
    assert not left_path.exists()


def test_sem_rodizio_duplicate_is_idempotent(client: TestClient) -> None:
    token = login(client, "diretor", "123456")

    class_response = create_class(client, token, name="T", school_year="1 ano")
    student_response = client.post(
        "/students",
        headers=auth_headers(token),
        json={"full_name": "Aluno Idempotente", "class_id": class_response["id"], "cpf": build_valid_cpf(10)},
    )
    assert student_response.status_code == 201
    student_id = student_response.json()["id"]

    first = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "sem_rodizio", "source": "manual"},
    )
    assert first.status_code == 201

    second = client.post(
        "/meal-entries",
        headers=auth_headers(token),
        json={"student_id": student_id, "meal_type": "sem_rodizio", "source": "manual"},
    )
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]

    entries = client.get("/meal-entries", headers=auth_headers(token))
    assert entries.status_code == 200
    assert len(entries.json()) == 1


def test_sqlite_store_migrates_legacy_json_and_generates_missing_cpf(tmp_path: Path) -> None:
    database_path = tmp_path / "cantina.db"
    legacy_path = tmp_path / "legacy_store.json"
    original_cpf = build_valid_cpf(777)
    legacy_payload = {
        "version": 5,
        "users": [
            {
                "id": "user-legacy",
                "username": "diretor",
                "full_name": "Diretor Legado",
                "role": "diretor",
                "password_hash": hash_password("123456"),
                "is_active": True,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "roles": ["diretor", "coordenadora", "funcionario"],
        "classes": [
            {
                "id": "class-1",
                "name": "A",
                "school_year": "1 ano",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "students": [
            {
                "id": "student-1",
                "full_name": "ALUNO LEGADO",
                "class_id": "class-1",
                "cpf": original_cpf,
                "photo_path": None,
                "photo_right_path": None,
                "photo_left_path": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "id": "student-2",
                "full_name": "ALUNO SEM CPF",
                "class_id": "class-1",
                "cpf": None,
                "photo_path": None,
                "photo_right_path": None,
                "photo_left_path": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "face_embeddings": [],
        "meal_entries": [],
        "recognition_attempts": [],
    }
    legacy_path.write_text(json.dumps(legacy_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    store = SqliteStore(database_path)
    did_migrate = store.migrate_legacy_json_if_needed(legacy_path)

    assert did_migrate is True
    assert not legacy_path.exists()

    with sqlite3.connect(database_path) as connection:
        rows = connection.execute("SELECT cpf FROM students ORDER BY id ASC").fetchall()
    assert len(rows) == 2
    cpfs = [row[0] for row in rows]
    assert cpfs[0] == original_cpf
    assert cpfs[1] is not None and len(cpfs[1]) == 11 and cpfs[1] != original_cpf


def test_sqlite_store_migration_rolls_back_on_invalid_payload(tmp_path: Path) -> None:
    database_path = tmp_path / "cantina.db"
    legacy_path = tmp_path / "legacy_store.json"
    legacy_payload = {
        "version": 5,
        "users": [
            {
                "id": "user-1",
                "username": "diretor",
                "full_name": "Diretor",
                "role": "diretor",
                "password_hash": hash_password("123456"),
                "is_active": True,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "id": "user-2",
                "username": "diretor",
                "full_name": "Diretor Duplicado",
                "role": "diretor",
                "password_hash": hash_password("123456"),
                "is_active": True,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
        ],
        "roles": ["diretor", "coordenadora", "funcionario"],
        "classes": [],
        "students": [],
        "face_embeddings": [],
        "meal_entries": [],
        "recognition_attempts": [],
    }
    legacy_path.write_text(json.dumps(legacy_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    store = SqliteStore(database_path)
    with pytest.raises(sqlite3.IntegrityError):
        store.migrate_legacy_json_if_needed(legacy_path)

    assert legacy_path.exists()
    assert store.is_empty() is True


def test_sqlite_store_migrates_legacy_event_collections_to_json(tmp_path: Path) -> None:
    database_path = tmp_path / "cantina.db"
    legacy_path = tmp_path / "legacy_store.json"
    meal_entries_path = tmp_path / "meal_entries.json"
    recognition_attempts_path = tmp_path / "recognition_attempts.json"
    legacy_payload = {
        "version": 5,
        "users": [
            {
                "id": "user-legacy",
                "username": "diretor",
                "full_name": "Diretor Legado",
                "role": "diretor",
                "password_hash": hash_password("123456"),
                "is_active": True,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "roles": ["diretor", "coordenadora", "funcionario"],
        "classes": [
            {
                "id": "class-legacy",
                "name": "A",
                "school_year": "1 ano",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "students": [
            {
                "id": "student-legacy",
                "full_name": "ALUNO LEGADO",
                "class_id": "class-legacy",
                "cpf": build_valid_cpf(888),
                "photo_path": None,
                "photo_right_path": None,
                "photo_left_path": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "face_embeddings": [],
        "meal_entries": [
            {
                "id": "meal-legacy",
                "student_id": "student-legacy",
                "student_name": "ALUNO LEGADO",
                "class_id": "class-legacy",
                "class_name": "A",
                "class_display_name": "1 ano - A",
                "school_year": "1 ano",
                "meal_type": "almoco",
                "recorded_at": "2026-01-02T11:30:00+00:00",
                "recorded_by_user_id": "user-legacy",
                "recorded_by_name": "Diretor Legado",
                "source": "manual",
                "confidence": 0.98,
            }
        ],
        "recognition_attempts": [
            {
                "id": "attempt-legacy",
                "status": "success",
                "confidence": 0.98,
                "student_id": "student-legacy",
                "class_id": "class-legacy",
                "recorded_at": "2026-01-02T11:20:00+00:00",
            }
        ],
    }
    legacy_path.write_text(json.dumps(legacy_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    store = SqliteStore(database_path)
    meal_store = JsonCollectionStore(meal_entries_path)
    recognition_store = JsonCollectionStore(recognition_attempts_path)
    did_migrate = store.migrate_legacy_json_if_needed(
        legacy_path,
        meal_entries_store=meal_store,
        recognition_attempts_store=recognition_store,
    )

    assert did_migrate is True
    assert not legacy_path.exists()

    meal_entries = meal_store.read()
    recognition_attempts = recognition_store.read()
    assert len(meal_entries) == 1
    assert len(recognition_attempts) == 1
    assert meal_entries[0]["id"] == "1"
    assert meal_entries[0]["student_id"] == "1"
    assert meal_entries[0]["recorded_by_user_id"] == "1"
    assert recognition_attempts[0]["id"] == "1"
    assert recognition_attempts[0]["student_id"] == "1"
    assert recognition_attempts[0]["class_id"] == "1"


def test_sqlite_store_migrates_event_tables_to_json_and_drops_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "cantina.db"
    meal_entries_path = tmp_path / "meal_entries.json"
    recognition_attempts_path = tmp_path / "recognition_attempts.json"
    store = SqliteStore(database_path)

    with store.connect() as connection:
        connection.executescript(
            """
            CREATE TABLE meal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                class_id INTEGER NOT NULL,
                class_name TEXT NOT NULL,
                class_display_name TEXT NOT NULL,
                school_year TEXT NOT NULL,
                meal_type TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                recorded_by_user_id INTEGER NOT NULL,
                recorded_by_name TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL
            );

            CREATE TABLE recognition_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,
                confidence REAL,
                student_id INTEGER,
                class_id INTEGER,
                recorded_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            """
            INSERT INTO meal_entries (
                student_id,
                student_name,
                class_id,
                class_name,
                class_display_name,
                school_year,
                meal_type,
                recorded_at,
                recorded_by_user_id,
                recorded_by_name,
                source,
                confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                10,
                "ALUNO TESTE",
                20,
                "A",
                "1 ano - A",
                "1 ano",
                "almoco",
                "2026-01-03T11:30:00+00:00",
                30,
                "Diretor",
                "manual",
                0.99,
            ),
        )
        connection.execute(
            """
            INSERT INTO recognition_attempts (status, confidence, student_id, class_id, recorded_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("success", 0.99, 10, 20, "2026-01-03T11:20:00+00:00"),
        )
        connection.commit()

    meal_store = JsonCollectionStore(meal_entries_path)
    recognition_store = JsonCollectionStore(recognition_attempts_path)
    did_migrate = store.migrate_event_tables_to_json_if_needed(
        meal_entries_store=meal_store,
        recognition_attempts_store=recognition_store,
    )

    assert did_migrate is True
    assert meal_store.read() == [
        {
            "id": "1",
            "student_id": "10",
            "student_name": "ALUNO TESTE",
            "class_id": "20",
            "class_name": "A",
            "class_display_name": "1 ano - A",
            "school_year": "1 ano",
            "meal_type": "almoco",
            "recorded_at": "2026-01-03T11:30:00+00:00",
            "recorded_by_user_id": "30",
            "recorded_by_name": "Diretor",
            "source": "manual",
            "confidence": 0.99,
        }
    ]
    assert recognition_store.read() == [
        {
            "id": "1",
            "status": "success",
            "confidence": 0.99,
            "student_id": "10",
            "class_id": "20",
            "recorded_at": "2026-01-03T11:20:00+00:00",
        }
    ]

    with sqlite3.connect(database_path) as connection:
        meal_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meal_entries'"
        ).fetchone()
        recognition_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recognition_attempts'"
        ).fetchone()

    assert meal_table is None
    assert recognition_table is None


def test_sqlite_store_event_table_migration_rolls_back_drop_on_json_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "cantina.db"
    meal_entries_path = tmp_path / "meal_entries.json"
    recognition_attempts_path = tmp_path / "recognition_attempts.json"
    store = SqliteStore(database_path)

    with store.connect() as connection:
        connection.executescript(
            """
            CREATE TABLE meal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                class_id INTEGER NOT NULL,
                class_name TEXT NOT NULL,
                class_display_name TEXT NOT NULL,
                school_year TEXT NOT NULL,
                meal_type TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                recorded_by_user_id INTEGER NOT NULL,
                recorded_by_name TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL
            );
            """
        )
        connection.execute(
            """
            INSERT INTO meal_entries (
                student_id,
                student_name,
                class_id,
                class_name,
                class_display_name,
                school_year,
                meal_type,
                recorded_at,
                recorded_by_user_id,
                recorded_by_name,
                source,
                confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                10,
                "ALUNO TESTE",
                20,
                "A",
                "1 ano - A",
                "1 ano",
                "almoco",
                "2026-01-03T11:30:00+00:00",
                30,
                "Diretor",
                "manual",
                0.99,
            ),
        )
        connection.commit()

    meal_store = JsonCollectionStore(meal_entries_path)
    recognition_store = JsonCollectionStore(recognition_attempts_path)

    def fail_write(_: list[dict]) -> None:
        raise OSError("write failed")

    monkeypatch.setattr(meal_store, "write", fail_write)

    with pytest.raises(OSError):
        store.migrate_event_tables_to_json_if_needed(
            meal_entries_store=meal_store,
            recognition_attempts_store=recognition_store,
        )

    with sqlite3.connect(database_path) as connection:
        meal_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meal_entries'"
        ).fetchone()
        meal_count = connection.execute("SELECT COUNT(1) FROM meal_entries").fetchone()

    assert meal_table is not None
    assert meal_count is not None and int(meal_count[0]) == 1


def test_sqlite_store_event_table_migration_blocks_drop_when_json_diverges(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "cantina.db"
    meal_entries_path = tmp_path / "meal_entries.json"
    recognition_attempts_path = tmp_path / "recognition_attempts.json"
    store = SqliteStore(database_path)

    with store.connect() as connection:
        connection.executescript(
            """
            CREATE TABLE meal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                class_id INTEGER NOT NULL,
                class_name TEXT NOT NULL,
                class_display_name TEXT NOT NULL,
                school_year TEXT NOT NULL,
                meal_type TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                recorded_by_user_id INTEGER NOT NULL,
                recorded_by_name TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL
            );
            """
        )
        connection.commit()

    meal_store = JsonCollectionStore(meal_entries_path)
    recognition_store = JsonCollectionStore(recognition_attempts_path)
    meal_store.write(
        [
            {
                "id": "1",
                "student_id": "999",
                "student_name": "DADO ANTIGO",
                "class_id": "999",
                "class_name": "X",
                "class_display_name": "1 ano - X",
                "school_year": "1 ano",
                "meal_type": "almoco",
                "recorded_at": "2026-01-01T00:00:00+00:00",
                "recorded_by_user_id": "1",
                "recorded_by_name": "Diretor",
                "source": "manual",
                "confidence": 0.1,
            }
        ]
    )

    with pytest.raises(ValueError):
        store.migrate_event_tables_to_json_if_needed(
            meal_entries_store=meal_store,
            recognition_attempts_store=recognition_store,
        )

    with sqlite3.connect(database_path) as connection:
        meal_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meal_entries'"
        ).fetchone()

    assert meal_table is not None


def test_settings_rejects_unsafe_defaults_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANTINA_APP_ENV", "production")
    monkeypatch.setenv("CANTINA_SECRET_KEY", "troque-esta-chave-em-producao")
    monkeypatch.setenv("CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD", "123456")

    with pytest.raises(ValidationError):
        Settings()


def test_bootstrap_director_recovers_existing_inactive_non_director(tmp_path: Path) -> None:
    store = SqliteStore(tmp_path / "store.db")
    user_repository = SqliteUserRepository(store)
    role_repository = StaticRoleRepository()
    service = UserService(user_repository, role_repository)

    existing = UserRecord(
        id="bootstrap-user",
        username="diretor",
        full_name="Usuario Antigo",
        role=UserRole.funcionario,
        password_hash=hash_password("senha-antiga"),
        is_active=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    user_repository.create(existing)

    recovered = service.ensure_bootstrap_director(
        username="diretor",
        password="nova-senha-123",
        full_name="Diretor Recuperado",
    )

    assert recovered.role == UserRole.diretor
    assert recovered.is_active is True
    assert recovered.full_name == "Diretor Recuperado"

    persisted = user_repository.get_by_username("diretor")
    assert persisted is not None
    assert verify_password("nova-senha-123", persisted.password_hash)
