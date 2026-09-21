"""Rule-based checks are pure functions, so they test without Azure or a network."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from fake_model import FakeOpenAI, factory_for

from verifier.models import CandidateEvent, VerifyRequest
from verifier.verify import (
    check_coverage,
    check_duplicate,
    check_normalisation,
    model_checks,
    verify,
)


def _request(**overrides) -> VerifyRequest:
    base = {
        "title": "Konsert på Den Blå Time",
        "category": "musikk",
        "starts_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
        "venue_name": "Den Blå Time",
        # Inside the covered area, because that is the ordinary case and every pipeline test below
        # is about something else. A default of `None` would put `coverage` at "uncertain" in all
        # of them and quietly turn assertions about corroboration into assertions about geography.
        "municipality": "Stord",
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


class TestCoverage:
    """The Bergen concert.

    A real submission: The Watch playing Genesis in Grieghallen, Bergen. Plausibility said 90%
    ("this looks like a genuine concert"), categorisation 90%, normalisation 100%, duplicate 95% —
    every answer correct, and the event went live on a calendar for Sunnhordland, because not one
    of those five questions was "where is this".

    The tests below are in two halves, and the second half is the longer one on purpose. Refusing
    Bergen is easy; the risk in a rule like this is refusing Leirvik.
    """

    def test_the_bergen_concert_is_stopped(self):
        result = check_coverage(_request(municipality="Bergen", venue_name="Grieghallen"))
        assert result.verdict == "fail"
        assert "Bergen" in result.reasoning
        # And the reasoning says where we DO publish, because the sender cannot guess.
        assert "Stord" in result.reasoning and "Fitjar" in result.reasoning

    def test_it_is_decided_without_a_model(self):
        """Which kommune a place is in is a fact, so no call is made and none can drift."""
        assert check_coverage(_request(municipality="Stord")).deterministic is True
        assert check_coverage(_request(municipality="Stord")).model is None

    def test_a_covered_municipality_passes(self):
        for municipality in ("Stord", "Bømlo", "Fitjar"):
            assert check_coverage(_request(municipality=municipality)).verdict == "pass"

    def test_a_village_passes(self):
        """What people actually type. Bremnes stopped being a municipality in 1963 and is still
        what Bømlo kulturhus reports as its city."""
        assert check_coverage(_request(municipality="Bremnes")).verdict == "pass"
        assert check_coverage(_request(municipality="Leirvik")).verdict == "pass"

    def test_a_venue_name_can_place_an_event_on_its_own(self):
        result = check_coverage(_request(municipality=None, venue_name="Stord kulturhus"))
        assert result.verdict == "pass"

    def test_stordal_is_not_stord(self):
        assert check_coverage(_request(municipality="Stordal")).verdict == "fail"

    def test_a_missing_kommune_asks_instead_of_refusing(self):
        """The branch that keeps the field safely optional: no kommune is a question, not a no."""
        result = check_coverage(_request(municipality=None, venue_name="Bedehuset"))
        assert result.verdict == "uncertain"
        assert "kommune" in result.reasoning.lower()

    def test_a_county_asks_instead_of_refusing(self):
        """Stord is in Vestland, so "Vestland" is not evidence the event is somewhere else."""
        for stated in ("Vestland", "Hordaland", "Sunnhordland", "Noreg"):
            assert check_coverage(_request(municipality=stated)).verdict == "uncertain"

    def test_a_venue_name_cannot_argue_an_event_out_of_the_area(self):
        """There is a pub called Bergen Bar in most towns in Norway."""
        result = check_coverage(_request(municipality="Stord", venue_name="Bergen Bar"))
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

    async def test_an_event_outside_the_area_is_rejected_outright(self):
        """The regression, through the whole pipeline and with no model in play.

        `verify(None, …)` is the no-model path, so plausibility defers and the recommendation
        would otherwise be `review`. `reject` here can only have come from coverage.
        """
        response = await verify(None, _request(municipality="Bergen", venue_name="Grieghallen"))
        assert response.recommendation == "reject"
        assert "Bergen" in response.summary

    async def test_coverage_is_a_blocking_check(self):
        from verifier.verify import BLOCKING_CHECKS

        assert "coverage" in BLOCKING_CHECKS

    async def test_every_submission_gets_a_coverage_verdict(self):
        """Including the no-model path: it is a rule, so an unavailable model cannot skip it."""
        response = await verify(None, _request())
        assert any(c.check == "coverage" for c in response.checks)


class _StubFactory:
    """Every model-judged check passes confidently, so only the rules decide the outcome."""

    def __init__(self, payload: str):
        self._payload = payload

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class TestAdvisoryChecksDoNotBlock:
    """The fishing festival and the opening party.

    Two real submissions, refused by the same mistake twice.

    The festival — a poster photographed off a noticeboard — passed normalisation at 100%,
    duplicate at 95%, plausibility at 90% and categorisation at 90%, and was still held back
    because it had no source URL. Corroboration reported 60% confidence, which sat under the
    floor, and "we could not cross-check this" became "a human must look at it" in a queue with
    nobody in it.

    The party was submitted as `anna` and came back "uncertain, 70%: a category like 'fest' might
    fit better". Also true, also not a reason to refuse an event, and refused all the same.

    A check that reports something worth saying is not the same as a check that decides. These
    assert which is which, in both directions.
    """

    def test_corroboration_is_not_a_blocking_check(self):
        from verifier.verify import BLOCKING_CHECKS

        assert "corroboration" not in BLOCKING_CHECKS
        # The four that genuinely say something about the event itself: is it real, do we already
        # have it, is it legible, is it here. Categorisation left for the reason recorded beside
        # the set.
        assert BLOCKING_CHECKS == {"plausibility", "duplicate", "normalisation", "coverage"}

    def test_a_missing_source_still_reports_what_it_found(self):
        from verifier.verify import check_corroboration

        result = check_corroboration(_request())
        # Honest about the gap — it just no longer decides the outcome on its own.
        assert result.verdict == "uncertain"
        assert "kjelde-URL" in result.reasoning

    async def test_a_missing_source_does_not_hold_back_an_otherwise_clean_event(self, monkeypatch):
        """The regression, end to end through `verify`."""
        from verifier import verify as verify_module
        from verifier.models import CheckResult

        async def _both_pass(_factory, _request):
            return [
                CheckResult(
                    check=check,
                    verdict="pass",
                    confidence=90,
                    reasoning="Ser ut som ei ekte lokal hending.",
                    deterministic=False,
                    model="stub",
                )
                for check in ("plausibility", "categorisation")
            ]

        monkeypatch.setattr(verify_module, "model_checks", _both_pass)

        response = await verify(object(), _request(source_url=None))

        assert response.recommendation == "publish"
        # And coverage is not the new corroboration: a stated kommune we cover is a pass, not a
        # caveat that ends up in the summary of an event we just published.
        assert next(c for c in response.checks if c.check == "coverage").verdict == "pass"
        # And the summary leads with the decision, not with the caveat. Opening on "could not be
        # confirmed" is what made a published event read as a refusal.
        assert response.summary.startswith("Alle avgjerande sjekkar gjekk gjennom")
        assert "kjelde-URL" in response.summary

    async def test_a_suboptimal_category_does_not_hold_back_an_event(self, monkeypatch):
        """The opening party.

        Submitted as `anna`, and the check came back "uncertain, 70 %: a category like 'fest' or
        'opning' might fit better". A fair remark, and it refused the event — because with no human
        queue, "review" is no. Nobody looking for that party would have failed to find it under
        `anna`; they never got the chance.
        """
        from verifier import verify as verify_module
        from verifier.models import CheckResult

        async def _plausible_but_miscategorised(_factory, _request):
            return [
                CheckResult(
                    check="plausibility",
                    verdict="pass",
                    confidence=95,
                    reasoning="Ser ut som ei ekte lokal hending.",
                    deterministic=False,
                    model="stub",
                ),
                CheckResult(
                    check="categorisation",
                    verdict="uncertain",
                    confidence=70,
                    reasoning="Tittelen tyder på ein opningsfest; 'fest' kan passe betre enn 'anna'.",
                    deterministic=False,
                    model="stub",
                ),
            ]

        monkeypatch.setattr(verify_module, "model_checks", _plausible_but_miscategorised)

        response = await verify(object(), _request())

        assert response.recommendation == "publish"
        # Published, and still told: the sender learns a better category exists and can change it.
        assert response.summary.startswith("Alle avgjerande sjekkar gjekk gjennom")
        assert "opningsfest" in response.summary

    async def test_a_low_confidence_category_does_not_hold_back_an_event(self, monkeypatch):
        """Confidence under the floor is the other half of the same door.

        `corroboration` was held back by a 60 % that sat under `CONFIDENCE_FLOOR` rather than by a
        verdict, so a `pass` at low confidence has to be covered too — otherwise the block simply
        moves.
        """
        from verifier import verify as verify_module
        from verifier.models import CheckResult

        async def _barely_sure(_factory, _request):
            return [
                CheckResult(
                    check="plausibility",
                    verdict="pass",
                    confidence=95,
                    reasoning="Ekte.",
                    deterministic=False,
                    model="stub",
                ),
                CheckResult(
                    check="categorisation",
                    verdict="pass",
                    confidence=30,
                    reasoning="Kategorien er nok greit nok.",
                    deterministic=False,
                    model="stub",
                ),
            ]

        monkeypatch.setattr(verify_module, "model_checks", _barely_sure)

        assert (await verify(object(), _request())).recommendation == "publish"

    def test_a_category_fail_is_clamped_rather_than_rejecting(self):
        """A `fail` from any check rejects, so this one must not be able to produce one.

        The prompt asks the model not to; this asserts the code does not depend on it obeying.
        Tested where the clamp is rather than through `verify`, which would only show its
        consequence.
        """
        from verifier.verify import _to_result

        answer = json.dumps(
            {"verdict": "fail", "confidence": 90, "reasoning": "Heilt feil kategori."}
        )

        result = _to_result("categorisation", answer, "stub")
        assert result.verdict == "uncertain"
        # Downgraded, not silenced: what it found is still what the sender is told.
        assert result.reasoning == "Heilt feil kategori."

        # …and the clamp is this check's alone. A `fail` from plausibility is a real refusal.
        assert _to_result("plausibility", answer, "stub").verdict == "fail"

    async def test_a_real_failure_still_stops_it(self, monkeypatch):
        from verifier import verify as verify_module
        from verifier.models import CheckResult

        async def _spam(_factory, _request):
            return [
                CheckResult(
                    check="plausibility",
                    verdict="fail",
                    confidence=95,
                    reasoning="Reklame.",
                    deterministic=False,
                    model="stub",
                ),
                CheckResult(
                    check="categorisation",
                    verdict="pass",
                    confidence=90,
                    reasoning="Greitt.",
                    deterministic=False,
                    model="stub",
                ),
            ]

        monkeypatch.setattr(verify_module, "model_checks", _spam)

        response = await verify(object(), _request(source_url=None))
        assert response.recommendation == "reject"


@pytest.mark.parametrize("verdict_field", ["confidence"])
def test_confidence_is_bounded(verdict_field):
    result = check_normalisation(_request())
    assert 0 <= getattr(result, verdict_field) <= 100


class TestSamplingIsPinned:
    """Extraction is transcription and verdicts are stored and shown; neither may vary run to run.

    Asserted rather than trusted because the default is temperature 1.0 — dropping these two
    settings is a silent change with no failing test and no visible symptom until two people read
    the same poster and get different drafts. They now live on the agent rather than on the call,
    which is a place it is easier to forget them, so the assertion is on the payload itself.
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
        fake = FakeOpenAI(payload)
        await extract_poster(
            factory_for(fake),
            ExtractRequest(image_base64="A" * 200, media_type="image/jpeg", today="2026-08-28"),
        )
        (call,) = fake.calls
        assert call["temperature"] == TEMPERATURE == 0.0
        assert call["seed"] == SEED
        assert call["response_format"]["json_schema"]["strict"] is True

    async def test_judging_pins_temperature_and_seed(self):
        """Both judging agents, because they are now built in a loop — one could drift alone."""
        from verifier.llm import SEED, TEMPERATURE
        from verifier.verify import model_checks

        payload = json.dumps({"verdict": "pass", "confidence": 88, "reasoning": "Ser ekte ut."})
        fake = FakeOpenAI(payload)
        await model_checks(factory_for(fake), _request())

        assert len(fake.calls) == 2
        for call in fake.calls:
            assert call["temperature"] == TEMPERATURE == 0.0
            assert call["seed"] == SEED
            assert call["response_format"]["json_schema"]["strict"] is True


