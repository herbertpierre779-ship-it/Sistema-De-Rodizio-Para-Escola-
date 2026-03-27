from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_container, get_current_user
from app.core.container import AppContainer
from app.models.entities import MealType, UserRecord
from app.schemas.meal_entries import MealEntryCreateRequest, MealEntryResponse


router = APIRouter(prefix="/meal-entries", tags=["meal-entries"])


@router.post("", response_model=MealEntryResponse, status_code=status.HTTP_201_CREATED)
def create_meal_entry(
    payload: MealEntryCreateRequest,
    current_user: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> MealEntryResponse:
    return container.meal_entry_service.create_entry(payload, current_user=current_user)


@router.get("", response_model=list[MealEntryResponse])
def list_meal_entries(
    date: str | None = Query(default=None),
    class_id: str | None = Query(default=None),
    student_id: str | None = Query(default=None),
    meal_type: MealType | None = Query(default=None),
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> list[MealEntryResponse]:
    return container.meal_entry_service.list_entries(
        date_value=date,
        class_id=class_id,
        student_id=student_id,
        meal_type=meal_type,
    )
