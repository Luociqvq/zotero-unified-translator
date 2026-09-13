from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ZutError(Exception):
    code: str
    message: str
    status: int = 400
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_dict(self, request_id: str) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "requestId": request_id,
            "details": self.details,
        }


class EngineUnavailable(ZutError):
    def __init__(self, engine: str, reason: str) -> None:
        super().__init__(
            code="ENGINE_UNAVAILABLE",
            message=f"translation engine '{engine}' is unavailable",
            status=503,
            retryable=False,
            details={"engine": engine, "reason": reason},
        )


class EngineCancelled(ZutError):
    def __init__(self) -> None:
        super().__init__(
            code="TASK_CANCELLED",
            message="translation task was cancelled",
            status=409,
            retryable=False,
        )
