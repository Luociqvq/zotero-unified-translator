from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Task:
    id: str
    client_request_id: str | None
    fingerprint: str
    original_filename: str
    source_path: str
    output_path: str | None
    state: str
    progress: int
    stage: str
    source_language: str
    target_language: str
    engine: str
    engine_version: str
    output_mode: str
    created_at: str
    updated_at: str
    completed_at: str | None
    expires_at: str
    error_code: str | None
    error_message: str | None
    retryable: bool
    cancel_requested: bool
    page_count: int
    file_size: int
    attempts: int

    @classmethod
    def from_row(cls, row: Any) -> "Task":
        return cls(
            id=row["id"],
            client_request_id=row["client_request_id"],
            fingerprint=row["fingerprint"],
            original_filename=row["original_filename"],
            source_path=row["source_path"],
            output_path=row["output_path"],
            state=row["state"],
            progress=int(row["progress"]),
            stage=row["stage"],
            source_language=row["source_language"],
            target_language=row["target_language"],
            engine=row["engine"],
            engine_version=row["engine_version"],
            output_mode=row["output_mode"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            completed_at=row["completed_at"],
            expires_at=row["expires_at"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            retryable=bool(row["retryable"]),
            cancel_requested=bool(row["cancel_requested"]),
            page_count=int(row["page_count"]),
            file_size=int(row["file_size"]),
            attempts=int(row["attempts"]),
        )

    def to_dict(self, download_url: str | None = None) -> dict[str, Any]:
        result = {
            "taskId": self.id,
            "state": self.state,
            "progress": self.progress,
            "stage": self.stage,
            "originalFilename": self.original_filename,
            "sourceLanguage": self.source_language,
            "targetLanguage": self.target_language,
            "engine": self.engine,
            "engineVersion": self.engine_version,
            "outputMode": self.output_mode,
            "pageCount": self.page_count,
            "fileSize": self.file_size,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "completedAt": self.completed_at,
            "retryable": self.retryable,
            "canCancel": self.state in {"queued", "processing"} and not self.cancel_requested,
            "cancelRequested": self.cancel_requested,
            "attempts": self.attempts,
        }
        if self.error_code:
            result["error"] = {
                "code": self.error_code,
                "message": self.error_message,
                "retryable": self.retryable,
            }
        if download_url and self.state == "completed":
            result["downloadUrl"] = download_url
        return result