class TestModelChecks:
    """The two checks a rule cannot decide, now asked at the same time instead of one after the
    other. What the orchestration must not change is what comes out of it."""

    @staticmethod
    def _payload(verdict: str = "pass", confidence: int = 88, reasoning: str = "Ser ekte ut."):
        return json.dumps({"verdict": verdict, "confidence": confidence, "reasoning": reasoning})

    async def test_both_checks_are_asked_and_both_come_back(self):
        fake = FakeOpenAI(self._payload())
        results = await model_checks(factory_for(fake), _request())

        assert [r.check for r in results] == ["plausibility", "categorisation"]
        assert all(r.verdict == "pass" for r in results)
        assert all(r.model == "stub-deployment" for r in results)
        # Neither is a rule, and neither may claim to be: `deterministic` is what the sender is
        # shown to tell a model's opinion from a fact about their dates.
        assert not any(r.deterministic for r in results)

    async def test_each_check_is_asked_its_own_question_about_the_same_record(self):
        """One rendering of the submission, two briefs.

        Two prompts that each named a different subset of the record is how `coverage` came to be
        missing: nothing compared the place to anything, because no prompt carried it.
        """
        fake = FakeOpenAI(self._payload())
        await model_checks(factory_for(fake), _request(municipality="Stord"))

        plausibility = fake.call_instructing("spam, reklame eller ein test")
        categorisation = fake.call_instructing("Passar kategorien")
        assert plausibility is not categorisation
        for call in (plausibility, categorisation):
            case = str(call["messages"][-1]["content"])
            assert "Konsert på Den Blå Time" in case
            assert "Stord" in case  # the place every judging prompt now carries
            assert "musikk" in case  # and the category, which only one of them used to see

    async def test_a_filtered_check_defers_to_a_human_rather_than_failing_the_event(self):
        fake = FakeOpenAI(None, finish_reason="content_filter")
        results = await model_checks(factory_for(fake), _request())

        assert [r.check for r in results] == ["plausibility", "categorisation"]
        assert all(r.verdict == "uncertain" for r in results)
        assert all(r.confidence == 0 for r in results)

    async def test_an_unreadable_answer_defers_rather_than_raising(self):
        """Close to unreachable behind a strict schema. The cost of being wrong is an event."""
        fake = FakeOpenAI("ikkje json i det heile")
        results = await model_checks(factory_for(fake), _request())

        assert all(r.verdict == "uncertain" for r in results)
        assert all(r.confidence == 0 for r in results)

    def test_a_check_missing_from_the_aggregate_still_appears_as_undecided(self):
        """Every check the sender is shown has to be one of ours.

        The framework hands results back in participant order rather than completion order — that
        was measured with a deliberately slow participant, so it is not what this guards. What it
        guards is a check that never made it into the aggregate at all: it must come back
        undecided and in place, because a check that quietly vanished reads downstream as one that
        passed, and `plausibility` is a blocking check.
        """
        from verifier.verify import _in_declared_order, _to_result

        judged = {"categorisation": _to_result("categorisation", self._payload(), "stub")}
        results = _in_declared_order(judged, "stub")

        assert [r.check for r in results] == ["plausibility", "categorisation"]
        assert results[0].verdict == "uncertain"
        assert results[0].confidence == 0
        assert results[1].verdict == "pass"


