from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

from app.models.entities import ClassRecord


PhotoPose = str


def slugify_segment(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.casefold()).strip("-")
    return slug or "aluno"


def build_student_media_directory(class_record: ClassRecord, media_folder: str) -> str:
    return (Path(class_record.school_year.value) / slugify_segment(class_record.name) / media_folder).as_posix()


def build_photo_relative_path(class_record: ClassRecord, media_folder: str, filename: str) -> str:
    return (Path(build_student_media_directory(class_record, media_folder)) / filename).as_posix()


def build_media_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    normalized = relative_path.replace("\\", "/").lstrip("/")
    return f"/media/{quote(normalized, safe='/')}"
