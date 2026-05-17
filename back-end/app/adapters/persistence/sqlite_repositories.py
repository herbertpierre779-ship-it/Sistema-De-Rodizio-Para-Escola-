from __future__ import annotations

import json
from datetime import UTC, datetime

from app.adapters.persistence.sqlite_store import (
    SqliteStore,
    format_api_id,
    format_datetime,
    parse_datetime,
    parse_db_id,
)
from app.models.entities import (
    ClassRecord,
    FaceEmbeddingRecord,
    FaceEmbeddingSampleRecord,
    MealEntryRecord,
    RecognitionAttemptRecord,
    SchoolYear,
    StudentRecord,
    UserRecord,
    UserRole,
)
from app.repositories.contracts import (
    AppSettingsRepository,
    ClassRepository,
    FaceEmbeddingRepository,
    FaceEmbeddingSampleRepository,
    MealEntryFilters,
    MealEntryRepository,
    RecognitionAttemptRepository,
    RoleRepository,
    StudentRepository,
    UserRepository,
)


class StaticRoleRepository(RoleRepository):
    def list_roles(self) -> list[UserRole]:
        return [UserRole.diretor, UserRole.coordenadora, UserRole.funcionario]

    def exists(self, role: UserRole) -> bool:
        return role in self.list_roles()


class SqliteAppSettingsRepository(AppSettingsRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def get_value(self, key: str) -> str | None:
        with self.store.connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_settings WHERE key = ?",
                (key,),
            ).fetchone()
        if not row:
            return None
        return str(row["value"])

    def set_value(self, key: str, value: str) -> None:
        with self.store.connect() as connection:
            connection.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, value, format_datetime(datetime.now(UTC))),
            )
            connection.commit()


