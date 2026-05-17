from __future__ import annotations

from app.adapters.face.engine import build_face_engine
from app.adapters.persistence.json_collection_store import JsonCollectionStore
from app.adapters.persistence.json_event_repositories import (
    JsonMealEntryRepository,
    JsonRecognitionAttemptRepository,
)
from app.adapters.persistence.sqlite_repositories import (
    SqliteAppSettingsRepository,
    SqliteClassRepository,
    SqliteFaceEmbeddingRepository,
    SqliteFaceEmbeddingSampleRepository,
    SqliteStudentRepository,
    SqliteUserRepository,
    StaticRoleRepository,
)
from app.adapters.persistence.sqlite_store import SqliteStore
from app.core.config import Settings
from app.models.entities import SchoolYear
from app.services.auth_service import AuthService
from app.services.app_settings_service import AppSettingsService
from app.services.class_service import ClassService
from app.services.embeddings_rebuild_service import EmbeddingsRebuildService
from app.services.meal_entry_service import MealEntryService
from app.services.recognition_service import RecognitionService
from app.services.stats_service import StatsService
from app.services.student_service import StudentService
from app.services.user_service import UserService


class AppContainer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.settings.photos_root_path.mkdir(parents=True, exist_ok=True)
        for school_year in SchoolYear:
            (self.settings.photos_root_path / school_year.value).mkdir(parents=True, exist_ok=True)

        sqlite_store = SqliteStore(self.settings.database_file_path)
        meal_entries_store = JsonCollectionStore(self.settings.meal_entries_file_path)
        recognition_attempts_store = JsonCollectionStore(self.settings.recognition_attempts_file_path)

        sqlite_store.migrate_legacy_json_if_needed(
            self.settings.legacy_data_file_path,
            meal_entries_store=meal_entries_store,
            recognition_attempts_store=recognition_attempts_store,
            keep_backup=self.settings.keep_legacy_backup,
        )
        sqlite_store.migrate_event_tables_to_json_if_needed(
            meal_entries_store=meal_entries_store,
            recognition_attempts_store=recognition_attempts_store,
        )

        self.role_repository = StaticRoleRepository()
        self.app_settings_repository = SqliteAppSettingsRepository(sqlite_store)
        self.user_repository = SqliteUserRepository(sqlite_store)
        self.class_repository = SqliteClassRepository(sqlite_store)
        self.student_repository = SqliteStudentRepository(sqlite_store)
        self.face_embedding_repository = SqliteFaceEmbeddingRepository(sqlite_store)
        self.face_embedding_sample_repository = SqliteFaceEmbeddingSampleRepository(sqlite_store)
        self.meal_entry_repository = JsonMealEntryRepository(meal_entries_store)
        self.recognition_attempt_repository = JsonRecognitionAttemptRepository(recognition_attempts_store)
        self.face_engine = build_face_engine(
            self.settings.face_engine,
            models_dir=self.settings.face_models_dir_path,
        )

        self.user_service = UserService(self.user_repository, self.role_repository)
        self.app_settings_service = AppSettingsService(
            self.settings,
            self.app_settings_repository,
            self.user_repository,
        )
        self.auth_service = AuthService(self.settings, self.user_repository)
        self.meal_entry_service = MealEntryService(
            self.settings,
            self.app_settings_service,
            self.meal_entry_repository,
            self.student_repository,
            self.class_repository,
        )
        self.student_service = StudentService(
            self.settings,
            self.app_settings_repository,
            self.student_repository,
            self.class_repository,
            self.face_embedding_repository,
            self.face_embedding_sample_repository,
            self.meal_entry_repository,
            self.recognition_attempt_repository,
            self.face_engine,
        )
        self.class_service = ClassService(
            self.class_repository,
            self.student_repository,
            self.student_service,
        )
        self.recognition_service = RecognitionService(
            self.settings,
            self.student_repository,
            self.class_repository,
            self.face_embedding_repository,
            self.face_embedding_sample_repository,
            self.recognition_attempt_repository,
            self.face_engine,
            self.app_settings_service,
            self.meal_entry_service,
        )
        self.embeddings_rebuild_service = EmbeddingsRebuildService(
            self.settings,
            self.app_settings_repository,
            self.student_repository,
            self.student_service,
        )
        self.stats_service = StatsService(
            self.settings,
            self.user_repository,
            self.class_repository,
            self.student_repository,
            self.meal_entry_repository,
            self.recognition_attempt_repository,
            self.meal_entry_service,
        )

    def bootstrap(self) -> None:
        self.user_service.ensure_bootstrap_director(
            username=self.settings.bootstrap_director_username,
            password=self.settings.bootstrap_director_password,
            full_name=self.settings.bootstrap_director_full_name,
        )
        self.student_service.migrate_legacy_media_if_needed()
        self.embeddings_rebuild_service.bootstrap_start_if_needed()
