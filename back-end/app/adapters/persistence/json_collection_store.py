from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterator


class JsonCollectionStore:
    """Thread-safe JSON collection store backed by a single file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.write([])

    def read(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read_unlocked()

    def write(self, items: list[dict[str, Any]]) -> None:
        with self._lock:
            self._write_unlocked(items)

    @contextmanager
    def edit(self) -> Iterator[list[dict[str, Any]]]:
        with self._lock:
            payload = self._read_unlocked()
            yield payload
            self._write_unlocked(payload)

    def _read_unlocked(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []

        with self.path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        if not isinstance(payload, list):
            raise ValueError(f"Arquivo JSON inválido para coleção: {self.path}")
        return payload

    def _write_unlocked(self, items: list[dict[str, Any]]) -> None:
        if not isinstance(items, list):
            raise ValueError("A coleção JSON precisa ser uma lista.")

        temp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(items, file, ensure_ascii=False, indent=2)
        temp_path.replace(self.path)
