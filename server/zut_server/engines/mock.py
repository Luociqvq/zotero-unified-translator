from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

from .base import EngineOptions, ProgressCallback
from ..errors import EngineCancelled


class MockEngine:
    """A copy engine used for API and deployment smoke tests.

    It deliberately does not translate content. It proves the task, download,
    and Zotero attachment pipeline without requiring a third-party engine.
    """

    id = "mock"
    version = "0.1"

    def validate(self) -> tuple[bool, str]:
        return True, "smoke-test engine; output is a copy of the source PDF"

    def translate(
        self,
        source_pdf: Path,
        output_pdf: Path,
        options: EngineOptions,
        progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> None:
        del options
        progress(15, "reading")
        if is_cancelled():
            raise EngineCancelled()
        shutil.copyfile(source_pdf, output_pdf)
        progress(95, "finalizing")
        if is_cancelled():
            output_pdf.unlink(missing_ok=True)
            raise EngineCancelled()
