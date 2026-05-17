from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterator

from app.core.cpf import is_valid_cpf, normalize_cpf

if TYPE_CHECKING:
    from app.adapters.persistence.json_collection_store import JsonCollectionStore


def parse_datetime(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if not value:
        return datetime.now(UTC)
    normalized = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def format_datetime(value: datetime | str | None) -> str:
    parsed = parse_datetime(value)
    return parsed.astimezone(UTC).isoformat()


def parse_db_id(raw_value: str | int | None) -> int | None:
    if raw_value is None:
        return None
    try:
        return int(str(raw_value))
    except (TypeError, ValueError):
        return None


def format_api_id(raw_value: int | str | None) -> str:
    if raw_value is None:
        return ""
    return str(raw_value)


class SqliteStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.bootstrap_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            connection.close()

    def bootstrap_schema(self) -> None:
        with self.connect() as connection:
            cursor = connection.cursor()
            cursor.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS classes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    school_year TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(name, school_year)
                );

                CREATE TABLE IF NOT EXISTS students (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_name TEXT NOT NULL,
                    class_id INTEGER NOT NULL,
                    cpf TEXT NOT NULL UNIQUE,
                    media_folder TEXT,
                    photo_path TEXT,
                    photo_right_path TEXT,
                    photo_left_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS face_embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id INTEGER NOT NULL UNIQUE,
                    engine TEXT NOT NULL,
                    vector_json TEXT NOT NULL,
                    samples_count INTEGER NOT NULL DEFAULT 1,
                    source_image_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS face_embedding_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id INTEGER NOT NULL,
                    engine TEXT NOT NULL,
                    vector_json TEXT NOT NULL,
                    source_image_path TEXT NOT NULL,
                    quality_score REAL NOT NULL DEFAULT 0.0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(student_id, source_image_path),
                    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_students_cpf ON students(cpf);
                CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
                CREATE INDEX IF NOT EXISTS idx_face_embedding_samples_student_id ON face_embedding_samples(student_id);
                CREATE INDEX IF NOT EXISTS idx_face_embedding_samples_quality ON face_embedding_samples(quality_score);

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._ensure_students_media_folder_column(cursor)
            cursor.execute(
                """
                INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                ("registration_capture_mode", "hundred_photos", format_datetime(datetime.now(UTC))),
            )
            connection.commit()

    @staticmethod
    def _ensure_students_media_folder_column(cursor: sqlite3.Cursor) -> None:
        columns = cursor.execute("PRAGMA table_info(students)").fetchall()
        column_names = {str(column["name"]) for column in columns}
        if "media_folder" in column_names:
            return
        cursor.execute("ALTER TABLE students ADD COLUMN media_folder TEXT")

    def is_empty(self) -> bool:
        with self.connect() as connection:
            cursor = connection.cursor()
            for table_name in ("users", "classes", "students", "face_embeddings"):
                row = cursor.execute(f"SELECT COUNT(1) AS total FROM {table_name}").fetchone()
                if row and int(row["total"]) > 0:
                    return False
        return True

    def migrate_legacy_json_if_needed(
        self,
        legacy_path: Path,
        *,
        meal_entries_store: JsonCollectionStore | None = None,
        recognition_attempts_store: JsonCollectionStore | None = None,
        keep_backup: bool = False,
    ) -> bool:
        if not legacy_path.exists() or not self.is_empty():
            return False

        payload = json.loads(legacy_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Arquivo legado inválido: payload deve ser um objeto JSON.")

        has_event_data = bool(payload.get("meal_entries")) or bool(payload.get("recognition_attempts"))
        if has_event_data and (meal_entries_store is None or recognition_attempts_store is None):
            raise ValueError("A migração legada exige stores JSON para meal_entries e recognition_attempts.")

        meal_entries_snapshot, recognition_attempts_snapshot = self._migrate_payload(payload)

        if meal_entries_store is not None:
            self._sync_collection_with_export(
                store=meal_entries_store,
                exported_items=meal_entries_snapshot,
                collection_name="meal_entries",
            )
        if recognition_attempts_store is not None:
            self._sync_collection_with_export(
                store=recognition_attempts_store,
                exported_items=recognition_attempts_snapshot,
                collection_name="recognition_attempts",
            )

        backup_path = legacy_path.with_suffix(".json.bak")
        if keep_backup:
            backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        legacy_path.unlink(missing_ok=True)
        return True

    def migrate_event_tables_to_json_if_needed(
        self,
        *,
        meal_entries_store: JsonCollectionStore,
        recognition_attempts_store: JsonCollectionStore,
    ) -> bool:
        with self.connect() as connection:
            cursor = connection.cursor()
            has_meal_entries = self._table_exists(cursor, "meal_entries")
            has_recognition_attempts = self._table_exists(cursor, "recognition_attempts")
            if not has_meal_entries and not has_recognition_attempts:
                return False

            meal_entries_snapshot = self._load_meal_entries_from_db(cursor) if has_meal_entries else []
            recognition_attempts_snapshot = (
                self._load_recognition_attempts_from_db(cursor) if has_recognition_attempts else []
            )

        self._sync_collection_with_export(
            store=meal_entries_store,
            exported_items=meal_entries_snapshot,
            collection_name="meal_entries",
        )
        self._sync_collection_with_export(
            store=recognition_attempts_store,
            exported_items=recognition_attempts_snapshot,
            collection_name="recognition_attempts",
        )

        with self.connect() as connection:
            cursor = connection.cursor()
            if has_meal_entries:
                cursor.execute("DROP TABLE IF EXISTS meal_entries")
            if has_recognition_attempts:
                cursor.execute("DROP TABLE IF EXISTS recognition_attempts")
            connection.commit()
        return True

    @staticmethod
    def _table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
        row = cursor.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name = ?
            """,
            (table_name,),
        ).fetchone()
        return row is not None

    def _load_meal_entries_from_db(self, cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
        rows = cursor.execute(
            """
            SELECT
                id,
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
            FROM meal_entries
            ORDER BY id ASC
            """
        ).fetchall()
        return [
            {
                "id": format_api_id(row["id"]),
                "student_id": format_api_id(row["student_id"]),
                "student_name": str(row["student_name"] or ""),
                "class_id": format_api_id(row["class_id"]),
                "class_name": str(row["class_name"] or ""),
                "class_display_name": str(row["class_display_name"] or ""),
                "school_year": str(row["school_year"] or "1 ano"),
                "meal_type": str(row["meal_type"] or "almoco"),
                "recorded_at": format_datetime(row["recorded_at"]),
                "recorded_by_user_id": format_api_id(row["recorded_by_user_id"]),
                "recorded_by_name": str(row["recorded_by_name"] or ""),
                "source": str(row["source"] or "manual"),
                "confidence": row["confidence"],
            }
            for row in rows
        ]

    def _load_recognition_attempts_from_db(self, cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
        rows = cursor.execute(
            """
            SELECT
                id,
                status,
                confidence,
                student_id,
                class_id,
                recorded_at
            FROM recognition_attempts
            ORDER BY id ASC
            """
        ).fetchall()
        return [
            {
                "id": format_api_id(row["id"]),
                "status": str(row["status"] or "not_found"),
                "confidence": row["confidence"],
                "student_id": format_api_id(row["student_id"]) if row["student_id"] is not None else None,
                "class_id": format_api_id(row["class_id"]) if row["class_id"] is not None else None,
                "recorded_at": format_datetime(row["recorded_at"]),
            }
            for row in rows
        ]

    def _sync_collection_with_export(
        self,
        *,
        store: JsonCollectionStore,
        exported_items: list[dict[str, Any]],
        collection_name: str,
    ) -> None:
        current_items = store.read()
        if not current_items:
            store.write(exported_items)
            current_items = store.read()

        if not self._is_same_snapshot(current_items, exported_items):
            raise ValueError(
                f"Não foi possível migrar {collection_name}: o JSON já possui dados diferentes do snapshot exportado."
            )

    @staticmethod
    def _is_same_snapshot(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> bool:
        if len(left) != len(right):
            return False
        left_map = {str(item.get("id", "")): item for item in left}
        right_map = {str(item.get("id", "")): item for item in right}
        if len(left_map) != len(left) or len(right_map) != len(right):
            return False
        return left_map == right_map

    def _migrate_payload(self, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        user_map: dict[str, str] = {}
        class_map: dict[str, str] = {}
        student_map: dict[str, str] = {}
        used_cpfs: set[str] = set()
        cpf_seed = 1
        meal_entries_snapshot: list[dict[str, Any]] = []
        recognition_attempts_snapshot: list[dict[str, Any]] = []

        with self.connect() as connection:
            cursor = connection.cursor()
            try:
                for user_item in payload.get("users", []):
                    username = str(user_item.get("username", "")).strip()
                    if not username:
                        continue
                    role = str(user_item.get("role", "funcionario")).strip() or "funcionario"
                    full_name = str(user_item.get("full_name", username)).strip() or username
                    password_hash = str(user_item.get("password_hash", "")).strip()
                    if not password_hash:
                        continue
                    created_at = format_datetime(user_item.get("created_at"))
                    updated_at = format_datetime(user_item.get("updated_at"))
                    is_active = 1 if bool(user_item.get("is_active", True)) else 0
                    inserted = cursor.execute(
                        """
                        INSERT INTO users (
                            username,
                            full_name,
                            role,
                            password_hash,
                            is_active,
                            created_at,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (username, full_name, role, password_hash, is_active, created_at, updated_at),
                    )
                    legacy_id = str(user_item.get("id", ""))
                    if legacy_id:
                        user_map[legacy_id] = format_api_id(inserted.lastrowid)

                for class_item in payload.get("classes", []):
                    class_name = str(class_item.get("name", "")).strip()
                    school_year = str(class_item.get("school_year", "")).strip()
                    if not class_name or not school_year:
                        continue
                    created_at = format_datetime(class_item.get("created_at"))
                    updated_at = format_datetime(class_item.get("updated_at"))
                    inserted = cursor.execute(
                        """
                        INSERT OR IGNORE INTO classes (name, school_year, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (class_name, school_year, created_at, updated_at),
                    )
                    if inserted.lastrowid:
                        class_db_id = format_api_id(inserted.lastrowid)
                    else:
                        existing = cursor.execute(
                            "SELECT id FROM classes WHERE name = ? AND school_year = ?",
                            (class_name, school_year),
                        ).fetchone()
                        if not existing:
                            continue
                        class_db_id = format_api_id(existing["id"])
                    legacy_id = str(class_item.get("id", ""))
                    if legacy_id:
                        class_map[legacy_id] = class_db_id

                for student_item in payload.get("students", []):
                    full_name = str(student_item.get("full_name", "")).strip()
                    if not full_name:
                        continue
                    class_db_id = class_map.get(str(student_item.get("class_id", "")))
                    if not class_db_id:
                        continue
                    cpf_value = str(student_item.get("cpf", "")).strip()
                    normalized_cpf = normalize_cpf(cpf_value) if cpf_value else ""
                    if (
                        not normalized_cpf
                        or not is_valid_cpf(normalized_cpf)
                        or normalized_cpf in used_cpfs
                    ):
                        normalized_cpf, cpf_seed = generate_temp_cpf(used_cpfs, cpf_seed)
                    else:
                        used_cpfs.add(normalized_cpf)
                    created_at = format_datetime(student_item.get("created_at"))
                    updated_at = format_datetime(student_item.get("updated_at"))
                    inserted = cursor.execute(
                        """
                        INSERT INTO students (
                            full_name,
                            class_id,
                            cpf,
                            photo_path,
                            photo_right_path,
                            photo_left_path,
                            created_at,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            full_name,
                            int(class_db_id),
                            normalized_cpf,
                            student_item.get("photo_path"),
                            student_item.get("photo_right_path"),
                            student_item.get("photo_left_path"),
                            created_at,
                            updated_at,
                        ),
                    )
                    legacy_id = str(student_item.get("id", ""))
                    if legacy_id:
                        student_map[legacy_id] = format_api_id(inserted.lastrowid)

                for embedding_item in payload.get("face_embeddings", []):
                    student_db_id = student_map.get(str(embedding_item.get("student_id", "")))
                    if not student_db_id:
                        continue
                    vector = embedding_item.get("vector", [])
                    vector_json = json.dumps(vector if isinstance(vector, list) else [])
                    created_at = format_datetime(embedding_item.get("created_at"))
                    updated_at = format_datetime(embedding_item.get("updated_at"))
                    cursor.execute(
                        """
                        INSERT INTO face_embeddings (
                            student_id,
                            engine,
                            vector_json,
                            samples_count,
                            source_image_path,
                            created_at,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            int(student_db_id),
                            str(embedding_item.get("engine", "mock")),
                            vector_json,
                            int(embedding_item.get("samples_count", 1) or 1),
                            embedding_item.get("source_image_path"),
                            created_at,
                            updated_at,
                        ),
                    )

                for entry_item in payload.get("meal_entries", []):
                    student_db_id = student_map.get(str(entry_item.get("student_id", "")))
                    class_db_id = class_map.get(str(entry_item.get("class_id", "")))
                    recorded_by_db_id = user_map.get(str(entry_item.get("recorded_by_user_id", "")))
                    if not student_db_id or not class_db_id or not recorded_by_db_id:
                        continue
                    meal_entries_snapshot.append(
                        {
                            "id": str(len(meal_entries_snapshot) + 1),
                            "student_id": student_db_id,
                            "student_name": str(entry_item.get("student_name", "")),
                            "class_id": class_db_id,
                            "class_name": str(entry_item.get("class_name", "")),
                            "class_display_name": str(entry_item.get("class_display_name", "")),
                            "school_year": str(entry_item.get("school_year", "1 ano")),
                            "meal_type": str(entry_item.get("meal_type", "almoco")),
                            "recorded_at": format_datetime(entry_item.get("recorded_at")),
                            "recorded_by_user_id": recorded_by_db_id,
                            "recorded_by_name": str(entry_item.get("recorded_by_name", "")),
                            "source": str(entry_item.get("source", "manual")),
                            "confidence": entry_item.get("confidence"),
                        }
                    )

                for attempt_item in payload.get("recognition_attempts", []):
                    student_db_id = student_map.get(str(attempt_item.get("student_id", "")))
                    class_db_id = class_map.get(str(attempt_item.get("class_id", "")))
                    recognition_attempts_snapshot.append(
                        {
                            "id": str(len(recognition_attempts_snapshot) + 1),
                            "status": str(attempt_item.get("status", "not_found")),
                            "confidence": attempt_item.get("confidence"),
                            "student_id": student_db_id,
                            "class_id": class_db_id,
                            "recorded_at": format_datetime(attempt_item.get("recorded_at")),
                        }
                    )

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return meal_entries_snapshot, recognition_attempts_snapshot


def calculate_check_digit(base_value: str, *, start_factor: int) -> int:
    total = sum(int(char) * factor for char, factor in zip(base_value, range(start_factor, 1, -1), strict=True))
    remainder = total % 11
    return 0 if remainder < 2 else 11 - remainder


def build_valid_cpf(seed: int) -> str:
    first_nine = f"{seed:09d}"
    first_digit = calculate_check_digit(first_nine, start_factor=10)
    second_digit = calculate_check_digit(f"{first_nine}{first_digit}", start_factor=11)
    return f"{first_nine}{first_digit}{second_digit}"


def generate_temp_cpf(used_cpfs: set[str], seed: int) -> tuple[str, int]:
    next_seed = seed
    while True:
        candidate = build_valid_cpf(next_seed)
        next_seed += 1
        if candidate in used_cpfs:
            continue
        used_cpfs.add(candidate)
        return candidate, next_seed
