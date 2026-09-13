from __future__ import annotations

import io

from pypdf import PdfWriter

from zut_server.app import create_app
from zut_server.config import Settings
from zut_server.worker import Worker


def make_pdf() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(output)
    return output.getvalue()


def test_health_and_mock_translation(tmp_path):
    settings = Settings.from_env(
        {
            "ZUT_DATA_DIR": str(tmp_path),
            "ZUT_ENGINE": "mock",
            "ZUT_ENABLED_ENGINES": "mock",
            "ZUT_ALLOW_MOCK_ENGINE": "1",
            "ZUT_AUTH_TOKEN": "test-token",
        }
    )
    app = create_app(settings)
    client = app.test_client()
    headers = {"Authorization": "Bearer test-token"}

    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json["engine"]["id"] == "mock"
    assert health.json["engine"]["available"] is True

    response = client.post(
        "/api/v1/tasks",
        data={
            "file": (io.BytesIO(make_pdf()), "paper.pdf"),
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "engine": "mock",
            "outputMode": "bilingual",
            "clientRequestId": "request-1",
        },
        headers=headers,
        content_type="multipart/form-data",
    )
    assert response.status_code == 202
    task_id = response.json["taskId"]
    assert response.json["state"] == "queued"

    worker = Worker(settings)
    assert worker.run_once() is True

    completed = client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert completed.status_code == 200
    assert completed.json["state"] == "completed"
    assert completed.json["progress"] == 100

    download = client.get(f"/api/v1/tasks/{task_id}/file", headers=headers)
    assert download.status_code == 200
    assert download.mimetype == "application/pdf"
    assert download.data.startswith(b"%PDF-")


def test_duplicate_request_is_idempotent(tmp_path):
    settings = Settings.from_env(
        {
            "ZUT_DATA_DIR": str(tmp_path),
            "ZUT_ENGINE": "mock",
            "ZUT_ENABLED_ENGINES": "mock",
            "ZUT_ALLOW_MOCK_ENGINE": "1",
            "ZUT_AUTH_TOKEN": "test-token",
        }
    )
    app = create_app(settings)
    client = app.test_client()
    headers = {"Authorization": "Bearer test-token"}
    form = {
        "sourceLanguage": "en",
        "targetLanguage": "zh-CN",
        "engine": "mock",
        "outputMode": "bilingual",
        "clientRequestId": "same-request",
    }

    first = client.post(
        "/api/v1/tasks",
        data={**form, "file": (io.BytesIO(make_pdf()), "paper.pdf")},
        headers=headers,
        content_type="multipart/form-data",
    )
    second = client.post(
        "/api/v1/tasks",
        data={**form, "file": (io.BytesIO(make_pdf()), "paper.pdf")},
        headers=headers,
        content_type="multipart/form-data",
    )
    assert first.status_code == 202
    assert second.status_code == 200
    assert second.json["deduplicated"] is True
    assert second.json["taskId"] == first.json["taskId"]


def test_auth_invalid_pdf_and_cancel(tmp_path):
    settings = Settings.from_env(
        {
            "ZUT_DATA_DIR": str(tmp_path),
            "ZUT_ENGINE": "mock",
            "ZUT_ENABLED_ENGINES": "mock",
            "ZUT_ALLOW_MOCK_ENGINE": "1",
            "ZUT_AUTH_TOKEN": "test-token",
        }
    )
    app = create_app(settings)
    client = app.test_client()

    unauthorized = client.get(
        "/api/v1/tasks",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert unauthorized.status_code == 401

    invalid = client.post(
        "/api/v1/tasks",
        data={"file": (io.BytesIO(b"not a pdf"), "paper.pdf")},
        headers={"Authorization": "Bearer test-token"},
        content_type="multipart/form-data",
    )
    assert invalid.status_code == 422
    assert invalid.json["code"] == "INVALID_PDF"

    queued = client.post(
        "/api/v1/tasks",
        data={
            "file": (io.BytesIO(make_pdf()), "paper.pdf"),
            "engine": "mock",
            "clientRequestId": "cancel-me",
        },
        headers={"Authorization": "Bearer test-token"},
        content_type="multipart/form-data",
    )
    task_id = queued.json["taskId"]
    cancelled = client.post(
        f"/api/v1/tasks/{task_id}/cancel",
        headers={"Authorization": "Bearer test-token"},
    )
    assert cancelled.status_code == 200
    assert cancelled.json["state"] == "cancelled"
    assert Worker(settings).run_once() is False
