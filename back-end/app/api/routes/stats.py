from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_container, require_roles
from app.core.container import AppContainer
from app.models.entities import MealType, UserRecord, UserRole
from app.schemas.stats import StatsChartsResponse, StatsOverviewResponse


router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=StatsOverviewResponse)
def stats_overview(
    _: UserRecord = Depends(require_roles(UserRole.diretor, UserRole.coordenadora)),
    container: AppContainer = Depends(get_container),
) -> StatsOverviewResponse:
    return container.stats_service.overview()


@router.get("/charts", response_model=StatsChartsResponse)
def stats_charts(
    meal_type: MealType | None = Query(default=None),
    _: UserRecord = Depends(require_roles(UserRole.diretor, UserRole.coordenadora)),
    container: AppContainer = Depends(get_container),
) -> StatsChartsResponse:
    return container.stats_service.charts(meal_type=meal_type)
