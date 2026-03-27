from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import auth, classes, meal_entries, recognition, stats, students, users


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(classes.router)
api_router.include_router(students.router)
api_router.include_router(recognition.router)
api_router.include_router(meal_entries.router)
api_router.include_router(stats.router)
