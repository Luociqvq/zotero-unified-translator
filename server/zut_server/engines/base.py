from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


ProgressCallback = Callable[[int, str], None]


@dataclass(frozen=True)
class EngineOptions:
    source_language: str
    target_language: str
    output_mode: str


class TranslationEngine(Protocol):
    id: str
    version: str

    def validate(self) -> tuple[bool, str]:
        ...

    def translate(
        self,
        source_pdf: Path,
        output_pdf: Path,
        options: EngineOptions,
        progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> None:
        ...
