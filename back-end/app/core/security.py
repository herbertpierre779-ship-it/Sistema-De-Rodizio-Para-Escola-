from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import Settings
from app.core.exceptions import AppError


PBKDF2_ITERATIONS = 100_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    encoded = base64.b64encode(derived).decode("utf-8")
    return f"{salt}${encoded}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, encoded_hash = stored_hash.split("$", maxsplit=1)
    except ValueError:
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    candidate_b64 = base64.b64encode(candidate).decode("utf-8")
    return hmac.compare_digest(candidate_b64, encoded_hash)


def create_access_token(settings: Settings, *, subject: str, role: str) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.token_expire_minutes)
    payload = {
        "sub": subject,
        "role": role,
        "exp": expires_at,
        "iat": datetime.now(UTC),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(settings: Settings, token: str) -> dict[str, str]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise AppError(401, "Token expirado.") from exc
    except jwt.PyJWTError as exc:
        raise AppError(401, "Token inválido.") from exc

    subject = payload.get("sub")
    role = payload.get("role")
    if not subject or not role:
        raise AppError(401, "Token inválido.")
    return {"sub": str(subject), "role": str(role)}
