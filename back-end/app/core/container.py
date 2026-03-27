from __future__ import annotations

from app.adapters.face.engine import build_face_engine
from app.adapters.persistence.json_repositories import (
    JsonClassRepository,
    JsonFaceEmbeddingRepository,
    JsonMealEntryRepository,
    JsonRecognitionAttemptRepository,
    JsonStudentRepository,
    JsonUserRepository,
    StaticRoleRepository,
)
from app.adapters.persistence.json_store import JsonStore
from app.core.config import Settings
from app.models.entities import SchoolYear
from app.services.auth_service import AuthService
from app.services.class_service import ClassService
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

        store = JsonStore(self.settings.data_file_path)
        self.role_repository = StaticRoleRepository()
        self.user_repository = JsonUserRepository(store)
        self.class_repository = JsonClassRepository(store)
        self.student_repository = JsonStudentRepository(store)
        self.face_embedding_repository = JsonFaceEmbeddingRepository(store)
        self.meal_entry_repository = JsonMealEntryRepository(store)
        self.recognition_attempt_repository = JsonRecognitionAttemptRepository(store)
        self.face_engine = build_face_engine(self.settings.face_engine)

        self.user_service = UserService(self.user_repository, self.role_repository)
        self.auth_service = AuthService(self.settings, self.user_repository)
        self.meal_entry_service = MealEntryService(
            self.settings,
            self.meal_entry_repository,
            self.student_repository,
            self.class_repository,
        )
        self.student_service = StudentService(
            self.settings,
            self.student_repository,
            self.class_repository,
            self.face_embedding_repository,
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
            self.recognition_attempt_repository,
            self.face_engine,
            self.meal_entry_service,
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
