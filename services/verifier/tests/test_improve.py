"""The writer and the fact-checker.

What is asserted here is almost entirely about *refusal*, because that is what this endpoint is
for. Producing a nicer sentence is the easy half and a model does it unprompted; holding the
sentence back when a second agent found a claim nobody submitted is the half that makes offering
one defensible at all.

The socket is fake, so the two agents say exactly what each test needs them to say — which is the
only way to test "the checker objected" without a model that agrees to object on demand.
"""

import json

from fake_model import FakeOpenAI, factory_for

from verifier.improve import (
    MAX_DESCRIPTION_CHARS,
    _numbers_are_grounded,
    improve,
    improve_stream,
)
from verifier.llm import SEED, TEMPERATURE
from verifier.models import ImproveRequest


def _request(**overrides) -> ImproveRequest:
    base = {
        "title": "Bygdekino i Sagvåg",
        "description": "film på laurdag, ta med ungane",
        "category": "show",
        "starts_at": "2026-09-05T18:00:00+02:00",
        "venue_name": "Sagvåg grendahus",
        "municipality": "Stord",
    }
    return ImproveRequest(**{**base, **overrides})


def _draft(description: str, missing: list[str] | None = None) -> str:
    return json.dumps({"description": description, "missing": missing or []})


def _review(approved: bool, problems: list[str] | None = None) -> str:
    return json.dumps({"approved": approved, "problems": problems or []})


class TestWhenItOffersSomething:
    async def test_an_approved_draft_comes_back_with_its_audit(self):
        fake = FakeOpenAI(
            _draft("Bygdekino i grendahuset i Sagvåg. Ta med ungane.", ["kva det kostar"]),
            _review(True),
        )
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description == "Bygdekino i grendahuset i Sagvåg. Ta med ungane."
        assert suggestion.missing == ["kva det kostar"]
        assert suggestion.rounds == 2
        assert suggestion.note

    async def test_a_struck_claim_is_reported_even_when_the_rewrite_is_accepted(self):
        """Two rounds, and the sender is told what came out of the first one.

        The point of showing `removed` is that the suggestion arrives with its own audit attached:
        somebody reading it can see the draft was checked, and what the check caught.
        """
        fake = FakeOpenAI(
            _draft("Gratis bygdekino i Sagvåg."),
            _review(False, ["«gratis» står ikkje i innsendinga"]),
            _draft("Bygdekino i grendahuset i Sagvåg."),
            _review(True),
        )
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description == "Bygdekino i grendahuset i Sagvåg."
        assert suggestion.removed == ["«gratis» står ikkje i innsendinga"]
        assert suggestion.rounds == 4

    async def test_the_conversation_stops_as_soon_as_the_checker_approves(self):
        """Four rounds are allowed; an approval at two must not spend the other two."""
        fake = FakeOpenAI(_draft("Bygdekino i Sagvåg."), _review(True))
        await improve(factory_for(fake), _request())
        assert len(fake.calls) == 2

    async def test_the_checker_reads_the_draft_and_the_submission(self):
        """It cannot audit a claim against a record it was never shown."""
        fake = FakeOpenAI(_draft("Bygdekino i grendahuset."), _review(True))
        await improve(factory_for(fake), _request())

        checking = fake.call_instructing("Du kontrollerer at ei skildring")
        conversation = "\n".join(str(m["content"]) for m in checking["messages"])
        assert "Bygdekino i Sagvåg" in conversation  # the submission
        assert "Bygdekino i grendahuset." in conversation  # the writer's draft


class TestWhenItRefuses:
    async def test_an_unapproved_draft_is_never_shown(self):
        """The whole design. Two rounds of objection and the text is dropped, not offered."""
        fake = FakeOpenAI(
            _draft("Gratis kino for heile familien.", ["kva det kostar"]),
            _review(False, ["«gratis» står ikkje i innsendinga"]),
            _draft("Gratis kino, framleis."),
            _review(False, ["«gratis» står framleis der"]),
        )
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description is None
        # …and the sender still gets the useful half.
        assert suggestion.removed == [
            "«gratis» står ikkje i innsendinga",
            "«gratis» står framleis der",
        ]
        assert suggestion.missing == ["kva det kostar"]
        assert "held det tilbake" in suggestion.note

    async def test_an_invented_number_is_refused_even_if_the_checker_approved(self):
        """The deterministic backstop, and the case it exists for.

        A checker that waves through "250 kroner" is exactly the failure a second model cannot be
        relied on to prevent — so whether a number is in the record is decided by a rule.
        """
        fake = FakeOpenAI(_draft("Bygdekino i Sagvåg. Inngang 250 kroner."), _review(True))
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description is None
        assert "tal" in suggestion.note

    async def test_a_runaway_draft_is_refused(self):
        fake = FakeOpenAI(_draft("Bygdekino. " * 200), _review(True))
        suggestion = await improve(factory_for(fake), _request())
        assert suggestion.description is None

    async def test_an_unchanged_text_is_not_offered_back_as_an_improvement(self):
        """Handing somebody their own sentence with a "suggestion" label wastes their attention."""
        fake = FakeOpenAI(_draft("film på laurdag, ta med ungane"), _review(True))
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description is None
        assert "alt så god" in suggestion.note

    async def test_nothing_parseable_is_still_an_answer(self):
        fake = FakeOpenAI("ikkje json")
        suggestion = await improve(factory_for(fake), _request())

        assert suggestion.description is None
        assert suggestion.note


