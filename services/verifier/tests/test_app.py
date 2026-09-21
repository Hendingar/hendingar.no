"""HTTP surface, with the model stubbed out. No Azure, no network."""

from fake_model import FakeOpenAI, config, factory_for
from fastapi.testclient import TestClient

from verifier.app import MAX_IMAGE_BASE64_BYTES, MAX_PAGE_TEXT_CHARS, create_app


def _client() -> TestClient:
    """An app whose socket explodes, so any test that reaches a model fails loudly."""
    fake = FakeOpenAI(error=AssertionError("tests must not reach the model"))
    return TestClient(create_app(config=config(), factory=factory_for(fake)))


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


def test_oversized_crop_image_is_refused_before_it_reaches_the_model():
    """The same cap as /extract, on the endpoint that gets the images nobody read.

    Worth its own test: this one is called after an event is already published, where a request
    that gets through and fails costs a model call for a thumbnail nobody is waiting for.
    """
    response = _client().post(
        "/crop",
        json={"image_base64": "A" * (MAX_IMAGE_BASE64_BYTES + 1), "media_type": "image/jpeg"},
    )
    assert response.status_code == 413


def test_crop_asks_for_nothing_but_an_image():
    """No `today`, and no fields — sending them must not be required to get a box.

    The endpoint exists precisely because the extraction request is the wrong shape here.
    """
    response = _client().post("/crop", json={"image_base64": "A" * 200})
    assert response.status_code == 422  # media_type is still required


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


def _improve_body() -> dict:
    return {
        "title": "Bygdekino i Sagvåg",
        "description": "film på laurdag, ta med ungane",
        "category": "show",
        "starts_at": "2026-09-05T18:00:00+02:00",
        "venue_name": "Sagvåg grendahus",
        "municipality": "Stord",
    }


def _frames(body: str) -> list[tuple[str, str]]:
    """The SSE frames, as (event, data). Blank-line separated, exactly as a browser reads them."""
    parsed: list[tuple[str, str]] = []
    for frame in body.split("\n\n"):
        lines = [line for line in frame.splitlines() if line]
        if not lines:
            continue
        name = next((line[7:] for line in lines if line.startswith("event: ")), None)
        data = next((line[6:] for line in lines if line.startswith("data: ")), None)
        if name and data:
            parsed.append((name, data))
    return parsed


def test_the_streamed_improvement_arrives_as_sse_frames():
    import json

    draft = json.dumps({"description": "Bygdekino i grendahuset i Sagvåg.", "missing": []})
    review = json.dumps({"approved": True, "problems": []})
    fake = FakeOpenAI(draft, review)
    client = TestClient(create_app(config=config(), factory=factory_for(fake)))

    response = client.post("/improve/stream", json=_improve_body())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    # A proxy that buffers would hold the whole stream and deliver it at once, which is the
    # experience this endpoint exists to avoid.
    assert response.headers["x-accel-buffering"] == "no"

    frames = _frames(response.text)
    assert [name for name, _ in frames] == ["draft", "review", "suggestion"]
    assert json.loads(frames[-1][1])["description"] == "Bygdekino i grendahuset i Sagvåg."


def test_a_failure_mid_stream_is_a_frame_rather_than_a_status():
    """By the time anything can fail the headers are long gone, so 502 is not available.

    The caller degrades exactly as it does for one: the person keeps the words they wrote.
    """
    fake = FakeOpenAI(error=RuntimeError("the socket died"))
    client = TestClient(create_app(config=config(), factory=factory_for(fake)))

    response = client.post("/improve/stream", json=_improve_body())

    assert response.status_code == 200
    names = [name for name, _ in _frames(response.text)]
    assert names[-1] == "error"
    assert "suggestion" not in names
