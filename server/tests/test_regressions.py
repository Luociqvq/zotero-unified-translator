import io
import sys
from types import SimpleNamespace

import pytest

from test_api import make_pdf
from zut_server.app import create_app
from zut_server.config import Settings
from zut_server.engines import EngineOptions
from zut_server.engines.pdf2zh_next import PDF2ZHNextEngine
from zut_server.worker import Worker


def test_retry_failed_task_and_reject_reused_id(tmp_path):
    settings = Settings.from_env({'ZUT_DATA_DIR': str(tmp_path), 'ZUT_ENGINE': 'mock', 'ZUT_ENABLED_ENGINES': 'mock', 'ZUT_ALLOW_MOCK_ENGINE': '1'})
    client = create_app(settings).test_client()
    def submit(language='zh-CN'):
        return client.post('/api/v1/tasks', data={'file': (io.BytesIO(make_pdf()), 'input.pdf'), 'clientRequestId': 'same', 'targetLanguage': language})
    first = submit()
    assert first.status_code == 202
    Worker(settings).store.fail(first.json['taskId'], 'TEST', 'test', retryable=True)
    retry = submit()
    assert retry.status_code == 202
    assert retry.json['taskId'] != first.json['taskId']
    assert submit().json['taskId'] == retry.json['taskId']
    assert submit('en').status_code == 409


def test_health_does_not_import_heavy_engine():
    before = 'pdf2zh_next' in sys.modules
    engine = PDF2ZHNextEngine('https://example.invalid/v1', 'test', 'not-a-real-key')
    assert engine.validate()[0]
    assert ('pdf2zh_next' in sys.modules) == before


@pytest.mark.parametrize('mode', ['bilingual', 'translated'])
def test_real_engine_settings_and_output_contract(tmp_path, monkeypatch, mode):
    # Import the installed engine and validate real settings; replace only network/translation work.
    import pdf2zh_next
    engine = PDF2ZHNextEngine('https://example.invalid/v1', 'test-model', 'not-a-real-key')
    source = tmp_path / 'source.pdf'
    source.write_bytes(make_pdf())
    produced = tmp_path / 'engine-output.pdf'
    produced.write_bytes(make_pdf())
    async def events(settings, path):
        settings.validate_settings()
        assert settings.translation.lang_out == 'zh'
        assert settings.pdf.no_mono == (mode == 'bilingual')
        assert settings.pdf.no_dual == (mode == 'translated')
        yield {'type': 'progress_update', 'overall_progress': 50, 'stage': 'translating'}
        yield {'type': 'finish', 'translate_result': SimpleNamespace(dual_pdf_path=produced, mono_pdf_path=produced)}
    monkeypatch.setattr(pdf2zh_next, 'do_translate_async_stream', events)
    output = tmp_path / 'translated.pdf'
    engine.translate(source, output, EngineOptions(source_language='auto', target_language='zh-CN', output_mode=mode), lambda *args: None, lambda: False)
    assert output.read_bytes() == produced.read_bytes()
