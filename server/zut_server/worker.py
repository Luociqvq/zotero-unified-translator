from __future__ import annotations

import shutil
import time
from pathlib import Path

from .config import Settings
from .engines import EngineOptions, build_registry
from .engines.base import TranslationEngine
from .errors import EngineCancelled, EngineUnavailable
from .storage import TaskStore


class Worker:
    def __init__(
        self,
        settings: Settings,
        store: TaskStore | None = None,
        registry: dict[str, TranslationEngine] | None = None,
    ) -> None:
        self.settings = settings
        self.settings.validate()
        self.settings.prepare()
        self.store = store or TaskStore(settings.database_path)
        self.registry = registry or build_registry(settings)

    def run_once(self) -> bool:
        task = self.store.claim_next()
        if task is None:
            return False
        source = Path(task.source_path)
        output = source.parent / "translated.pdf"
        engine = self.registry.get(task.engine)
        try:
            if engine is None:
                raise EngineUnavailable(task.engine, "engine is not enabled")
            if self.store.is_cancel_requested(task.id):
                raise EngineCancelled()
            engine.translate(
                source,
                output,
                EngineOptions(
                    source_language=task.source_language,
                    target_language=task.target_language,
                    output_mode=task.output_mode,
                ),
                lambda progress, stage: self.store.update_progress(task.id, progress, stage),
                lambda: self.store.is_cancel_requested(task.id),
            )
            if self.store.is_cancel_requested(task.id):
                raise EngineCancelled()
            if not output.exists() or output.stat().st_size == 0:
                raise RuntimeError("engine completed without producing a PDF")
            self.store.complete(task.id, str(output))
        except EngineCancelled as exc:
            output.unlink(missing_ok=True)
            self.store.fail(
                task.id,
                exc.code,
                exc.message,
                retryable=False,
                stage="cancelled",
            )
            with self.store.connect() as connection:
                connection.execute(
                    "UPDATE tasks SET state = 'cancelled', stage = 'cancelled' WHERE id = ?",
                    (task.id,),
                )
        except EngineUnavailable as exc:
            output.unlink(missing_ok=True)
            self.store.fail(
                task.id,
                exc.code,
                exc.message,
                retryable=exc.retryable,
                stage="engine-unavailable",
            )
        except Exception as exc:
            output.unlink(missing_ok=True)
            self.store.fail(
                task.id,
                "ENGINE_FAILED",
                "PDF engine failed (" + type(exc).__name__ + "). Check engine dependencies, LLM configuration and PDF input.",
                retryable=True,
                stage="failed",
            )
        return True

    def run_forever(self) -> None:
        self.store.recover_processing()
        while True:
            if not self.run_once():
                time.sleep(self.settings.worker_poll_seconds)


def cleanup_expired(settings: Settings) -> int:
    settings.validate()
    settings.prepare()
    store = TaskStore(settings.database_path)
    removed = 0
    for task_id, source_path, output_path in list(store.expired_paths()):
        task_dir = Path(source_path).parent if source_path else None
        if task_dir and task_dir.name == task_id:
            shutil.rmtree(task_dir, ignore_errors=True)
        else:
            for path in (source_path, output_path):
                if path:
                    Path(path).unlink(missing_ok=True)
        store.delete_task(task_id)
        removed += 1
    return removed


def main() -> None:
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Run the ZUT translation worker")
    parser.add_argument("--once", action="store_true", help="process one queued task and exit")
    args = parser.parse_args()
    settings = Settings.from_env()
    worker = Worker(settings)
    if args.once:
        worker.run_once()
        return
    worker.run_forever()


if __name__ == "__main__":
    main()
