from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    value = env.get(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _float(env: Mapping[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc


def _command(env: Mapping[str, str], name: str) -> tuple[str, ...] | None:
    value = env.get(name, "").strip()
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} must be a JSON array") from exc
    if not isinstance(parsed, list) or not parsed or not all(
        isinstance(part, str) and part for part in parsed
    ):
        raise ValueError(f"{name} must be a non-empty JSON array of strings")
    return tuple(parsed)


@dataclass(frozen=True)
class Settings:
    bind_host: str
    port: int
    data_dir: Path
    auth_token: str | None
    max_file_bytes: int
    max_pages: int
    engine: str
    enabled_engines: tuple[str, ...]
    allow_mock_engine: bool
    artifact_ttl_days: int
    worker_poll_seconds: float
    engine_commands: dict[str, tuple[str, ...]]
    llm_provider: str
    llm_endpoint: str
    llm_model: str
    llm_api_key: str | None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if env is None else env
        engine = values.get("ZUT_ENGINE", "pdf2zh_next").strip()
        enabled = tuple(
            item.strip()
            for item in values.get("ZUT_ENABLED_ENGINES", engine).split(",")
            if item.strip()
        )
        if engine not in enabled:
            enabled = (engine, *enabled)
        data_dir = Path(values.get("ZUT_DATA_DIR", "./data")).expanduser()
        return cls(
            bind_host=values.get("ZUT_BIND_HOST", "127.0.0.1").strip(),
            port=_int(values, "ZUT_PORT", 8890),
            data_dir=data_dir,
            auth_token=values.get("ZUT_AUTH_TOKEN") or None,
            max_file_bytes=_int(values, "ZUT_MAX_FILE_BYTES", 100 * 1024 * 1024),
            max_pages=_int(values, "ZUT_MAX_PAGES", 200),
            engine=engine,
            enabled_engines=enabled,
            allow_mock_engine=values.get("ZUT_ALLOW_MOCK_ENGINE", "0").lower()
            in {"1", "true", "yes"},
            artifact_ttl_days=_int(values, "ZUT_ARTIFACT_TTL_DAYS", 7),
            worker_poll_seconds=_float(values, "ZUT_WORKER_POLL_SECONDS", 1.0),
            engine_commands={
                "pdf2zh": _command(values, "ZUT_PDF2ZH_COMMAND"),
                "pdf2zh_next": _command(values, "ZUT_PDF2ZH_NEXT_COMMAND"),
            },
            llm_provider=values.get("ZUT_LLM_PROVIDER", "openai").strip(),
            llm_endpoint=values.get("ZUT_LLM_ENDPOINT", "https://api.openai.com/v1").strip(),
            llm_model=values.get("ZUT_LLM_MODEL", "gpt-4o-mini").strip(),
            llm_api_key=values.get("ZUT_LLM_API_KEY") or None,
        )

    def validate(self) -> None:
        if not 1024 <= self.max_file_bytes <= 5 * 1024 * 1024 * 1024:
            raise ValueError("ZUT_MAX_FILE_BYTES must be between 1 KiB and 5 GiB")
        if not 1 <= self.max_pages <= 10000:
            raise ValueError("ZUT_MAX_PAGES must be between 1 and 10000")
        if self.artifact_ttl_days < 1:
            raise ValueError("ZUT_ARTIFACT_TTL_DAYS must be at least 1")
        if self.bind_host not in {"127.0.0.1", "localhost", "::1"} and not self.auth_token:
            raise ValueError("ZUT_AUTH_TOKEN is required when binding beyond localhost")

    def prepare(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "tasks").mkdir(parents=True, exist_ok=True)

    @property
    def database_path(self) -> Path:
        return self.data_dir / "zut.sqlite3"
