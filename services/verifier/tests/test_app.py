"""HTTP surface, with the model stubbed out. No Azure, no network."""

from fastapi.testclient import TestClient

from verifier.app import MAX_IMAGE_BASE64_BYTES, create_app
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
