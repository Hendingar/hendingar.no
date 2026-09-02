"""Rule-based checks are pure functions, so they test without Azure or a network."""

import json
from datetime import UTC, datetime, timedelta
from typing import ClassVar

import pytest

from verifier.models import CandidateEvent, VerifyRequest
from verifier.verify import check_duplicate, check_normalisation, verify


def _request(**overrides) -> VerifyRequest:
    base = {
        "title": "Konsert på Den Blå Time",
        "category": "musikk",
        "starts_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
        "venue_name": "Den Blå Time",
    }
    return VerifyRequest(**{**base, **overrides})


class TestNormalisation:
    def test_accepts_a_sane_future_event(self):
        assert check_normalisation(_request()).verdict == "pass"

    def test_rejects_an_unparseable_start(self):
        assert check_normalisation(_request(starts_at="neste torsdag")).verdict == "fail"

    def test_flags_an_end_before_its_start(self):
        starts = datetime.now(UTC) + timedelta(days=7)
        result = check_normalisation(
            _request(
                starts_at=starts.isoformat(), ends_at=(starts - timedelta(hours=1)).isoformat()
            )
        )
        assert result.verdict == "uncertain"

    def test_flags_a_past_event_as_a_probable_year_typo(self):
        past = (datetime.now(UTC) - timedelta(days=400)).isoformat()
        assert check_normalisation(_request(starts_at=past)).verdict == "uncertain"

    def test_flags_an_implausibly_distant_event(self):
        far = (datetime.now(UTC) + timedelta(days=900)).isoformat()
        assert check_normalisation(_request(starts_at=far)).verdict == "uncertain"

    def test_is_decided_without_a_model(self):
        assert check_normalisation(_request()).deterministic is True


class TestDuplicate:
    def test_passes_when_nothing_is_close(self):
        assert check_duplicate(_request()).verdict == "pass"

    def test_rejects_the_same_event_at_the_same_venue(self):
        result = check_duplicate(
            _request(
                candidates=[
                    CandidateEvent(
                        id=1,
                        title="Konsert på Den Blå Time",
                        starts_at="2026-09-12T20:00:00+02:00",
                        venue_name="Den Blå Time",
                    )
                ]
            )
        )
        assert result.verdict == "fail"

    def test_defers_a_partial_match_to_a_human(self):
        result = check_duplicate(
            _request(
                candidates=[
                    CandidateEvent(
                        id=1,
                        title="Konsert Den Blå",
                        starts_at="2026-09-12T20:00:00+02:00",
                        venue_name="Ein annan stad",
                    )
                ]
            )
        )
        assert result.verdict == "uncertain"

    def test_ignores_an_unrelated_event(self):
        result = check_duplicate(
            _request(
                candidates=[
                    CandidateEvent(
                        id=1,
                        title="Bingo i bedehuset",
                        starts_at="2026-09-12T20:00:00+02:00",
                        venue_name="Bedehuset",
                    )
                ]
            )
        )
        assert result.verdict == "pass"


class TestPipeline:
    async def test_without_a_model_it_defers_rather_than_publishing(self):
        """The safety property that matters: no model must never mean auto-publish."""
        response = await verify(None, _request(source_url="https://example.no/event"))
        assert response.recommendation == "review"
        assert all(c.reasoning for c in response.checks)

    async def test_a_broken_date_is_rejected_outright(self):
        response = await verify(None, _request(starts_at="ikkje ein dato"))
        assert response.recommendation == "reject"

    async def test_every_check_explains_itself(self):
        """The README promises auditable reasoning; an empty string would break that promise."""
        response = await verify(None, _request())
        assert len(response.checks) >= 4
        for check in response.checks:
            assert check.reasoning.strip(), f"{check.check} returned no reasoning"

    async def test_a_missing_source_alone_does_not_reject(self):
        response = await verify(None, _request())
        assert response.recommendation == "review"


@pytest.mark.parametrize("verdict_field", ["confidence"])
def test_confidence_is_bounded(verdict_field):
    result = check_normalisation(_request())
    assert 0 <= getattr(result, verdict_field) <= 100


class _RecordingClient:
    """Captures the kwargs of the one call it expects, and returns a valid strict-schema reply."""

    def __init__(self, payload: str):
        self.calls: list[dict] = []
        self._payload = payload

        outer = self

        class _Completions:
            async def create(self, **kwargs):
                outer.calls.append(kwargs)

                class _Msg:
                    content = outer._payload

                class _Choice:
                    finish_reason = "stop"
                    message = _Msg()

                class _Completion:
                    choices: ClassVar[list] = [_Choice()]

                return _Completion()

        class _Chat:
            completions = _Completions()

        self.chat = _Chat()


class _RecordingFactory:
    model = "stub-deployment"

    def __init__(self, payload: str):
        self.recorded = _RecordingClient(payload)

    def client(self):
        return self.recorded


class TestSamplingIsPinned:
    """Extraction is transcription and verdicts are stored and shown; neither may vary run to run.

    Asserted rather than trusted because the default is temperature 1.0 — dropping these two
    kwargs is a silent change with no failing test and no visible symptom until two people read
    the same poster and get different drafts.
    """

    async def test_extraction_pins_temperature_and_seed(self):
        from verifier.extract import extract_poster
        from verifier.llm import SEED, TEMPERATURE
        from verifier.models import ExtractRequest

        payload = json.dumps(
            {
                "title": "Konsert",
                "description": None,
                "category": "musikk",
                "date": "2027-01-01",
                "start_time": "20:00",
                "end_time": None,
                "venue_name": "Stord kulturhus",
                "municipality": None,
                "organizer_name": None,
                "ticket_url": None,
                "confidence": 90,
                "unreadable": [],
                "note": "Lese frå plakaten.",
            }
        )
        factory = _RecordingFactory(payload)
        await extract_poster(
            factory,  # type: ignore[arg-type]
            ExtractRequest(image_base64="A" * 200, media_type="image/jpeg", today="2026-08-28"),
        )
        (call,) = factory.recorded.calls
        assert call["temperature"] == TEMPERATURE == 0.0
        assert call["seed"] == SEED
        assert call["response_format"]["json_schema"]["strict"] is True

    async def test_judging_pins_temperature_and_seed(self):
        from verifier.llm import SEED, TEMPERATURE
        from verifier.verify import check_plausibility

        payload = json.dumps({"verdict": "pass", "confidence": 88, "reasoning": "Ser ekte ut."})
        factory = _RecordingFactory(payload)
        await check_plausibility(factory, _request())  # type: ignore[arg-type]
        (call,) = factory.recorded.calls
        assert call["temperature"] == TEMPERATURE == 0.0
        assert call["seed"] == SEED
