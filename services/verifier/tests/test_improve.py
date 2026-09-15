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
)
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
