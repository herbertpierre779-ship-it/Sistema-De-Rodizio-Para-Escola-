from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.dependencies import get_container, get_current_user
from app.core.container import AppContainer
from app.models.entities import MealType, UserRecord
from app.schemas.recognition import RecognitionIdentifyByCpfRequest, RecognitionIdentifyResponse


router = APIRouter(prefix="/recognition", tags=["recognition"])


@router.post("/identify", response_model=RecognitionIdentifyResponse)
async def identify(
    file: UploadFile = File(...),
    meal_type: MealType | None = Form(default=None),
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> RecognitionIdentifyResponse:
    return container.recognition_service.identify(await file.read(), meal_type=meal_type)


@router.post("/identify-by-cpf", response_model=RecognitionIdentifyResponse)
def identify_by_cpf(
    payload: RecognitionIdentifyByCpfRequest,
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> RecognitionIdentifyResponse:
    return container.recognition_service.identify_by_cpf(payload.cpf, meal_type=payload.meal_type)
