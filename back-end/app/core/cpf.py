from __future__ import annotations

import re


def normalize_cpf(value: str) -> str:
    return re.sub(r"\D+", "", value or "")


def is_valid_cpf(value: str) -> bool:
    cpf = normalize_cpf(value)
    if len(cpf) != 11:
        return False
    if cpf == cpf[0] * 11:
        return False

    first_digit = _calculate_check_digit(cpf[:9], start_factor=10)
    second_digit = _calculate_check_digit(cpf[:10], start_factor=11)
    return cpf[-2:] == f"{first_digit}{second_digit}"


def _calculate_check_digit(base: str, *, start_factor: int) -> int:
    total = sum(int(char) * factor for char, factor in zip(base, range(start_factor, 1, -1), strict=True))
    remainder = total % 11
    return 0 if remainder < 2 else 11 - remainder
