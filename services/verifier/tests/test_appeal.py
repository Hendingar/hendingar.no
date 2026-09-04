"""The appeal panel. No Azure and no network — the client factory is a stub."""

import json
from typing import ClassVar

import pytest

from verifier.appeal import JURORS, QUORUM, judge_appeal, juror_by_id
from verifier.models import AppealRequest


def _request(**overrides) -> AppealRequest:
    base = {
        "title": "Fiskefestival i Vinsen",
        "category": "festival",
        "starts_at": "2026-09-05T11:00:00+02:00",
        "venue_name": "Vinsen59",
        "rejection_reason": "Ingen kjelde-URL oppgitt.",
        "appeal": "Eg tok bilete av plakaten på butikken. Det er Vinsen båtforeining som arrangerer.",
        "juror": "advocate",
    }
    return AppealRequest(**{**base, **overrides})


class _Stub:
    """Returns a fixed payload, or raises, depending on how it was built."""

    def __init__(self, payload: str | None = None, boom: Exception | None = None):
        self._payload = payload
        self._boom = boom
        self.model = "stub-model"
        self.prompts: list[str] = []

    def client(self):
        return self

    @property
    def chat(self):
        return self

    @property
    def completions(self):
        return self

    async def create(self, **kwargs):
        if self._boom:
            raise self._boom
        self.prompts.append("\n".join(m["content"] for m in kwargs["messages"]))

        class _Msg:
            content = self._payload

        class _Choice:
            finish_reason = "stop"
            message = _Msg()

        class _Completion:
            choices: ClassVar[list] = [_Choice()]

        return _Completion()


class TestPanel:
    def test_three_seats_and_a_majority(self):
        # A panel of three with a quorum of two: one lenient or one paranoid juror cannot decide.
        assert len(JURORS) == 3
        assert QUORUM == 2
        assert QUORUM > len(JURORS) // 2

    def test_the_seats_are_genuinely_different_jobs(self):
        # Not three flavours of "is this good" — a decision has to survive three directions.
        briefs = [j.brief for j in JURORS]
        assert len(set(briefs)) == 3
        assert {j.id for j in JURORS} == {"skeptic", "advocate", "local"}

    def test_an_unknown_seat_is_not_invented(self):
        assert juror_by_id("nope") is None
        assert juror_by_id("skeptic") is not None


class TestJudging:
    async def test_a_vote_carries_its_reasoning_and_who_cast_it(self):
        stub = _Stub(json.dumps({"publish": True, "confidence": 82, "reasoning": "Verkar ekte."}))
        verdict = await judge_appeal(stub, juror_by_id("advocate"), _request())
        assert verdict.publish is True
        assert verdict.confidence == 82
        assert verdict.juror == "advocate"
        assert verdict.name == "Forsvararen"
        assert verdict.model == "stub-model"

    async def test_the_juror_sees_the_case_and_what_was_said_against_it(self):
        """A juror arguing with a stated reason, not with a mood."""
        stub = _Stub(json.dumps({"publish": True, "confidence": 70, "reasoning": "Greitt."}))
        await judge_appeal(stub, juror_by_id("skeptic"), _request())
        prompt = stub.prompts[0]
        assert "Vinsen båtforeining" in prompt  # the sender's own words
        assert "Ingen kjelde-URL oppgitt." in prompt  # what the check said
        assert "Fiskefestival i Vinsen" in prompt  # the event itself

    async def test_confidence_is_clamped(self):
        stub = _Stub(json.dumps({"publish": True, "confidence": 400, "reasoning": "x"}))
        assert (await judge_appeal(stub, juror_by_id("local"), _request())).confidence == 100

    async def test_a_juror_that_cannot_answer_votes_no(self):
        """It never raises, so one bad call cannot take the panel down with it."""
        stub = _Stub(boom=RuntimeError("upstream on fire"))
        verdict = await judge_appeal(stub, juror_by_id("local"), _request())
        assert verdict.publish is False
        assert verdict.confidence == 0
        assert "ikkje tilgjengeleg" in verdict.reasoning
        assert verdict.model is None

    async def test_a_filtered_response_votes_no(self):
        stub = _Stub(payload=None)
        verdict = await judge_appeal(stub, juror_by_id("skeptic"), _request())
        assert verdict.publish is False


class TestBounds:
    def test_an_empty_case_is_not_a_case(self):
        # It reaches a model, so it is bounded here as well as in the app.
        with pytest.raises(ValueError):
            _request(appeal="kort")

    def test_a_very_long_case_is_refused(self):
        with pytest.raises(ValueError):
            _request(appeal="a" * 2001)
