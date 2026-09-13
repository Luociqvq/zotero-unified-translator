from __future__ import annotations

import asyncio
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
import importlib.util
import shutil
from pathlib import Path
from typing import Any, Callable, Mapping

from .base import EngineOptions, ProgressCallback
from ..errors import EngineCancelled, EngineUnavailable


class PDF2ZHNextEngine:
    """Native adapter for the pinned pdf2zh-next Python API."""

    id = "pdf2zh_next"
    version = "2.9.0"

    def __init__(self, endpoint: str, model: str, api_key: str | None) -> None:
        self.endpoint = endpoint.strip()
        self.model = model.strip()
        self.api_key = api_key.strip() if api_key else None

    def validate(self) -> tuple[bool, str]:
        try:
            installed_version = package_version("pdf2zh-next")
        except PackageNotFoundError:
            return False, "pdf2zh-next==2.9.0 is not installed"
        if installed_version != self.version:
            return False, f"pdf2zh-next=={self.version} is required (found {installed_version})"
        if importlib.util.find_spec("pdf2zh_next") is None:
            return False, "pdf2zh-next package is installed but cannot be imported"
        if not self.api_key:
            return False, "ZUT_LLM_API_KEY is not configured"
        if not self.endpoint:
            return False, "ZUT_LLM_ENDPOINT is not configured"
        if not self.model:
            return False, "ZUT_LLM_MODEL is not configured"
        return True, "pdf2zh-next 2.9.0 and the LLM configuration are available"

    @staticmethod
    def _language(value: str) -> str:
        return {
            "zh-CN": "zh",
            "zh-TW": "zh-TW",
        }.get(value, value)

    @staticmethod
    def _result_value(result: Any, name: str) -> Any:
        if isinstance(result, Mapping):
            return result.get(name)
        return getattr(result, name, None)

    def _settings(self, source_pdf: Path, options: EngineOptions, output_dir: Path) -> Any:
        from pdf2zh_next import (
            BasicSettings,
            OpenAISettings,
            PDFSettings,
            SettingsModel,
            TranslationSettings,
        )

        return SettingsModel(
            basic=BasicSettings(debug=False),
            translation=TranslationSettings(
                lang_in=self._language(options.source_language),
                lang_out=self._language(options.target_language),
                output=str(output_dir),
                qps=4,
                pool_max_workers=1,
                no_auto_extract_glossary=True,
            ),
            pdf=PDFSettings(
                no_dual=options.output_mode == "translated",
                no_mono=options.output_mode == "bilingual",
                watermark_output_mode="no_watermark",
            ),
            translate_engine_settings=OpenAISettings(
                openai_model=self.model,
                openai_base_url=self.endpoint,
                openai_api_key=self.api_key,
            ),
        )

    async def _consume(
        self,
        settings: Any,
        source_pdf: Path,
        progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> Any:
        from pdf2zh_next import do_translate_async_stream

        result: Any = None

        async def consume_events() -> None:
            nonlocal result
            async for event in do_translate_async_stream(settings, source_pdf):
                event_type = event.get("type")
                if event_type in {"progress_start", "progress_update", "progress_end"}:
                    raw_progress = event.get("overall_progress", 0)
                    try:
                        progress_value = int(float(raw_progress))
                    except (TypeError, ValueError):
                        progress_value = 0
                    stage = str(event.get("stage") or event_type)
                    progress(max(1, min(99, progress_value)), stage)
                elif event_type == "finish":
                    result = event.get("translate_result")
                    return
                elif event_type == "error":
                    raise RuntimeError(str(event.get("error") or "pdf2zh-next returned an error"))

        event_task = asyncio.create_task(consume_events())
        try:
            while not event_task.done():
                if is_cancelled():
                    event_task.cancel()
                    await asyncio.gather(event_task, return_exceptions=True)
                    raise EngineCancelled()
                await asyncio.sleep(0.25)
            await event_task
        finally:
            if not event_task.done():
                event_task.cancel()
                await asyncio.gather(event_task, return_exceptions=True)
        return result

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
        if is_cancelled():
            raise EngineCancelled()

        output_dir = source_pdf.parent / "pdf2zh-next-output"
        output_dir.mkdir(parents=True, exist_ok=True)
        settings = self._settings(source_pdf, options, output_dir)
        progress(2, "pdf2zh-next-starting")
        result = asyncio.run(self._consume(settings, source_pdf, progress, is_cancelled))
        if result is None:
            raise RuntimeError("pdf2zh-next completed without a result")

        names = (
            ("no_watermark_dual_pdf_path", "dual_pdf_path")
            if options.output_mode == "bilingual"
            else ("no_watermark_mono_pdf_path", "mono_pdf_path")
        )
        translated_path = next(
            (
                Path(value)
                for name in names
                if (value := self._result_value(result, name))
                and Path(value).is_file()
                and Path(value).stat().st_size > 0
            ),
            None,
        )
        if translated_path is None:
            raise RuntimeError("pdf2zh-next did not produce the requested PDF output")
        if is_cancelled():
            raise EngineCancelled()
        shutil.copyfile(translated_path, output_pdf)
        progress(99, "pdf2zh-next-finalizing")