class SqliteUserRepository(UserRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_users(self) -> list[UserRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, username, full_name, role, password_hash, is_active, created_at, updated_at
                FROM users
                """
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def get_by_id(self, user_id: str) -> UserRecord | None:
        parsed_id = parse_db_id(user_id)
        if parsed_id is None:
            return None
        with self.store.connect() as connection:
            row = connection.execute(
                """
                SELECT id, username, full_name, role, password_hash, is_active, created_at, updated_at
                FROM users
                WHERE id = ?
                """,
                (parsed_id,),
            ).fetchone()
        return self._to_record(row) if row else None

    def get_by_username(self, username: str) -> UserRecord | None:
        normalized = username.casefold()
        with self.store.connect() as connection:
            row = connection.execute(
                """
                SELECT id, username, full_name, role, password_hash, is_active, created_at, updated_at
                FROM users
                WHERE lower(username) = ?
                """,
                (normalized,),
            ).fetchone()
        return self._to_record(row) if row else None

    def create(self, user: UserRecord) -> UserRecord:
        with self.store.connect() as connection:
            cursor = connection.execute(
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
                (
                    user.username,
                    user.full_name,
                    user.role.value,
                    user.password_hash,
                    1 if user.is_active else 0,
                    format_datetime(user.created_at),
                    format_datetime(user.updated_at),
                ),
            )
            connection.commit()
            assigned_id = format_api_id(cursor.lastrowid)
        return user.model_copy(update={"id": assigned_id})

    def update(self, user: UserRecord) -> UserRecord:
        parsed_id = parse_db_id(user.id)
        if parsed_id is None:
            return user
        with self.store.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET full_name = ?, role = ?, password_hash = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    user.full_name,
                    user.role.value,
                    user.password_hash,
                    1 if user.is_active else 0,
                    format_datetime(user.updated_at),
                    parsed_id,
                ),
            )
            connection.commit()
        return user

    def delete(self, user_id: str) -> None:
        parsed_id = parse_db_id(user_id)
        if parsed_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM users WHERE id = ?", (parsed_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> UserRecord:
        return UserRecord(
            id=format_api_id(row["id"]),
            username=row["username"],
            full_name=row["full_name"],
            role=UserRole(row["role"]),
            password_hash=row["password_hash"],
            is_active=bool(row["is_active"]),
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


class SqliteClassRepository(ClassRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_classes(self) -> list[ClassRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
                "SELECT id, name, school_year, created_at, updated_at FROM classes"
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def get_by_id(self, class_id: str) -> ClassRecord | None:
        parsed_id = parse_db_id(class_id)
        if parsed_id is None:
            return None
        with self.store.connect() as connection:
            row = connection.execute(
                "SELECT id, name, school_year, created_at, updated_at FROM classes WHERE id = ?",
                (parsed_id,),
            ).fetchone()
        return self._to_record(row) if row else None

    def get_by_name(self, name: str, school_year: SchoolYear | None = None) -> ClassRecord | None:
        normalized = name.casefold()
        with self.store.connect() as connection:
            if school_year is None:
                row = connection.execute(
                    """
                    SELECT id, name, school_year, created_at, updated_at
                    FROM classes
                    WHERE lower(name) = ?
                    LIMIT 1
                    """,
                    (normalized,),
                ).fetchone()
            else:
                row = connection.execute(
                    """
                    SELECT id, name, school_year, created_at, updated_at
                    FROM classes
                    WHERE lower(name) = ? AND school_year = ?
                    LIMIT 1
                    """,
                    (normalized, school_year.value),
                ).fetchone()
        return self._to_record(row) if row else None

    def create(self, class_record: ClassRecord) -> ClassRecord:
        with self.store.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO classes (name, school_year, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    class_record.name,
                    class_record.school_year.value,
                    format_datetime(class_record.created_at),
                    format_datetime(class_record.updated_at),
                ),
            )
            connection.commit()
            assigned_id = format_api_id(cursor.lastrowid)
        return class_record.model_copy(update={"id": assigned_id})

    def update(self, class_record: ClassRecord) -> ClassRecord:
        parsed_id = parse_db_id(class_record.id)
        if parsed_id is None:
            return class_record
        with self.store.connect() as connection:
            connection.execute(
                """
                UPDATE classes
                SET name = ?, school_year = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    class_record.name,
                    class_record.school_year.value,
                    format_datetime(class_record.updated_at),
                    parsed_id,
                ),
            )
            connection.commit()
        return class_record

    def delete(self, class_id: str) -> None:
        parsed_id = parse_db_id(class_id)
        if parsed_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM classes WHERE id = ?", (parsed_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> ClassRecord:
        return ClassRecord(
            id=format_api_id(row["id"]),
            name=row["name"],
            school_year=SchoolYear(row["school_year"]),
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


class SqliteStudentRepository(StudentRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_students(self) -> list[StudentRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, full_name, class_id, cpf, media_folder, photo_path, photo_right_path, photo_left_path, created_at, updated_at
                FROM students
                """
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def get_by_id(self, student_id: str) -> StudentRecord | None:
        parsed_id = parse_db_id(student_id)
        if parsed_id is None:
            return None
        with self.store.connect() as connection:
            row = connection.execute(
                """
                SELECT id, full_name, class_id, cpf, media_folder, photo_path, photo_right_path, photo_left_path, created_at, updated_at
                FROM students
                WHERE id = ?
                """,
                (parsed_id,),
            ).fetchone()
        return self._to_record(row) if row else None

    def get_by_cpf(self, cpf: str) -> StudentRecord | None:
        with self.store.connect() as connection:
            row = connection.execute(
                """
                SELECT id, full_name, class_id, cpf, media_folder, photo_path, photo_right_path, photo_left_path, created_at, updated_at
                FROM students
                WHERE cpf = ?
                """,
                (cpf,),
            ).fetchone()
        return self._to_record(row) if row else None

    def list_by_class_id(self, class_id: str) -> list[StudentRecord]:
        parsed_id = parse_db_id(class_id)
        if parsed_id is None:
            return []
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, full_name, class_id, cpf, media_folder, photo_path, photo_right_path, photo_left_path, created_at, updated_at
                FROM students
                WHERE class_id = ?
                """,
                (parsed_id,),
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def create(self, student: StudentRecord) -> StudentRecord:
        class_db_id = parse_db_id(student.class_id)
        if class_db_id is None:
            return student
        with self.store.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO students (
                    full_name,
                    class_id,
                    cpf,
                    media_folder,
                    photo_path,
                    photo_right_path,
                    photo_left_path,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    student.full_name,
                    class_db_id,
                    student.cpf,
                    student.media_folder,
                    student.photo_path,
                    student.photo_right_path,
                    student.photo_left_path,
                    format_datetime(student.created_at),
                    format_datetime(student.updated_at),
                ),
            )
            connection.commit()
            assigned_id = format_api_id(cursor.lastrowid)
        return student.model_copy(update={"id": assigned_id})

    def update(self, student: StudentRecord) -> StudentRecord:
        parsed_id = parse_db_id(student.id)
        class_db_id = parse_db_id(student.class_id)
        if parsed_id is None or class_db_id is None:
            return student
        with self.store.connect() as connection:
            connection.execute(
                """
                UPDATE students
                SET full_name = ?, class_id = ?, cpf = ?, media_folder = ?, photo_path = ?, photo_right_path = ?, photo_left_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    student.full_name,
                    class_db_id,
                    student.cpf,
                    student.media_folder,
                    student.photo_path,
                    student.photo_right_path,
                    student.photo_left_path,
                    format_datetime(student.updated_at),
                    parsed_id,
                ),
            )
            connection.commit()
        return student

    def delete(self, student_id: str) -> None:
        parsed_id = parse_db_id(student_id)
        if parsed_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM students WHERE id = ?", (parsed_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> StudentRecord:
        return StudentRecord(
            id=format_api_id(row["id"]),
            full_name=row["full_name"],
            class_id=format_api_id(row["class_id"]),
            cpf=row["cpf"],
            media_folder=row["media_folder"],
            photo_path=row["photo_path"],
            photo_right_path=row["photo_right_path"],
            photo_left_path=row["photo_left_path"],
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


class SqliteFaceEmbeddingRepository(FaceEmbeddingRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_embeddings(self) -> list[FaceEmbeddingRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, student_id, engine, vector_json, samples_count, source_image_path, created_at, updated_at
                FROM face_embeddings
                """
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def get_by_student_id(self, student_id: str) -> FaceEmbeddingRecord | None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return None
        with self.store.connect() as connection:
            row = connection.execute(
                """
                SELECT id, student_id, engine, vector_json, samples_count, source_image_path, created_at, updated_at
                FROM face_embeddings
                WHERE student_id = ?
                """,
                (parsed_student_id,),
            ).fetchone()
        return self._to_record(row) if row else None

    def upsert(self, embedding: FaceEmbeddingRecord) -> FaceEmbeddingRecord:
        parsed_student_id = parse_db_id(embedding.student_id)
        if parsed_student_id is None:
            return embedding
        with self.store.connect() as connection:
            existing_row = connection.execute(
                "SELECT id, created_at FROM face_embeddings WHERE student_id = ?",
                (parsed_student_id,),
            ).fetchone()
            if existing_row:
                embedding_id = format_api_id(existing_row["id"])
                created_at_value = parse_datetime(existing_row["created_at"])
                connection.execute(
                    """
                    UPDATE face_embeddings
                    SET engine = ?, vector_json = ?, samples_count = ?, source_image_path = ?, updated_at = ?
                    WHERE student_id = ?
                    """,
                    (
                        embedding.engine,
                        json.dumps(embedding.vector),
                        embedding.samples_count,
                        embedding.source_image_path,
                        format_datetime(embedding.updated_at),
                        parsed_student_id,
                    ),
                )
                connection.commit()
                return embedding.model_copy(update={"id": embedding_id, "created_at": created_at_value})

            cursor = connection.execute(
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
                    parsed_student_id,
                    embedding.engine,
                    json.dumps(embedding.vector),
                    embedding.samples_count,
                    embedding.source_image_path,
                    format_datetime(embedding.created_at),
                    format_datetime(embedding.updated_at),
                ),
            )
            connection.commit()
            return embedding.model_copy(update={"id": format_api_id(cursor.lastrowid)})

    def delete_by_student_id(self, student_id: str) -> None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM face_embeddings WHERE student_id = ?", (parsed_student_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> FaceEmbeddingRecord:
        vector_raw = row["vector_json"]
        vector = json.loads(vector_raw) if vector_raw else []
        return FaceEmbeddingRecord(
            id=format_api_id(row["id"]),
            student_id=format_api_id(row["student_id"]),
            engine=row["engine"],
            vector=vector if isinstance(vector, list) else [],
            samples_count=int(row["samples_count"]),
            source_image_path=row["source_image_path"],
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


class SqliteFaceEmbeddingSampleRepository(FaceEmbeddingSampleRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_by_student_id(self, student_id: str) -> list[FaceEmbeddingSampleRecord]:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return []
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    student_id,
                    engine,
                    vector_json,
                    source_image_path,
                    quality_score,
                    created_at,
                    updated_at
                FROM face_embedding_samples
                WHERE student_id = ?
                """,
                (parsed_student_id,),
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def list_by_student_ids(self, student_ids: list[str]) -> list[FaceEmbeddingSampleRecord]:
        parsed_ids = [item for item in (parse_db_id(student_id) for student_id in student_ids) if item is not None]
        if not parsed_ids:
            return []
        placeholders = ", ".join("?" for _ in parsed_ids)
        with self.store.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    id,
                    student_id,
                    engine,
                    vector_json,
                    source_image_path,
                    quality_score,
                    created_at,
                    updated_at
                FROM face_embedding_samples
                WHERE student_id IN ({placeholders})
                """,
                parsed_ids,
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def upsert(self, sample: FaceEmbeddingSampleRecord) -> FaceEmbeddingSampleRecord:
        parsed_student_id = parse_db_id(sample.student_id)
        if parsed_student_id is None:
            return sample

        with self.store.connect() as connection:
            existing = connection.execute(
                """
                SELECT id, created_at
                FROM face_embedding_samples
                WHERE student_id = ? AND source_image_path = ?
                """,
                (parsed_student_id, sample.source_image_path),
            ).fetchone()

            if existing:
                sample_id = format_api_id(existing["id"])
                created_at_value = parse_datetime(existing["created_at"])
                connection.execute(
                    """
                    UPDATE face_embedding_samples
                    SET engine = ?, vector_json = ?, quality_score = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        sample.engine,
                        json.dumps(sample.vector),
                        float(sample.quality_score),
                        format_datetime(sample.updated_at),
                        int(existing["id"]),
                    ),
                )
                connection.commit()
                return sample.model_copy(update={"id": sample_id, "created_at": created_at_value})

            cursor = connection.execute(
                """
                INSERT INTO face_embedding_samples (
                    student_id,
                    engine,
                    vector_json,
                    source_image_path,
                    quality_score,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    parsed_student_id,
                    sample.engine,
                    json.dumps(sample.vector),
                    sample.source_image_path,
                    float(sample.quality_score),
                    format_datetime(sample.created_at),
                    format_datetime(sample.updated_at),
                ),
            )
            connection.commit()
            return sample.model_copy(update={"id": format_api_id(cursor.lastrowid)})

    def replace_for_student(self, student_id: str, samples: list[FaceEmbeddingSampleRecord]) -> None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return

        with self.store.connect() as connection:
            connection.execute(
                "DELETE FROM face_embedding_samples WHERE student_id = ?",
                (parsed_student_id,),
            )
            for sample in samples:
                connection.execute(
                    """
                    INSERT INTO face_embedding_samples (
                        student_id,
                        engine,
                        vector_json,
                        source_image_path,
                        quality_score,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        parsed_student_id,
                        sample.engine,
                        json.dumps(sample.vector),
                        sample.source_image_path,
                        float(sample.quality_score),
                        format_datetime(sample.created_at),
                        format_datetime(sample.updated_at),
                    ),
                )
            connection.commit()

    def delete_by_student_id(self, student_id: str) -> None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return
        with self.store.connect() as connection:
            connection.execute(
                "DELETE FROM face_embedding_samples WHERE student_id = ?",
                (parsed_student_id,),
            )
            connection.commit()

    @staticmethod
    def _to_record(row) -> FaceEmbeddingSampleRecord:
        vector_raw = row["vector_json"]
        vector = json.loads(vector_raw) if vector_raw else []
        return FaceEmbeddingSampleRecord(
            id=format_api_id(row["id"]),
            student_id=format_api_id(row["student_id"]),
            engine=row["engine"],
            vector=vector if isinstance(vector, list) else [],
            source_image_path=str(row["source_image_path"]),
            quality_score=float(row["quality_score"] or 0.0),
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


class SqliteMealEntryRepository(MealEntryRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_entries(self, filters: MealEntryFilters | None = None) -> list[MealEntryRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
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
                """
            ).fetchall()

        entries = [self._to_record(row) for row in rows]
        if not filters:
            return sorted(entries, key=lambda item: item.recorded_at, reverse=True)

        filtered: list[MealEntryRecord] = []
        for entry in entries:
            if filters.date and entry.recorded_at.date() != filters.date:
                continue
            if filters.class_id and entry.class_id != filters.class_id:
                continue
            if filters.student_id and entry.student_id != filters.student_id:
                continue
            if filters.meal_type and entry.meal_type != filters.meal_type:
                continue
            filtered.append(entry)
        return sorted(filtered, key=lambda item: item.recorded_at, reverse=True)

    def create(self, entry: MealEntryRecord) -> MealEntryRecord:
        student_db_id = parse_db_id(entry.student_id)
        class_db_id = parse_db_id(entry.class_id)
        recorded_by_db_id = parse_db_id(entry.recorded_by_user_id)
        if student_db_id is None or class_db_id is None or recorded_by_db_id is None:
            return entry
        with self.store.connect() as connection:
            cursor = connection.execute(
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
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    student_db_id,
                    entry.student_name,
                    class_db_id,
                    entry.class_name,
                    entry.class_display_name,
                    entry.school_year.value,
                    entry.meal_type.value,
                    format_datetime(entry.recorded_at),
                    recorded_by_db_id,
                    entry.recorded_by_name,
                    entry.source,
                    entry.confidence,
                ),
            )
            connection.commit()
            assigned_id = format_api_id(cursor.lastrowid)
        return entry.model_copy(update={"id": assigned_id})

    def delete_by_student_id(self, student_id: str) -> None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM meal_entries WHERE student_id = ?", (parsed_student_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> MealEntryRecord:
        return MealEntryRecord(
            id=format_api_id(row["id"]),
            student_id=format_api_id(row["student_id"]),
            student_name=row["student_name"],
            class_id=format_api_id(row["class_id"]),
            class_name=row["class_name"],
            class_display_name=row["class_display_name"],
            school_year=SchoolYear(row["school_year"]),
            meal_type=row["meal_type"],
            recorded_at=parse_datetime(row["recorded_at"]),
            recorded_by_user_id=format_api_id(row["recorded_by_user_id"]),
            recorded_by_name=row["recorded_by_name"],
            source=row["source"],
            confidence=row["confidence"],
        )


class SqliteRecognitionAttemptRepository(RecognitionAttemptRepository):
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    def list_attempts(self) -> list[RecognitionAttemptRecord]:
        with self.store.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, status, confidence, student_id, class_id, recorded_at
                FROM recognition_attempts
                """
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def create(self, attempt: RecognitionAttemptRecord) -> RecognitionAttemptRecord:
        student_db_id = parse_db_id(attempt.student_id)
        class_db_id = parse_db_id(attempt.class_id)
        with self.store.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO recognition_attempts (status, confidence, student_id, class_id, recorded_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    attempt.status.value,
                    attempt.confidence,
                    student_db_id,
                    class_db_id,
                    format_datetime(attempt.recorded_at),
                ),
            )
            connection.commit()
            assigned_id = format_api_id(cursor.lastrowid)
        return attempt.model_copy(update={"id": assigned_id})

    def delete_by_student_id(self, student_id: str) -> None:
        parsed_student_id = parse_db_id(student_id)
        if parsed_student_id is None:
            return
        with self.store.connect() as connection:
            connection.execute("DELETE FROM recognition_attempts WHERE student_id = ?", (parsed_student_id,))
            connection.commit()

    @staticmethod
    def _to_record(row) -> RecognitionAttemptRecord:
        return RecognitionAttemptRecord(
            id=format_api_id(row["id"]),
            status=row["status"],
            confidence=row["confidence"],
            student_id=format_api_id(row["student_id"]) if row["student_id"] is not None else None,
            class_id=format_api_id(row["class_id"]) if row["class_id"] is not None else None,
            recorded_at=parse_datetime(row["recorded_at"]),
        )
