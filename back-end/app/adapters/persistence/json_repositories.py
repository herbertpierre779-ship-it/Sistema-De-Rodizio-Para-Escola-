from __future__ import annotations

from app.adapters.persistence.json_store import JsonStore
from app.models.entities import (
    ClassRecord,
    FaceEmbeddingRecord,
    MealEntryRecord,
    RecognitionAttemptRecord,
    SchoolYear,
    StudentRecord,
    UserRecord,
    UserRole,
)
from app.repositories.contracts import (
    ClassRepository,
    FaceEmbeddingRepository,
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


class JsonUserRepository(UserRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_users(self) -> list[UserRecord]:
        payload = self.store.read()
        return [UserRecord.model_validate(item) for item in payload["users"]]

    def get_by_id(self, user_id: str) -> UserRecord | None:
        for user in self.list_users():
            if user.id == user_id:
                return user
        return None

    def get_by_username(self, username: str) -> UserRecord | None:
        normalized = username.casefold()
        for user in self.list_users():
            if user.username.casefold() == normalized:
                return user
        return None

    def create(self, user: UserRecord) -> UserRecord:
        with self.store.edit() as payload:
            payload["users"].append(user.model_dump(mode="json"))
        return user

    def update(self, user: UserRecord) -> UserRecord:
        with self.store.edit() as payload:
            payload["users"] = [
                user.model_dump(mode="json") if item["id"] == user.id else item for item in payload["users"]
            ]
        return user

    def delete(self, user_id: str) -> None:
        with self.store.edit() as payload:
            payload["users"] = [item for item in payload["users"] if item["id"] != user_id]


class JsonClassRepository(ClassRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_classes(self) -> list[ClassRecord]:
        payload = self.store.read()
        return [ClassRecord.model_validate(item) for item in payload["classes"]]

    def get_by_id(self, class_id: str) -> ClassRecord | None:
        for class_record in self.list_classes():
            if class_record.id == class_id:
                return class_record
        return None

    def get_by_name(self, name: str, school_year: SchoolYear | None = None) -> ClassRecord | None:
        normalized = name.casefold()
        for class_record in self.list_classes():
            if class_record.name.casefold() == normalized and (
                school_year is None or class_record.school_year == school_year
            ):
                return class_record
        return None

    def create(self, class_record: ClassRecord) -> ClassRecord:
        with self.store.edit() as payload:
            payload["classes"].append(class_record.model_dump(mode="json"))
        return class_record

    def update(self, class_record: ClassRecord) -> ClassRecord:
        with self.store.edit() as payload:
            payload["classes"] = [
                class_record.model_dump(mode="json")
                if item["id"] == class_record.id
                else item
                for item in payload["classes"]
            ]
        return class_record

    def delete(self, class_id: str) -> None:
        with self.store.edit() as payload:
            payload["classes"] = [item for item in payload["classes"] if item["id"] != class_id]


class JsonStudentRepository(StudentRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_students(self) -> list[StudentRecord]:
        payload = self.store.read()
        return [StudentRecord.model_validate(item) for item in payload["students"]]

    def get_by_id(self, student_id: str) -> StudentRecord | None:
        for student in self.list_students():
            if student.id == student_id:
                return student
        return None

    def get_by_cpf(self, cpf: str) -> StudentRecord | None:
        for student in self.list_students():
            if student.cpf == cpf:
                return student
        return None

    def list_by_class_id(self, class_id: str) -> list[StudentRecord]:
        return [student for student in self.list_students() if student.class_id == class_id]

    def create(self, student: StudentRecord) -> StudentRecord:
        with self.store.edit() as payload:
            payload["students"].append(student.model_dump(mode="json"))
        return student

    def update(self, student: StudentRecord) -> StudentRecord:
        with self.store.edit() as payload:
            payload["students"] = [
                student.model_dump(mode="json") if item["id"] == student.id else item
                for item in payload["students"]
            ]
        return student

    def delete(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload["students"] = [item for item in payload["students"] if item["id"] != student_id]


class JsonFaceEmbeddingRepository(FaceEmbeddingRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_embeddings(self) -> list[FaceEmbeddingRecord]:
        payload = self.store.read()
        return [FaceEmbeddingRecord.model_validate(item) for item in payload["face_embeddings"]]

    def get_by_student_id(self, student_id: str) -> FaceEmbeddingRecord | None:
        for embedding in self.list_embeddings():
            if embedding.student_id == student_id:
                return embedding
        return None

    def upsert(self, embedding: FaceEmbeddingRecord) -> FaceEmbeddingRecord:
        with self.store.edit() as payload:
            updated = False
            next_items = []
            for item in payload["face_embeddings"]:
                if item["student_id"] == embedding.student_id:
                    next_items.append(embedding.model_dump(mode="json"))
                    updated = True
                else:
                    next_items.append(item)
            if not updated:
                next_items.append(embedding.model_dump(mode="json"))
            payload["face_embeddings"] = next_items
        return embedding

    def delete_by_student_id(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload["face_embeddings"] = [
                item for item in payload["face_embeddings"] if item["student_id"] != student_id
            ]


class JsonMealEntryRepository(MealEntryRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_entries(self, filters: MealEntryFilters | None = None) -> list[MealEntryRecord]:
        payload = self.store.read()
        entries = [MealEntryRecord.model_validate(item) for item in payload["meal_entries"]]
        if not filters:
            return sorted(entries, key=lambda item: item.recorded_at, reverse=True)

        filtered = []
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
        with self.store.edit() as payload:
            payload["meal_entries"].append(entry.model_dump(mode="json"))
        return entry

    def delete_by_student_id(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload["meal_entries"] = [item for item in payload["meal_entries"] if item["student_id"] != student_id]


class JsonRecognitionAttemptRepository(RecognitionAttemptRepository):
    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def list_attempts(self) -> list[RecognitionAttemptRecord]:
        payload = self.store.read()
        return [RecognitionAttemptRecord.model_validate(item) for item in payload["recognition_attempts"]]

    def create(self, attempt: RecognitionAttemptRecord) -> RecognitionAttemptRecord:
        with self.store.edit() as payload:
            payload["recognition_attempts"].append(attempt.model_dump(mode="json"))
        return attempt

    def delete_by_student_id(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload["recognition_attempts"] = [
                item for item in payload["recognition_attempts"] if item.get("student_id") != student_id
            ]
