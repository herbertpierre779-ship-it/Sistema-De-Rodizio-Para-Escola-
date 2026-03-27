from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from app.models.entities import ClassRecord


PhotoPose = Literal["front", "right", "left"]


def slugify_segment(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.casefold()).strip("-")
    return slug or "turma"


def build_photo_relative_path(
    class_record: ClassRecord,
    student_id: str,
    extension: str = ".jpg",
    *,
    pose: PhotoPose = "front",
) -> str:
    normalized_extension = extension.lower() if extension.startswith(".") else f".{extension.lower()}"
    suffix = "" if pose == "front" else f"-{pose}"
    relative_path = (
        Path(class_record.school_year.value)
        / slugify_segment(class_record.name)
        / f"{student_id}{suffix}{normalized_extension}"
    )
    return relative_path.as_posix()


def build_media_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    normalized = relative_path.replace("\\", "/").lstrip("/")
    return f"/media/{quote(normalized, safe='/')}"
