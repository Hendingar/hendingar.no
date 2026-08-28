"""Rule-based checks are pure functions, so they test without Azure or a network."""

from datetime import UTC, datetime, timedelta

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
