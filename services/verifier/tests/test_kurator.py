"""The weekend's picks.

Taste cannot be asserted, so none of this asserts it. What it asserts is everything around the
taste: that the payload carries no popularity signal, that a pick must be a real event, that three
of one category is not a selection, that a reason nobody could verify is dropped, and that too
small a weekend produces no picks rather than a "selection" of everything.
"""

import json

from fake_model import FakeOpenAI, factory_for

from verifier.kurator import (
    MAX_CANDIDATES,
    MAX_PICKS,
    MIN_CANDIDATES,
    curate,
)
from verifier.models import CuratorCandidate, CuratorRequest


def _candidate(id: int, category: str = "musikk", **overrides) -> CuratorCandidate:
    base = {
        "id": id,
        "title": f"Hending {id}",
        "description": "Noko skjer i grendahuset.",
        "category": category,
        "starts_at": "2026-09-05T19:00:00+02:00",
        "venue_name": "Grendahuset",
        "municipality": "Stord",
    }
    return CuratorCandidate(**{**base, **overrides})


def _request(candidates: list[CuratorCandidate] | None = None) -> CuratorRequest:
    return CuratorRequest(
        candidates=candidates
        or [
            _candidate(1, "musikk"),
            _candidate(2, "sport"),
            _candidate(3, "marknad"),
            _candidate(4, "teater"),
            _candidate(5, "litteratur"),
        ]
    )


def _draft(*picks: tuple[int, str], note: str = "Ei brei helg.") -> str:
    return json.dumps(
        {
            "picks": [
                {"event_id": event_id, "rank": rank, "reason": reason}
                for rank, (event_id, reason) in enumerate(picks, start=1)
            ],
            "note": note,
        }
    )


def _review(*verdicts: tuple[int, bool, str]) -> str:
    return json.dumps(
        {
            "verdicts": [
                {"event_id": event_id, "ok": ok, "problem": problem}
                for event_id, ok, problem in verdicts
            ]
        }
    )


class TestTheSelection:
    async def test_approved_picks_come_back_in_order_with_their_reasoning(self):
        fake = FakeOpenAI(
            _draft((3, "Verdt turen for loppene."), (1, "Verdt turen for konserten.")),
            _review((3, True, ""), (1, True, "")),
        )
        selection = await curate(factory_for(fake), _request())

        assert [p.event_id for p in selection.picks] == [3, 1]
        assert [p.rank for p in selection.picks] == [1, 2]
        assert selection.picks[0].reason == "Verdt turen for loppene."
        assert selection.considered == 5
        assert selection.note == "Ei brei helg."

    async def test_it_is_two_model_calls_and_no_more(self):
        """The cost ceiling the whole design is built around: kurator speaks, reader answers."""
        fake = FakeOpenAI(_draft((1, "Grunn.")), _review((1, True, "")))
        await curate(factory_for(fake), _request())
        assert len(fake.calls) == 2

    async def test_no_popularity_signal_ever_reaches_the_model(self):
        """The rule this feature exists to keep honest.

        Hearts and views are not in `CuratorCandidate`, so they cannot be sent — but a later change
        could add them for "context" without anyone noticing what it cost. This fails if they do.

        Asserted on the *data* the agents are given, not on their briefs: the briefs have to be
        allowed to say the word in order to forbid the thing, and an assertion over the whole
        payload fails on its own instructions. That is not a hypothetical — it is how this test
        first failed.
        """
        fake = FakeOpenAI(_draft((1, "Grunn.")), _review((1, True, "")))
        await curate(factory_for(fake), _request())

        listing = "\n".join(
            str(message["content"])
            for call in fake.calls
            for message in call["messages"]
            if message["role"] != "system"
        ).lower()
        for leak in ("hjarte", "heart", "vist", "views", "opna", "popul"):
            assert leak not in listing, f"{leak!r} reached the kurator"


