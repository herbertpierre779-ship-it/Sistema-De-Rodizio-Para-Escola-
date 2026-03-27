from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status

from app.api.dependencies import get_container, get_current_user, require_roles
from app.core.container import AppContainer
from app.models.entities import UserRecord, UserRole
from app.schemas.students import (
    FaceEnrollResponse,
    StudentAttendanceSummaryResponse,
    StudentCreateRequest,
    StudentResponse,
    StudentUpdateRequest,
)


router = APIRouter(prefix="/students", tags=["students"])


@router.get("", response_model=list[StudentResponse])
def list_students(
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> list[StudentResponse]:
    return container.student_service.list_students()


@router.post("", response_model=StudentResponse, status_code=status.HTTP_201_CREATED)
def create_student(
    payload: StudentCreateRequest,
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> StudentResponse:
    return container.student_service.create_student(payload)


@router.get("/{student_id}", response_model=StudentResponse)
def get_student(
    student_id: str,
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> StudentResponse:
    return container.student_service.get_student(student_id)


@router.get("/{student_id}/attendance-summary", response_model=StudentAttendanceSummaryResponse)
def get_student_attendance_summary(
    student_id: str,
    month: str | None = Query(default=None),
    _: UserRecord = Depends(require_roles(UserRole.diretor)),
    container: AppContainer = Depends(get_container),
) -> StudentAttendanceSummaryResponse:
    return container.student_service.get_attendance_summary(student_id, month_value=month)


@router.patch("/{student_id}", response_model=StudentResponse)
def update_student(
    student_id: str,
    payload: StudentUpdateRequest,
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> StudentResponse:
    return container.student_service.update_student(student_id, payload)


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: str,
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> Response:
    container.student_service.delete_student(student_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{student_id}/face-enroll", response_model=FaceEnrollResponse)
async def enroll_face(
    student_id: str,
    file: UploadFile = File(...),
    _: UserRecord = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
) -> FaceEnrollResponse:
    return container.student_service.enroll_face(
        student_id,
        image_bytes=await file.read(),
        content_type=file.content_type,
        filename=file.filename,
    )
