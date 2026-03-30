from __future__ import annotations

from app.adapters.persistence.json_collection_store import JsonCollectionStore
from app.models.entities import MealEntryRecord, RecognitionAttemptRecord
from app.repositories.contracts import MealEntryFilters, MealEntryRepository, RecognitionAttemptRepository


def _next_sequence_id(items: list[dict]) -> str:
    max_id = 0
    for item in items:
        raw_id = str(item.get("id", "")).strip()
        if raw_id.isdigit():
            max_id = max(max_id, int(raw_id))
    return str(max_id + 1)


class JsonMealEntryRepository(MealEntryRepository):
    def __init__(self, store: JsonCollectionStore) -> None:
        self.store = store

    def list_entries(self, filters: MealEntryFilters | None = None) -> list[MealEntryRecord]:
        entries = [MealEntryRecord.model_validate(item) for item in self.store.read()]
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
        with self.store.edit() as payload:
            next_id = _next_sequence_id(payload)
            item = entry.model_dump(mode="json")
            item["id"] = next_id
            payload.append(item)
        return entry.model_copy(update={"id": next_id})

    def delete_by_student_id(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload[:] = [item for item in payload if str(item.get("student_id", "")) != student_id]


class JsonRecognitionAttemptRepository(RecognitionAttemptRepository):
    def __init__(self, store: JsonCollectionStore) -> None:
        self.store = store

    def list_attempts(self) -> list[RecognitionAttemptRecord]:
        attempts = [RecognitionAttemptRecord.model_validate(item) for item in self.store.read()]
        return sorted(attempts, key=lambda item: item.recorded_at, reverse=True)

    def create(self, attempt: RecognitionAttemptRecord) -> RecognitionAttemptRecord:
        with self.store.edit() as payload:
            next_id = _next_sequence_id(payload)
            item = attempt.model_dump(mode="json")
            item["id"] = next_id
            payload.append(item)
        return attempt.model_copy(update={"id": next_id})

    def delete_by_student_id(self, student_id: str) -> None:
        with self.store.edit() as payload:
            payload[:] = [item for item in payload if str(item.get("student_id", "")) != student_id]
