from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from .models import Task


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def fingerprint(file_hash: str, options: dict[str, str]) -> str:
    payload = json.dumps(options, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{file_hash}:{payload}".encode("utf-8")).hexdigest()


class TaskStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    client_request_id TEXT,
                    fingerprint TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    output_path TEXT,
                    state TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    stage TEXT NOT NULL DEFAULT 'queued',
                    source_language TEXT NOT NULL,
                    target_language TEXT NOT NULL,
                    engine TEXT NOT NULL,
                    engine_version TEXT NOT NULL,
                    output_mode TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    expires_at TEXT NOT NULL,
                    error_code TEXT,
                    error_message TEXT,
                    retryable INTEGER NOT NULL DEFAULT 0,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    page_count INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_client_request
                    ON tasks(client_request_id)
                    WHERE client_request_id IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_tasks_fingerprint
                    ON tasks(fingerprint, state);
                CREATE INDEX IF NOT EXISTS idx_tasks_queue
                    ON tasks(state, created_at);
                """
            )

    @staticmethod
    def _task(row: sqlite3.Row | None) -> Task | None:
        return Task.from_row(row) if row else None

    def get(self, task_id: str) -> Task | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return self._task(row)

    def find_duplicate(self, task_fingerprint: str, client_request_id: str | None) -> Task | None:
        with self.connect() as connection:
            if client_request_id:
                connection.execute('BEGIN IMMEDIATE')
                row = connection.execute(
                    "SELECT * FROM tasks WHERE client_request_id = ?",
                    (client_request_id,),
                ).fetchone()
                if row:
                    if row['fingerprint'] != task_fingerprint:
                        from .errors import ZutError
                        raise ZutError('IDEMPOTENCY_CONFLICT', 'clientRequestId belongs to different input', 409)
                    if row['state'] not in ('failed', 'cancelled'):
                        return self._task(row)
                    connection.execute('UPDATE tasks SET client_request_id = NULL WHERE id = ?', (row['id'],))
            row = connection.execute(
                """
                SELECT * FROM tasks
                WHERE fingerprint = ? AND state IN ('queued', 'processing', 'completed')
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (task_fingerprint,),
            ).fetchone()
        return self._task(row)

    def create(
        self,
        *,
        task_id: str,
        client_request_id: str | None,
        task_fingerprint: str,
        original_filename: str,
        source_path: str,
        source_language: str,
        target_language: str,
        engine: str,
        engine_version: str,
        output_mode: str,
        page_count: int,
        file_size: int,
        ttl_days: int,
    ) -> Task:
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO tasks (
                    id, client_request_id, fingerprint, original_filename, source_path,
                    state, progress, stage, source_language, target_language, engine,
                    engine_version, output_mode, created_at, updated_at, expires_at,
                    page_count, file_size
                ) VALUES (?, ?, ?, ?, ?, 'queued', 0, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    client_request_id,
                    task_fingerprint,
                    original_filename,
                    source_path,
                    source_language,
                    target_language,
                    engine,
                    engine_version,
                    output_mode,
                    now.isoformat(),
                    now.isoformat(),
                    (now + timedelta(days=ttl_days)).isoformat(),
                    page_count,
                    file_size,
                ),
            )
        task = self.get(task_id)
        assert task is not None
        return task

    def claim_next(self) -> Task | None:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM tasks WHERE state = 'queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                connection.commit()
                return None
            now = iso_now()
            connection.execute(
                """
                UPDATE tasks
                SET state = 'processing', stage = 'starting', updated_at = ?,
                    attempts = attempts + 1
                WHERE id = ?
                """,
                (now, row["id"]),
            )
            connection.commit()
            return self.get(row["id"])
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def update_progress(self, task_id: str, progress: int, stage: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET progress = ?, stage = ?, updated_at = ?
                WHERE id = ? AND state = 'processing'
                """,
                (max(0, min(99, progress)), stage, iso_now(), task_id),
            )

    def complete(self, task_id: str, output_path: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET state = 'completed', progress = 100, stage = 'completed',
                    output_path = ?, completed_at = ?, updated_at = ?,
                    error_code = NULL, error_message = NULL, retryable = 0
                WHERE id = ?
                """,
                (output_path, iso_now(), iso_now(), task_id),
            )

    def fail(
        self,
        task_id: str,
        code: str,
        message: str,
        *,
        retryable: bool,
        stage: str = "failed",
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET state = 'failed', stage = ?, error_code = ?, error_message = ?,
                    retryable = ?, updated_at = ?
                WHERE id = ?
                """,
                (stage, code, message[:1000], int(retryable), iso_now(), task_id),
            )

    def request_cancel(self, task_id: str) -> Task | None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET cancel_requested = 1, updated_at = ?
                WHERE id = ? AND state IN ('queued', 'processing')
                """,
                (iso_now(), task_id),
            )
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if row and row["state"] == "queued":
                connection.execute(
                    """
                    UPDATE tasks
                    SET state = 'cancelled', stage = 'cancelled', updated_at = ?
                    WHERE id = ?
                    """,
                    (iso_now(), task_id),
                )
                row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return self._task(row)

    def is_cancel_requested(self, task_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT cancel_requested FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def recover_processing(self) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE tasks
                SET state = 'failed', stage = 'worker-restarted',
                    error_code = 'WORKER_RESTARTED',
                    error_message = 'worker stopped before the task completed',
                    retryable = 1, updated_at = ?
                WHERE state = 'processing'
                """,
                (iso_now(),),
            )
        return cursor.rowcount

    def list_tasks(self, *, state: str | None, limit: int, offset: int) -> list[Task]:
        query = "SELECT * FROM tasks"
        params: list[object] = []
        if state:
            query += " WHERE state = ?"
            params.append(state)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend((limit, offset))
        with self.connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [Task.from_row(row) for row in rows]

    def expired_paths(self) -> Iterable[tuple[str, str | None, str]]:
        now = iso_now()
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, source_path, output_path
                FROM tasks
                WHERE expires_at < ? AND state IN ('completed', 'failed', 'cancelled')
                """,
                (now,),
            ).fetchall()
        for row in rows:
            yield row["id"], row["source_path"], row["output_path"]

    def delete_task(self, task_id: str) -> None:
        with self.connect() as connection:
            connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
