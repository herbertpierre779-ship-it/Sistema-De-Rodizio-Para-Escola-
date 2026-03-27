from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import Settings


def utc_now() -> datetime:
    return datetime.now(UTC)


def school_timezone(settings: Settings):
    try:
        return ZoneInfo(settings.school_timezone)
    except ZoneInfoNotFoundError:
        if settings.school_timezone == "America/Sao_Paulo":
            return timezone(timedelta(hours=-3), name="America/Sao_Paulo")
        return UTC


def to_school_datetime(settings: Settings, value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(school_timezone(settings))


def school_today(settings: Settings) -> date:
    return to_school_datetime(settings, utc_now()).date()
