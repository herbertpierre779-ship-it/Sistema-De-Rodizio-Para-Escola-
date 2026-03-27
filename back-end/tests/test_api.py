from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.persistence.json_repositories import JsonUserRepository, StaticRoleRepository
from app.adapters.persistence.json_store import JsonStore
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
    assert enrolled_student["photo_url"] == f"/media/1%20ano/a/{student_id}.jpg"

    expected_photo_path = photos_root / "1 ano" / "a" / f"{student_id}.jpg"
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
    assert low_confidence.json()["status"] == "low_confidence"

    not_found = client.post(
        "/recognition/identify",
        headers=auth_headers(token),
        files={"file": ("identify.txt", b"vector:0,1", "text/plain")},
    )
    assert not_found.status_code == 200
    assert not_found.json()["status"] == "not_found"


def test_face_enroll_uses_three_samples_for_embedding_average(
    client: TestClient, tmp_path: Path, photos_root: Path
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

    primary_photo_path = photos_root / "1 ano" / "m" / f"{student_id}.jpg"
    right_photo_path = photos_root / "1 ano" / "m" / f"{student_id}-right.jpg"
    left_photo_path = photos_root / "1 ano" / "m" / f"{student_id}-left.jpg"
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

    store_payload = json.loads((tmp_path / "dev_store.json").read_text(encoding="utf-8"))
    embeddings = store_payload["face_embeddings"]
    assert len(embeddings) == 1
    assert embeddings[0]["student_id"] == student_id
    assert embeddings[0]["samples_count"] == 3
    assert embeddings[0]["source_image_path"] == f"1 ano/m/{student_id}-left.jpg"
    assert len(embeddings[0]["vector"]) == 128
    assert all(value == pytest.approx(1 / 3, rel=1e-3, abs=1e-3) for value in embeddings[0]["vector"][:3])


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
    assert enroll.json()["student"]["photo_url"] == f"/media/1%20ano/q/{student_id}.jpg"

    primary_photo_path = photos_root / "1 ano" / "q" / f"{student_id}.jpg"
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

    original_front = photos_root / "1 ano" / "a" / f"{student_id}.jpg"
    original_right = photos_root / "1 ano" / "a" / f"{student_id}-right.jpg"
    original_left = photos_root / "1 ano" / "a" / f"{student_id}-left.jpg"
    assert original_front.exists()
    assert original_right.exists()
    assert original_left.exists()

    update_response = client.patch(
        f"/students/{student_id}",
        headers=auth_headers(token),
        json={"class_id": class_target["id"]},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["photo_url"] == f"/media/1%20ano/b/{student_id}.jpg"

    moved_front = photos_root / "1 ano" / "b" / f"{student_id}.jpg"
    moved_right = photos_root / "1 ano" / "b" / f"{student_id}-right.jpg"
    moved_left = photos_root / "1 ano" / "b" / f"{student_id}-left.jpg"
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
    assert payload["status"] == "low_confidence"
    assert payload["student"] is not None
    assert payload["student"]["id"] == student_primary_id


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

    coordinator_cannot_view_attendance = client.get(
        f"/students/{student_id}/attendance-summary",
        headers=auth_headers(coordinator_token),
    )
    assert coordinator_cannot_view_attendance.status_code == 403

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

    front_path = photos_root / "1 ano" / "l" / f"{student_id}.jpg"
    right_path = photos_root / "1 ano" / "l" / f"{student_id}-right.jpg"
    left_path = photos_root / "1 ano" / "l" / f"{student_id}-left.jpg"
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


def test_json_store_migration_v4_adds_cpf_field(tmp_path: Path) -> None:
    store_path = tmp_path / "legacy_store.json"
    legacy_payload = {
        "version": 4,
        "users": [],
        "roles": ["diretor", "coordenadora", "funcionario"],
        "classes": [],
        "students": [
            {
                "id": "student-1",
                "full_name": "ALUNO LEGADO",
                "class_id": "class-1",
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
    store_path.write_text(json.dumps(legacy_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    store = JsonStore(store_path)
    migrated = store.read()
    assert migrated["version"] == 5
    assert migrated["students"][0]["cpf"] is None


def test_settings_rejects_unsafe_defaults_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANTINA_APP_ENV", "production")
    monkeypatch.setenv("CANTINA_SECRET_KEY", "troque-esta-chave-em-producao")
    monkeypatch.setenv("CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD", "123456")

    with pytest.raises(ValidationError):
        Settings()


def test_bootstrap_director_recovers_existing_inactive_non_director(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store.json")
    user_repository = JsonUserRepository(store)
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
