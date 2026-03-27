from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterator


class JsonStore:
    """Small JSON-backed store for local development and demo usage."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.write(self.default_payload())

    @staticmethod
    def default_payload() -> dict[str, Any]:
        return {
            "version": 5,
            "users": [],
            "roles": ["diretor", "coordenadora", "funcionario"],
            "classes": [],
            "students": [],
            "face_embeddings": [],
            "meal_entries": [],
            "recognition_attempts": [],
        }

    def read(self) -> dict[str, Any]:
        with self._lock:
            return self._read_unlocked()

    def write(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_unlocked(payload)

    @contextmanager
    def edit(self) -> Iterator[dict[str, Any]]:
        with self._lock:
            payload = self._read_unlocked()
            yield payload
            self._write_unlocked(payload)

    def _read_unlocked(self) -> dict[str, Any]:
        if not self.path.exists():
            return self.default_payload()

        with self.path.open("r", encoding="utf-8") as file:
            payload = json.load(file)

        payload = self._migrate_payload(payload)
        defaults = self.default_payload()
        for key, value in defaults.items():
            payload.setdefault(key, value)
        return payload

    def _write_unlocked(self, payload: dict[str, Any]) -> None:
        with self.path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _migrate_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        version = int(payload.get("version", 1))
        if version < 2:
            for class_item in payload.get("classes", []):
                class_item.setdefault("school_year", "1 ano")
            for entry in payload.get("meal_entries", []):
                if entry.get("meal_type") == "consulta":
                    entry["meal_type"] = "sem_rodizio"
            payload.setdefault("recognition_attempts", [])
            payload["version"] = 2
            version = 2
        if version < 3:
            roles = payload.setdefault("roles", [])
            if "diretor" not in roles:
                roles.append("diretor")
            if "coordenadora" not in roles:
                roles.append("coordenadora")
            if "funcionario" not in roles:
                roles.append("funcionario")
            payload["version"] = 3
            version = 3
        if version < 4:
            for student in payload.get("students", []):
                student.setdefault("photo_right_path", None)
                student.setdefault("photo_left_path", None)
            payload["version"] = 4
            version = 4
        if version < 5:
            for student in payload.get("students", []):
                student.setdefault("cpf", None)
            payload["version"] = 5
        return payload
