from __future__ import annotations

from typing import Mapping

from .base import TranslationEngine
from .mock import MockEngine
from .pdf2zh_next import PDF2ZHNextEngine
from .subprocess import SubprocessEngine
from ..config import Settings


def build_registry(settings: Settings) -> dict[str, TranslationEngine]:
    registry: dict[str, TranslationEngine] = {}
    if settings.allow_mock_engine and "mock" in settings.enabled_engines:
        registry["mock"] = MockEngine()
    versions = {"pdf2zh": "configured"}
    for engine_id in settings.enabled_engines:
        if engine_id == "pdf2zh_next":
            registry[engine_id] = PDF2ZHNextEngine(
                settings.llm_endpoint,
                settings.llm_model,
                settings.llm_api_key,
            )
            continue
        if engine_id in versions:
            registry[engine_id] = SubprocessEngine(
                engine_id,
                versions[engine_id],
                settings.engine_commands.get(engine_id),
            )
    return registry


def health(registry: Mapping[str, TranslationEngine]) -> list[dict[str, object]]:
    result = []
    for engine_id, engine in sorted(registry.items()):
        available, reason = engine.validate()
        result.append(
            {
                "id": engine_id,
                "version": engine.version,
                "available": available,
                "reason": reason,
            }
        )
    return result
