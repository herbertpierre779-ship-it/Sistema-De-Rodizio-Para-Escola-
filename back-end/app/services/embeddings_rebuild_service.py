from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from typing import Any

from app.adapters.persistence.sqlite_store import format_datetime
from app.core.config import Settings
from app.repositories.contracts import AppSettingsRepository, StudentRepository
from app.schemas.settings import EmbeddingsRebuildStatusResponse
from app.services.student_service import StudentService


EMBEDDINGS_REBUILD_STATUS_KEY = "embeddings_rebuild_status_v1"
EMBEDDINGS_BOOTSTRAP_MIGRATION_KEY = "embedding_samples_migration_v1_done"
EMBEDDINGS_PROFILE_MARKER_KEY = "embedding_samples_profile_marker_v1"
EMBEDDINGS_STRATEGY_VERSION = "naogazei_pipeline_v2"


class EmbeddingsRebuildService:
    def __init__(
        self,
        settings: Settings,
        repository: AppSettingsRepository,
        student_repository: StudentRepository,
        student_service: StudentService,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.student_repository = student_repository
        self.student_service = student_service
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None

    def bootstrap_start_if_needed(self) -> None:
        marker = self._current_marker()
        boot_done = self.repository.get_value(EMBEDDINGS_BOOTSTRAP_MIGRATION_KEY) == "done"
        marker_done = self.repository.get_value(EMBEDDINGS_PROFILE_MARKER_KEY) == marker
        if boot_done and marker_done:
            return
        students = self.student_repository.list_students()
        if not students:
            self.repository.set_value(EMBEDDINGS_BOOTSTRAP_MIGRATION_KEY, "done")
            self.repository.set_value(EMBEDDINGS_PROFILE_MARKER_KEY, marker)
            return
        self.start_rebuild()

    def get_status(self) -> EmbeddingsRebuildStatusResponse:
        status = self._read_status()
        running_thread = self._worker is not None and self._worker.is_alive()
        if status["running"] and not running_thread:
            status["running"] = False
            if not status["finished_at"]:
                status["finished_at"] = format_datetime(datetime.now(UTC))
            self._save_status(status)
        return EmbeddingsRebuildStatusResponse.model_validate(status)

    def start_rebuild(self) -> EmbeddingsRebuildStatusResponse:
        with self._lock:
            running_thread = self._worker is not None and self._worker.is_alive()
            if running_thread:
                return EmbeddingsRebuildStatusResponse.model_validate(self._read_status())

            status = self._default_status()
            status["running"] = True
            status["started_at"] = format_datetime(datetime.now(UTC))
            self._save_status(status)

            self._worker = threading.Thread(target=self._run_rebuild, daemon=True, name="embeddings-rebuild-worker")
            self._worker.start()
            return EmbeddingsRebuildStatusResponse.model_validate(status)

    def _run_rebuild(self) -> None:
        status = self._read_status()
        students = sorted(
            self.student_repository.list_students(),
            key=lambda item: int(item.id) if str(item.id).isdigit() else 0,
        )
        status["total_students"] = len(students)
        status["processed_students"] = 0
        status["total_samples"] = 0
        status["processed_samples"] = 0
        status["failed_students"] = 0
        status["last_error"] = None
        self._save_status(status)

        total_samples_estimate = 0
        for student in students:
            try:
                total_samples_estimate += self.student_service.estimate_face_sample_count(student.id)
            except Exception:
                continue
        status["total_samples"] = total_samples_estimate
        self._save_status(status)

        for index, student in enumerate(students, start=1):
            try:
                sample_count, _ = self.student_service.rebuild_face_embeddings_for_student(student.id)
                status["processed_samples"] = int(status["processed_samples"]) + sample_count
            except Exception as exc:
                status["failed_students"] = int(status["failed_students"]) + 1
                status["last_error"] = f"Falha no aluno {student.full_name}: {exc}"
            finally:
                status["processed_students"] = index
                self._save_status(status)

        status["running"] = False
        status["finished_at"] = format_datetime(datetime.now(UTC))
        self._save_status(status)
        self.repository.set_value(EMBEDDINGS_BOOTSTRAP_MIGRATION_KEY, "done")
        self.repository.set_value(EMBEDDINGS_PROFILE_MARKER_KEY, self._current_marker())

    def _default_status(self) -> dict[str, Any]:
        return {
            "running": False,
            "total_students": 0,
            "processed_students": 0,
            "total_samples": 0,
            "processed_samples": 0,
            "failed_students": 0,
            "started_at": None,
            "finished_at": None,
            "last_error": None,
        }

    def _read_status(self) -> dict[str, Any]:
        raw_value = self.repository.get_value(EMBEDDINGS_REBUILD_STATUS_KEY)
        if not raw_value:
            status = self._default_status()
            self._save_status(status)
            return status
        try:
            payload = json.loads(raw_value)
            if not isinstance(payload, dict):
                raise ValueError("invalid payload")
            default = self._default_status()
            default.update(payload)
            return default
        except Exception:
            status = self._default_status()
            self._save_status(status)
            return status

    def _save_status(self, status: dict[str, Any]) -> None:
        self.repository.set_value(EMBEDDINGS_REBUILD_STATUS_KEY, json.dumps(status, ensure_ascii=False))

    def _current_marker(self) -> str:
        engine = str(self.settings.face_engine).strip().casefold()
        profile = str(self.settings.recognition_profile).strip().casefold()
        return f"{engine}|{profile}|{EMBEDDINGS_STRATEGY_VERSION}"