class TestTheRules:
    """Decided in code, before anybody's opinion is consulted."""

    async def test_an_event_that_was_not_on_the_list_cannot_be_picked(self):
        """The one hallucination that would put a stranger's event on our own page."""
        fake = FakeOpenAI(
            _draft((999, "Finst ikkje."), (2, "Verdt turen.")),
            _review((999, True, ""), (2, True, "")),
        )
        selection = await curate(factory_for(fake), _request())
        assert [p.event_id for p in selection.picks] == [2]

    async def test_three_of_one_category_is_a_genre_not_a_selection(self):
        candidates = [_candidate(i, "musikk") for i in range(1, 5)] + [_candidate(9, "sport")]
        fake = FakeOpenAI(
            _draft((1, "Konsert."), (2, "Konsert."), (3, "Konsert."), (9, "Fotball.")),
            _review((1, True, ""), (2, True, ""), (3, True, ""), (9, True, "")),
        )
        selection = await curate(factory_for(fake), CuratorRequest(candidates=candidates))

        assert [p.event_id for p in selection.picks] == [1, 9]

    async def test_the_same_event_twice_is_once(self):
        fake = FakeOpenAI(
            _draft((1, "Grunn."), (1, "Same igjen.")),
            _review((1, True, "")),
        )
        selection = await curate(factory_for(fake), _request())
        assert [p.event_id for p in selection.picks] == [1]

    async def test_it_never_offers_more_than_the_cap(self):
        candidates = [
            _candidate(1, "musikk"),
            _candidate(2, "sport"),
            _candidate(3, "marknad"),
            _candidate(4, "teater"),
        ]
        fake = FakeOpenAI(
            _draft((1, "a"), (2, "b"), (3, "c"), (4, "d")),
            _review((1, True, ""), (2, True, ""), (3, True, ""), (4, True, "")),
        )
        selection = await curate(factory_for(fake), CuratorRequest(candidates=candidates))
        assert len(selection.picks) == MAX_PICKS

    async def test_nothing_is_back_filled_to_reach_three(self):
        """A replacement chosen by a rule is not a judgement, and this endpoint is a judgement."""
        fake = FakeOpenAI(_draft((1, "Berre denne.")), _review((1, True, "")))
        selection = await curate(factory_for(fake), _request())
        assert len(selection.picks) == 1


class TestTheSecondReader:
    async def test_an_ungrounded_reason_loses_its_pick_not_the_selection(self):
        fake = FakeOpenAI(
            _draft((1, "Årets mest populære konsert."), (2, "Verdt turen.")),
            _review((1, False, "«mest populære» står ikkje i oppføringa"), (2, True, "")),
        )
        selection = await curate(factory_for(fake), _request())

        assert [p.event_id for p in selection.picks] == [2]
        # Renumbered, so nobody wonders what was at number one.
        assert selection.picks[0].rank == 1

    async def test_a_pick_nobody_ruled_on_is_not_approved(self):
        """Fails closed, like every other judgement here: no verdict is not a pass."""
        fake = FakeOpenAI(_draft((1, "Grunn."), (2, "Grunn.")), _review((1, True, "")))
        selection = await curate(factory_for(fake), _request())
        assert [p.event_id for p in selection.picks] == [1]

    async def test_every_pick_being_struck_is_an_empty_selection_not_an_error(self):
        fake = FakeOpenAI(
            _draft((1, "Utseld konsert.")),
            _review((1, False, "«utseld» står ingen stad")),
        )
        selection = await curate(factory_for(fake), _request())

        assert selection.picks == []
        assert selection.note


class TestWhenItDeclines:
    async def test_too_small_a_weekend_is_not_curated(self):
        """Two events out of two is the whole listing with a label on it."""
        candidates = [_candidate(i) for i in range(1, MIN_CANDIDATES)]
        fake = FakeOpenAI(_draft((1, "Grunn.")), _review((1, True, "")))
        selection = await curate(factory_for(fake), CuratorRequest(candidates=candidates))

        assert selection.picks == []
        assert selection.considered == len(candidates)
        assert "For få" in selection.note
        # And it did not spend a model call finding that out.
        assert fake.calls == []

    async def test_an_unreadable_answer_is_an_empty_selection(self):
        fake = FakeOpenAI("ikkje json i det heile")
        selection = await curate(factory_for(fake), _request())

        assert selection.picks == []
        assert selection.note

    async def test_the_candidate_list_is_capped(self):
        """A weekend cannot grow the prompt without bound, whatever the database holds."""
        candidates = [
            _candidate(i, "musikk" if i % 2 else "sport") for i in range(1, MAX_CANDIDATES + 20)
        ]
        fake = FakeOpenAI(_draft((1, "Grunn.")), _review((1, True, "")))
        selection = await curate(factory_for(fake), CuratorRequest(candidates=candidates))

        assert selection.considered == MAX_CANDIDATES
        listing = str(fake.calls[0]["messages"][-1]["content"])
        assert f"[{MAX_CANDIDATES}]" in listing
        assert f"[{MAX_CANDIDATES + 1}]" not in listing