class TestARuleFailureStopsBeforeTheModel:
    """A `fail` from a rule is `reject`, so the two model calls after it cannot change anything.

    They used to run anyway. The Bergen concert is the case that shows what that cost: `coverage`
    refuses it (ADR 0015), and the questions still put to a model were "does this look genuine" and
    "is the category right" — both yes, both true, neither able to move the outcome, and the sender
    waited on the submit button for the slower of them before being told about Sunnhordland.

    What must survive the short cut is everything the sender is shown: six checks, a summary that
    names what to fix, and the same recommendation as before.
    """

    @staticmethod
    def _payload(verdict: str = "pass") -> str:
        return json.dumps({"verdict": verdict, "confidence": 95, "reasoning": "Ser ekte ut."})

    async def test_a_refused_event_costs_no_model_call(self):
        fake = FakeOpenAI(self._payload())
        response = await verify(
            factory_for(fake), _request(municipality="Bergen", venue_name="Grieghallen")
        )

        assert fake.calls == [], "coverage had already refused it; nothing was worth asking"
        assert response.recommendation == "reject"

    async def test_an_unreadable_date_costs_no_model_call(self):
        """The other rule that can fail outright, so the guard is not about coverage alone."""
        fake = FakeOpenAI(self._payload())
        response = await verify(factory_for(fake), _request(starts_at="ikkje ein dato"))

        assert fake.calls == []
        assert response.recommendation == "reject"

    async def test_a_clean_submission_is_still_asked_both_questions(self):
        """The half of the branch that must not be lost: nothing changes for an ordinary event."""
        fake = FakeOpenAI(self._payload())
        response = await verify(factory_for(fake), _request(source_url="https://example.no/x"))

        assert len(fake.calls) == 2
        assert response.recommendation == "publish"

    async def test_the_checks_that_were_not_asked_still_appear(self):
        """A check missing from the list reads downstream as one that passed."""
        fake = FakeOpenAI(self._payload())
        response = await verify(factory_for(fake), _request(municipality="Bergen"))

        by_name = {c.check: c for c in response.checks}
        assert set(by_name) == {
            "normalisation",
            "duplicate",
            "coverage",
            "corroboration",
            "plausibility",
            "categorisation",
        }
        for check in ("plausibility", "categorisation"):
            assert by_name[check].verdict == "uncertain"
            assert by_name[check].confidence == 0
            # A rule decided not to ask, and no model was called — so the badge the sender reads
            # must say "Regel", never a deployment name for a request that never happened.
            assert by_name[check].deterministic is True
            assert by_name[check].model is None
            assert "ikkje vurdert" in by_name[check].reasoning

    async def test_the_summary_says_what_to_fix_and_not_what_was_skipped(self):
        """`plausibility` is a blocking check, so an unasked one would otherwise talk.

        Its sentence is "this was not assessed", appended to the reason it was not assessed. That
        is a circle, and it lands in front of the one sentence that tells somebody about
        Sunnhordland.
        """
        fake = FakeOpenAI(self._payload())
        response = await verify(
            factory_for(fake), _request(municipality="Bergen", venue_name="Grieghallen")
        )

        assert "Bergen" in response.summary
        assert "Stord" in response.summary
        assert "ikkje vurdert" not in response.summary

    async def test_an_uncertain_rule_is_not_a_short_cut(self):
        """Only `fail` settles the outcome. `uncertain` is exactly what a model call is for.

        A submission with no kommune stated is the commonest one there is (ADR 0015), and it comes
        back `uncertain` from coverage. If that were treated as a refusal the short cut would
        silence the model on most of the traffic.
        """
        fake = FakeOpenAI(self._payload())
        response = await verify(factory_for(fake), _request(municipality=None, venue_name="Huset"))

        assert len(fake.calls) == 2
        assert response.recommendation == "review"

    async def test_without_a_model_both_judged_checks_are_reported(self):
        """Six rows, in every environment.

        This branch only ever emitted `plausibility` — enough to force `review`, which is why it
        went unnoticed — so an environment with no verifier showed five checks under a page that
        promises six.
        """
        response = await verify(None, _request())

        reported = {c.check for c in response.checks}
        assert "categorisation" in reported
        assert len(reported) == 6