class TestTheNumberRule:
    """Pure, so it is tested as a rule rather than through four model calls."""

    RECORD = "Startar: 2026-09-05T18:00:00+02:00\nTittel: Bygdekino"

    def test_a_reformatted_date_is_not_an_invention(self):
        # The record holds `05`; a writer may reasonably say "5. september". Same fact.
        assert _numbers_are_grounded("Kino 5. september, klokka 18.", self.RECORD)

    def test_a_price_nobody_submitted_is(self):
        assert not _numbers_are_grounded("Inngang 250 kroner.", self.RECORD)

    def test_an_age_limit_nobody_submitted_is(self):
        assert not _numbers_are_grounded("Aldersgrense 15 år.", self.RECORD)

    def test_text_without_numbers_always_passes(self):
        assert _numbers_are_grounded("Ein roleg kveld i grendahuset.", self.RECORD)

    def test_the_cap_is_a_number_a_reader_could_meet(self):
        # Four sentences about a village concert, not a tenth of what the form allows.
        assert 200 < MAX_DESCRIPTION_CHARS < 5000


async def _collect(fake: FakeOpenAI, request: ImproveRequest) -> list[tuple[str, object]]:
    return [event async for event in improve_stream(factory_for(fake), request)]


class TestTheRunIsReportedAsItHappens:
    """Refusal is the ordinary outcome, and up to four sequential model calls stand in front of it.

    As one response that is fifteen seconds of nothing ending in "we could not do this safely" —
    on a feature whose whole claim (ADR 0017) is that the reasoning is the product. The turns are
    that reasoning. They were always produced; they were simply thrown away.

    What these assert is that showing them changed nothing about what is decided.
    """

    async def test_the_turns_arrive_in_order_and_the_verdict_is_last(self):
        fake = FakeOpenAI(
            _draft("Utkast ein, med noko oppdikta.", ["kva det kostar"]),
            _review(False, ["«gratis» står ikkje i innsendinga"]),
            _draft("Bygdekino i grendahuset i Sagvåg."),
            _review(True),
        )
        events = await _collect(fake, _request())

        assert [kind for kind, _ in events] == [
            "draft",
            "review",
            "draft",
            "review",
            "suggestion",
        ]
        assert events[0][1].description == "Utkast ein, med noko oppdikta."
        assert events[1][1].problems == ["«gratis» står ikkje i innsendinga"]
        assert events[3][1].approved is True
        assert events[-1][1].description == "Bygdekino i grendahuset i Sagvåg."

    async def test_a_refused_draft_still_shows_the_argument_that_refused_it(self):
        """The case this exists for: no text at the end, and something to read on the way there."""
        fake = FakeOpenAI(
            _draft("Ein årviss og svært populær bygdekino, gratis for alle."),
            _review(False, ["«gratis» står ikkje i innsendinga", "«årviss» er ei vurdering"]),
        )
        events = await _collect(fake, _request())

        kinds = [kind for kind, _ in events]
        assert kinds.count("draft") >= 1
        assert kinds.count("review") >= 1
        suggestion = events[-1][1]
        assert suggestion.description is None
        assert "gratis" in " ".join(suggestion.removed)

    async def test_the_draft_a_reader_watches_is_never_one_they_can_accept(self):
        """A struck draft goes past on the wire and must not come back as the offer.

        This is the one way streaming could have made the feature less safe: showing somebody a
        sentence and then deciding it was not allowed. What is shown is a report of a turn; the
        only thing that can be taken is the final suggestion, and it is still the one that survived
        every rule.
        """
        fake = FakeOpenAI(
            _draft("Bygdekino, 250 kroner i døra."),
            _review(True),
        )
        events = await _collect(fake, _request())

        streamed = [payload.description for kind, payload in events if kind == "draft"]
        assert streamed == ["Bygdekino, 250 kroner i døra."]
        # Approved by the checker and refused by the number rule all the same.
        assert events[-1][1].description is None

    async def test_the_blocking_route_returns_exactly_what_the_stream_decided(self):
        """One code path, asserted rather than assumed.

        Two routes that reached a verdict separately could disagree about one submission, and
        nobody would find it until two people got different text for the same words.
        """
        payloads = (_draft("Bygdekino i grendahuset i Sagvåg."), _review(True))

        streamed = await _collect(FakeOpenAI(*payloads), _request())
        blocking = await improve(factory_for(FakeOpenAI(*payloads)), _request())

        assert streamed[-1][0] == "suggestion"
        assert streamed[-1][1].model_dump() == blocking.model_dump()


class TestTheWirePayload:
    """ADR 0016 pinned this payload on purpose, so a change to it is asserted, not discovered."""

    async def test_streaming_pins_temperature_and_seed_like_everything_else(self):
        fake = FakeOpenAI(_draft("Bygdekino i grendahuset."), _review(True))
        await _collect(fake, _request())

        assert len(fake.calls) == 2
        for call in fake.calls:
            assert call["temperature"] == TEMPERATURE == 0.0
            assert call["seed"] == SEED
            assert call["response_format"]["json_schema"]["strict"] is True

    async def test_the_run_asks_the_socket_to_stream(self):
        """The one thing that does change, recorded here rather than left to be noticed.

        Running an orchestration streamed puts every participant's client into streaming mode, so
        `stream: true` goes on the wire for this endpoint — and only this one. Sampling is
        untouched, which is what the test above is for; determinism is a property of temperature
        and seed, not of how the bytes arrive.
        """
        fake = FakeOpenAI(_draft("Bygdekino i grendahuset."), _review(True))
        await _collect(fake, _request())

        assert all(call.get("stream") is True for call in fake.calls)

    async def test_extraction_is_untouched_by_any_of_this(self):
        """`/extract` is not a group chat and must still send a plain completion."""
        from verifier.extract import extract_poster
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
        assert not call.get("stream")
