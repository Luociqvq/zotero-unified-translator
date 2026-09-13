from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

from .base import EngineOptions, ProgressCallback
from ..errors import EngineCancelled, EngineUnavailable


class SubprocessEngine:
    def __init__(self, engine_id: str, version: str, command: tuple[str, ...] | None) -> None:
        self.id = engine_id
        self.version = version
        self.command = command

    def validate(self) -> tuple[bool, str]:
        if not self.command:
            return False, "no command configured"
        executable = self.command[0]
        if Path(executable).exists() or shutil.which(executable):
            return True, "configured command is available"
        return False, f"executable not found: {executable}"

    def _args(
        self,
        source_pdf: Path,
        output_pdf: Path,
        options: EngineOptions,
    ) -> list[str]:
        if not self.command:
            raise EngineUnavailable(self.id, "no command configured")
        values = {
            "input": str(source_pdf),
            "output": str(output_pdf),
            "source_language": options.source_language,
            "target_language": options.target_language,
            "output_mode": options.output_mode,
        }
        try:
            return [part.format(**values) for part in self.command]
        except KeyError as exc:
            raise EngineUnavailable(self.id, f"unsupported command placeholder: {exc}") from exc

    def translate(
        self,
        source_pdf: Path,
        output_pdf: Path,
        options: EngineOptions,
        progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> None:
        available, reason = self.validate()
        if not available:
            raise EngineUnavailable(self.id, reason)
        args = self._args(source_pdf, output_pdf, options)
        progress(10, "engine-starting")
        process = subprocess.Popen(
            args,
            cwd=source_pdf.parent,
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            while process.poll() is None:
                if is_cancelled():
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise EngineCancelled()
                progress(10, "engine-processing")
                time.sleep(1)
            if process.returncode != 0:
                raise RuntimeError(f"engine exited with status {process.returncode}")
            progress(95, "engine-finalizing")
        finally:
            if process.poll() is None:
                process.kill()
