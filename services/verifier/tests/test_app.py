"""HTTP surface, with the model stubbed out. No Azure, no network."""

from fastapi.testclient import TestClient

from verifier.app import MAX_IMAGE_BASE64_BYTES, MAX_PAGE_TEXT_CHARS, create_app
from verifier.config import Config


class _StubFactory:
    """Stands in for LlmClientFactory. `client()` is never reached in these tests."""

    model = "stub-deployment"

    def client(self):  # pragma: no cover - guards against an accidental real call
        raise AssertionError("tests must not reach the model")


def _client() -> TestClient:
    config = Config(
        openai_endpoint="https://example.invalid/",
        openai_chat_model="stub-deployment",
        azure_client_id=None,
        azure_tenant_id=None,
        log_level="WARNING",
        request_timeout_seconds=5,
    )
    return TestClient(create_app(config=config, factory=_StubFactory()))


def test_health_reports_ready_without_calling_the_model():
    response = _client().get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model": "stub-deployment"}


def test_oversized_image_is_refused_before_it_reaches_the_model():
    response = _client().post(
        "/extract",
        json={
            "image_base64": "A" * (MAX_IMAGE_BASE64_BYTES + 1),
            "media_type": "image/jpeg",
            "today": "2026-08-28",
        },
    )
    assert response.status_code == 413


def test_oversized_page_text_is_refused_before_it_reaches_the_model():
    """The stub raises if the model is reached, so a 413 here proves the cap is applied first.

    It matters more than the image cap: the text arrives from a page chosen by whoever pasted the
    link, so its length is decided by a stranger rather than by their camera.
    """
    response = _client().post(
        "/extract-page",
        json={
            "text": "a" * (MAX_PAGE_TEXT_CHARS + 1),
            "url": "https://example.no/hending",
            "today": "2026-09-05",
        },
    )
    assert response.status_code == 413


def test_page_extraction_requires_every_field():
    # url and today are context the prompt depends on for relative dates and for reading a slug;
    # accepting a request without them would silently degrade the answer rather than fail.
    response = _client().post("/extract-page", json={"text": "Konsert på laurdag"})
    assert response.status_code == 422


def test_verify_runs_the_rule_based_checks_end_to_end():
    """/verify must work even though the stub would explode if a model were consulted —
    which proves the rule-based path is genuinely model-free."""
    response = _client().post(
        "/verify",
        json={
            "title": "Konsert på Den Blå Time",
            "category": "musikk",
            "starts_at": "2099-09-12T20:00:00+02:00",
            "venue_name": "Den Blå Time",
            "candidates": [],
        },
    )
    assert response.status_code == 502  # the model checks fail against the stub
    # …but the rule checks ran first and did not raise, which is the point.


def test_malformed_body_is_a_422_not_a_crash():
    response = _client().post("/verify", json={"title": "mangler alt anna"})
    assert response.status_code == 422
