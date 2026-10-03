"""The pile's ranking, against a fake TypeSafe socket.

What is asserted is the request that would have gone over the wire and what the endpoint does with
the reply — not whether Jev's judgement is any good, which `evals/haugen` measures against the
real thing. Everything above the socket is real: the client, the chunking, the endpoint.
"""

import json

import httpx
from fake_model import FakeOpenAI, config, factory_for
from fastapi.testclient import TestClient

from verifier.app import create_app
from verifier.haugen import CHUNK_SIZE, DESCRIPTION_CHARS, describe, rank
from verifier.jev import ENDPOINT, JevClient, JevUnavailable
from verifier.models import HaugenEvent, HaugenRequest


class FakeJev:
    """Answers every noul with a score derived from its id, and records each request body."""

    def __init__(self, *statuses: int, score: float = 0.5, model: str = "jev-1.13.0") -> None:
        self.bodies: list[dict] = []
        self.headers: list[httpx.Headers] = []
        self._statuses = list(statuses)
        self._score = score
        self._model = model

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == ENDPOINT
        body = json.loads(request.content)
        self.bodies.append(body)
        self.headers.append(request.headers)
        status = self._statuses.pop(0) if self._statuses else 200
        if status != 200:
            return httpx.Response(status, json={"detail": "nope"})
        return httpx.Response(
            200,
            json={
                "model": self._model,
                "answers": {
                    qid: {"type": "noul", "noul": self._score} for qid in body["questions"]
                },
                "usage": {"input_tokens": 250 * len(body["questions"]), "output_tokens": 0},
            },
        )


def _client(fake: FakeJev, timeout: float = 3.0) -> JevClient:
    return JevClient("test-key", timeout_seconds=timeout, transport=fake.transport())


def _event(id: int, **overrides) -> HaugenEvent:
    base = {
        "id": id,
        "title": f"Hending {id}",
        "category_label": "Musikk",
        "when": "laurdag kveld",
        "venue_name": "Grendahuset",
        "municipality": "Stord",
    }
    return HaugenEvent(**{**base, **overrides})


def _request(n: int = 3, query: str = "konsertar") -> HaugenRequest:
    return HaugenRequest(query=query, events=[_event(i) for i in range(1, n + 1)])


async def test_one_noul_per_event_with_the_search_in_state():
    fake = FakeJev(score=0.8)
    ranking = await rank(_client(fake), _request(3))

    assert len(fake.bodies) == 1
    body = fake.bodies[0]
    assert body["state"] == {"søk": "konsertar"}
    assert set(body["questions"]) == {"e1", "e2", "e3"}
    assert all(q["type"] == "noul" for q in body["questions"].values())
    assert body["questions"]["e2"]["instructions"]["hending"]["tittel"] == "Hending 2"
    assert fake.headers[0]["authorization"] == "Bearer test-key"

    assert [s.event_id for s in ranking.scores] == [1, 2, 3]
    assert all(s.score == 0.8 for s in ranking.scores)
    assert ranking.model == "jev-1.13.0"


async def test_a_pile_larger_than_a_chunk_is_split_and_kept_in_order():
    fake = FakeJev()
    ranking = await rank(_client(fake), _request(CHUNK_SIZE + 1))

    assert [len(b["questions"]) for b in fake.bodies] == [CHUNK_SIZE, 1]
    assert [s.event_id for s in ranking.scores] == list(range(1, CHUNK_SIZE + 2))
    # What the page shows under the hood: both requests, and every token they cost.
    assert ranking.requests == 2
    assert ranking.input_tokens == 250 * (CHUNK_SIZE + 1)
    assert ranking.elapsed_ms >= 0


async def test_an_empty_pile_asks_nothing():
    fake = FakeJev()
    ranking = await rank(_client(fake), HaugenRequest(query="konsertar", events=[]))

    assert fake.bodies == []
    assert ranking.scores == []


async def test_no_attention_signal_reaches_the_model():
    """Hearts, views and rank are not fields on the wire type, so they cannot be sent.

    Asserted on the wire as well, so a field added to `HaugenEvent` later with one of those
    names fails here rather than quietly turning the pile into a popularity contest.
    """
    fake = FakeJev()
    await rank(_client(fake), _request(2))

    sent = json.dumps(fake.bodies).lower()
    for word in ("heart", "hjarte", "view", "visning", "rank", "popular"):
        assert word not in sent, word


def test_descriptions_are_clipped_and_empty_fields_dropped():
    described = describe(_event(1, description="ord " * 200, organizer_name=None))

    assert len(described["skildring"]) <= DESCRIPTION_CHARS + 1
    assert described["skildring"].endswith("…")
    assert "arrangør" not in described


async def test_a_rate_limit_is_retried_once():
    fake = FakeJev(429)
    ranking = await rank(_client(fake), _request(2))

    assert len(fake.bodies) == 2
    assert len(ranking.scores) == 2


async def test_a_second_rate_limit_gives_up():
    fake = FakeJev(429, 529)
    try:
        await rank(_client(fake), _request(2))
    except JevUnavailable:
        pass
    else:
        raise AssertionError("expected JevUnavailable")


async def test_a_reply_missing_an_answer_is_unavailable_not_a_crash():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": "jev", "answers": {}, "usage": {}})

    client = JevClient("k", transport=httpx.MockTransport(handle))
    try:
        await rank(client, _request(1))
    except JevUnavailable:
        pass
    else:
        raise AssertionError("expected JevUnavailable")


def _app(jev: JevClient | None) -> TestClient:
    return TestClient(create_app(config=config(), factory=factory_for(FakeOpenAI("{}")), jev=jev))


def test_without_a_key_the_endpoint_says_it_is_off():
    response = _app(None).post("/haugen", json=_request(1).model_dump())
    assert response.status_code == 503


def test_without_a_key_none_is_built():
    assert JevClient.from_config(config()) is None
    assert JevClient.from_config(config(typesafe_api_key="k")) is not None


def test_the_endpoint_returns_one_score_per_event():
    fake = FakeJev(score=0.9)
    response = _app(_client(fake)).post("/haugen", json=_request(2).model_dump())

    assert response.status_code == 200
    assert response.json()["requests"] == 1
    assert response.json()["scores"] == [
        {"event_id": 1, "score": 0.9},
        {"event_id": 2, "score": 0.9},
    ]


def test_an_upstream_failure_is_a_502_that_does_not_echo_the_search():
    fake = FakeJev(500)
    response = _app(_client(fake)).post(
        "/haugen", json=_request(1, query="noko hemmeleg").model_dump()
    )

    assert response.status_code == 502
    assert "hemmeleg" not in response.text


def test_an_oversized_query_is_refused_before_anything_is_asked():
    fake = FakeJev()
    response = _app(_client(fake)).post(
        "/haugen", json={"query": "x" * 81, "events": [_event(1).model_dump()]}
    )

    assert response.status_code == 422
    assert fake.bodies == []
