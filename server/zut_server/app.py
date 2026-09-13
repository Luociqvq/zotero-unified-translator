from __future__ import annotations

import hashlib
import hmac
import logging
import shutil
import uuid
from pathlib import Path
from urllib.parse import quote

from flask import Flask, g, jsonify, request, send_file
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.utils import secure_filename

from .config import Settings
from .engines.registry import build_registry, health as engine_health
from .errors import ZutError
from .storage import TaskStore, fingerprint

LOGGER = logging.getLogger("zut.backend")
ALLOWED_OUTPUT_MODES = {"bilingual", "translated"}
ALLOWED_LANGUAGES = {"auto", "zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "es"}


def _is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "localhost", "::1"}


def _task_url(task_id: str) -> str:
    return f"/api/v1/tasks/{quote(task_id)}/file"


def _task_payload(task, task_url: bool = True) -> dict:
    return task.to_dict(_task_url(task.id) if task_url else None)


def _validate_pdf(path: Path, max_pages: int) -> int:
    with path.open("rb") as handle:
        header = handle.read(5)
    if path.stat().st_size < 5 or header != b"%PDF-":
        raise ZutError("INVALID_PDF", "uploaded file is not a PDF", 422)
    try:
        from pypdf import PdfReader

        page_count = len(PdfReader(str(path), strict=False).pages)
    except Exception as exc:
        raise ZutError("INVALID_PDF", "PDF could not be parsed", 422) from exc
    if page_count < 1:
        raise ZutError("INVALID_PDF", "PDF has no pages", 422)
    if page_count > max_pages:
        raise ZutError(
            "PDF_TOO_LARGE",
            f"PDF contains {page_count} pages; maximum is {max_pages}",
            413,
            details={"pageCount": page_count, "maxPages": max_pages},
        )
    return page_count


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_app(
    settings: Settings | None = None,
    store: TaskStore | None = None,
) -> Flask:
    settings = settings or Settings.from_env()
    settings.validate()
    settings.prepare()
    store = store or TaskStore(settings.database_path)
    registry = build_registry(settings)

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = settings.max_file_bytes
    app.extensions["zut_settings"] = settings
    app.extensions["zut_store"] = store
    app.extensions["zut_registry"] = registry

    @app.before_request
    def request_context() -> None:
        g.zut_request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        if not request.path.startswith("/api/v1/"):
            return
        if request.path == "/api/v1/health" and _is_loopback(settings.bind_host):
            return
        if not settings.auth_token:
            return
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(token, settings.auth_token):
            raise ZutError("UNAUTHORIZED", "valid bearer token required", 401)

    @app.errorhandler(ZutError)
    def handle_zut_error(error: ZutError):
        return jsonify(error.to_dict(g.get("zut_request_id", str(uuid.uuid4())))), error.status

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_error):
        error = ZutError(
            "FILE_TOO_LARGE",
            "uploaded file exceeds the configured limit",
            413,
            details={"maxFileBytes": settings.max_file_bytes},
        )
        return jsonify(error.to_dict(g.get("zut_request_id", str(uuid.uuid4())))), 413

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        result = ZutError(
            f"HTTP_{error.code}",
            error.description,
            error.code or 500,
            retryable=False,
        )
        return jsonify(result.to_dict(g.get("zut_request_id", str(uuid.uuid4())))), error.code

    @app.errorhandler(Exception)
    def handle_unexpected(error: Exception):
        LOGGER.exception("request failed", extra={"request_id": g.get("zut_request_id")})
        result = ZutError(
            "INTERNAL_ERROR",
            "unexpected backend error",
            500,
            retryable=True,
        )
        return jsonify(result.to_dict(g.get("zut_request_id", str(uuid.uuid4())))), 500

    @app.get("/api/v1/health")
    def health():
        engines = engine_health(registry)
        configured = next((item for item in engines if item["id"] == settings.engine), None)
        return jsonify(
            {
                "status": "ok" if configured and configured["available"] else "degraded",
                "service": "zut-backend",
                "apiVersion": "1",
                "workerMode": "external-polling",
                "engine": configured,
                "engines": engines,
                "limits": {
                    "maxFileBytes": settings.max_file_bytes,
                    "maxPages": settings.max_pages,
                },
                "features": {
                    "polling": True,
                    "sse": False,
                    "cancel": True,
                },
            }
        )

    @app.post("/api/v1/tasks")
    def create_task():
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            raise ZutError("FILE_REQUIRED", "multipart field 'file' is required", 400)

        source_language = request.form.get("sourceLanguage", "auto").strip()
        target_language = request.form.get("targetLanguage", "zh-CN").strip()
        engine_id = request.form.get("engine", settings.engine).strip()
        output_mode = request.form.get("outputMode", "bilingual").strip()
        client_request_id = request.form.get("clientRequestId", "").strip() or None
        if source_language not in ALLOWED_LANGUAGES:
            raise ZutError("INVALID_SOURCE_LANGUAGE", "unsupported source language", 422)
        if target_language not in ALLOWED_LANGUAGES - {"auto"}:
            raise ZutError("INVALID_TARGET_LANGUAGE", "unsupported target language", 422)
        if output_mode not in ALLOWED_OUTPUT_MODES:
            raise ZutError("INVALID_OUTPUT_MODE", "outputMode must be bilingual or translated", 422)
        engine = registry.get(engine_id)
        if engine is None:
            raise ZutError("ENGINE_DISABLED", "requested engine is not enabled", 422)
        available, reason = engine.validate()
        if not available:
            raise ZutError(
                "ENGINE_UNAVAILABLE",
                f"translation engine '{engine_id}' is unavailable",
                503,
                details={"reason": reason},
            )

        task_id = str(uuid.uuid4())
        task_dir = settings.data_dir / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=False)
        filename = secure_filename(upload.filename) or "source.pdf"
        if not filename.lower().endswith(".pdf"):
            shutil.rmtree(task_dir, ignore_errors=True)
            raise ZutError("INVALID_FILE_TYPE", "only PDF files are accepted", 415)
        source_path = task_dir / "source.pdf"
        try:
            upload.save(source_path)
            file_size = source_path.stat().st_size
            if file_size > settings.max_file_bytes:
                raise ZutError("FILE_TOO_LARGE", "uploaded file exceeds the configured limit", 413)
            page_count = _validate_pdf(source_path, settings.max_pages)
            file_hash = _sha256(source_path)
            options = {
                "sourceLanguage": source_language,
                "targetLanguage": target_language,
                "engine": engine_id,
                "engineVersion": engine.version,
                "outputMode": output_mode,
            }
            task_fingerprint = fingerprint(file_hash, options)
            duplicate = store.find_duplicate(task_fingerprint, client_request_id)
            if duplicate:
                shutil.rmtree(task_dir, ignore_errors=True)
                return jsonify(
                    {
                        **_task_payload(duplicate),
                        "deduplicated": True,
                    }
                ), 200
            task = store.create(
                task_id=task_id,
                client_request_id=client_request_id,
                task_fingerprint=task_fingerprint,
                original_filename=filename,
                source_path=str(source_path),
                source_language=source_language,
                target_language=target_language,
                engine=engine_id,
                engine_version=engine.version,
                output_mode=output_mode,
                page_count=page_count,
                file_size=file_size,
                ttl_days=settings.artifact_ttl_days,
            )
        except ZutError:
            shutil.rmtree(task_dir, ignore_errors=True)
            raise
        except Exception:
            shutil.rmtree(task_dir, ignore_errors=True)
            raise
        return jsonify(_task_payload(task)), 202

    @app.get("/api/v1/tasks/<task_id>")
    def get_task(task_id: str):
        task = store.get(task_id)
        if task is None:
            raise ZutError("TASK_NOT_FOUND", "task does not exist", 404)
        return jsonify(_task_payload(task))

    @app.post("/api/v1/tasks/<task_id>/cancel")
    def cancel_task(task_id: str):
        task = store.get(task_id)
        if task is None:
            raise ZutError("TASK_NOT_FOUND", "task does not exist", 404)
        updated = store.request_cancel(task_id)
        assert updated is not None
        return jsonify(_task_payload(updated))

    @app.get("/api/v1/tasks/<task_id>/file")
    def download_task(task_id: str):
        task = store.get(task_id)
        if task is None:
            raise ZutError("TASK_NOT_FOUND", "task does not exist", 404)
        if task.state != "completed" or not task.output_path:
            raise ZutError("FILE_NOT_READY", "translated PDF is not ready", 409, retryable=True)
        output_path = Path(task.output_path)
        if not output_path.is_file():
            raise ZutError("FILE_MISSING", "translated PDF is no longer available", 410)
        return send_file(
            output_path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"{Path(task.original_filename).stem}.zut.pdf",
            max_age=0,
        )

    @app.get("/api/v1/tasks")
    def list_tasks():
        raw_limit = request.args.get("limit", "20")
        raw_offset = request.args.get("offset", "0")
        try:
            limit = max(1, min(100, int(raw_limit)))
            offset = max(0, int(raw_offset))
        except ValueError as exc:
            raise ZutError("INVALID_PAGINATION", "limit and offset must be integers", 422) from exc
        state = request.args.get("state") or None
        tasks = store.list_tasks(state=state, limit=limit, offset=offset)
        return jsonify(
            {
                "items": [_task_payload(task) for task in tasks],
                "limit": limit,
                "offset": offset,
            }
        )

    return app


def main() -> None:
    from waitress import serve

    settings = Settings.from_env()
    application = create_app(settings)
    serve(application, host=settings.bind_host, port=settings.port)


if __name__ == "__main__":
    main()
