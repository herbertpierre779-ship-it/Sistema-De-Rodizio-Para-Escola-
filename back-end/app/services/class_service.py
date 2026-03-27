from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.core.exceptions import AppError
from app.models.entities import ClassRecord, SchoolYear
from app.repositories.contracts import ClassRepository, StudentRepository
from app.schemas.classes import ClassCreateRequest, ClassResponse, ClassUpdateRequest
from app.services.student_service import StudentService


class ClassService:
    def __init__(
        self,
        class_repository: ClassRepository,
        student_repository: StudentRepository,
        student_service: StudentService,
    ) -> None:
        self.class_repository = class_repository
        self.student_repository = student_repository
        self.student_service = student_service

    def list_classes(self) -> list[ClassResponse]:
        order = {school_year: index for index, school_year in enumerate(SchoolYear, start=1)}
        classes = sorted(
            self.class_repository.list_classes(),
            key=lambda item: (order[item.school_year], item.name.casefold()),
        )
        return [self.to_response(class_record) for class_record in classes]

    def get_class_record(self, class_id: str) -> ClassRecord:
        class_record = self.class_repository.get_by_id(class_id)
        if not class_record:
            raise AppError(404, "Turma não encontrada.")
        return class_record

    def create_class(self, payload: ClassCreateRequest) -> ClassResponse:
        normalized_name = normalize_uppercase_text(payload.name)
        if self.class_repository.get_by_name(normalized_name, payload.school_year):
            raise AppError(409, "Já existe uma turma com esse nome.")
        now = datetime.now(UTC)
        class_record = ClassRecord(
            id=uuid4().hex,
            name=normalized_name,
            school_year=payload.school_year,
            created_at=now,
            updated_at=now,
        )
        return self.to_response(self.class_repository.create(class_record))

    def update_class(self, class_id: str, payload: ClassUpdateRequest) -> ClassResponse:
        class_record = self.get_class_record(class_id)
        normalized_name = normalize_uppercase_text(payload.name)
        existing = self.class_repository.get_by_name(normalized_name, payload.school_year)
        if existing and existing.id != class_id:
            raise AppError(409, "Já existe uma turma com esse nome.")

        updated = class_record.model_copy(
            update={
                "name": normalized_name,
                "school_year": payload.school_year,
                "updated_at": datetime.now(UTC),
            }
        )
        persisted = self.class_repository.update(updated)
        if class_record.name != persisted.name or class_record.school_year != persisted.school_year:
            for student in self.student_repository.list_by_class_id(class_id):
                self.student_service.sync_student_media_location(student.id, persisted)
        return self.to_response(persisted)

    def delete_class(self, class_id: str) -> None:
        self.get_class_record(class_id)
        students = self.student_repository.list_by_class_id(class_id)
        for student in students:
            self.student_service.delete_student(student.id)
        self.class_repository.delete(class_id)

    def to_response(self, class_record: ClassRecord) -> ClassResponse:
        student_count = len(self.student_repository.list_by_class_id(class_record.id))
        return ClassResponse(
            id=class_record.id,
            name=class_record.name,
            school_year=class_record.school_year,
            display_name=f"{class_record.school_year.value} - {class_record.name}",
            student_count=student_count,
            created_at=class_record.created_at,
            updated_at=class_record.updated_at,
        )


def normalize_uppercase_text(value: str) -> str:
    return " ".join(value.split()).upper()
