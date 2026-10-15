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


def _draft(*picks: tuple[int, str] | tuple[int, str, str], note: str = "Ei brei helg.") -> str:
    """The kurator's answer. A pick is (id, reason), titled as `_candidate` titles that id, or
    (id, reason, title) to have the kurator name a different event than the id it gives."""
    return json.dumps(
        {
            "picks": [
                {
                    "event_id": pick[0],
                    "title": pick[2] if len(pick) == 3 else f"Hending {pick[0]}",
                    "reason": pick[1],
                }
                for pick in picks
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

    async def test_the_note_stops_claiming_three_when_two_survived(self):
        """From the first real run against production.

        The kurator picked three and wrote "Eg har valt tre hendingar"; Motlesaren struck one for
        claiming international acclaim about a film whose listing says nothing of the sort. The
        picks were right and the sentence describing them was a day out of date the moment it was
        written, because it is written before the audit speaks.
        """
        fake = FakeOpenAI(
            _draft(
                (1, "Ekte."),
                (2, "Ekte."),
                (3, "Internasjonalt anerkjend."),
                note="Eg har valt tre hendingar.",
            ),
            _review(
                (1, True, ""), (2, True, ""), (3, False, "«anerkjend» står ikkje i oppføringa")
            ),
        )
        selection = await curate(factory_for(fake), _request())

        assert len(selection.picks) == 2
        assert "tre hendingar" not in selection.note
        assert "2 av 3" in selection.note

    async def test_the_note_is_left_alone_when_every_pick_stood(self):
        fake = FakeOpenAI(
            _draft((1, "Ekte."), (2, "Ekte."), note="To ulike kveldar."),
            _review((1, True, ""), (2, True, "")),
        )
        selection = await curate(factory_for(fake), _request())

        assert len(selection.picks) == 2
        assert selection.note == "To ulike kveldar."

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


class TestTheReasonBelongsToItsEvent:
    """From production, 2026-10-13.

    The kurator wrote "lære å lage kanadisk Thanksgiving-mat med Skyler Milner" — the cooking
    class's own description — against the id of "Improteater med Småsceneri". Motlesaren, reading
    it under the whole weekend's listing, found every word of it in *a* record and passed it. The
    improv night went on the front page explaining itself as a dinner.
    """

    def _weekend(self) -> list[CuratorCandidate]:
        return [
            _candidate(959, "teater", title="Improteater med Småsceneri, 16. oktober!"),
            _candidate(
                992,
                "mat-og-drikke",
                title="Kokkekurs: Canadian Thanksgiving Vol. 2 med Skyler Milner",
                description="Lær å lage kanadisk Thanksgiving-mat med Skyler Milner.",
            ),
            _candidate(3, "marknad"),
            _candidate(4, "sport"),
        ]

    async def test_a_reason_given_under_another_events_id_is_dropped(self):
        fake = FakeOpenAI(
            _draft(
                (959, "Lær å lage kanadisk Thanksgiving-mat.", "Kokkekurs: Canadian Thanksgiving"),
                (3, "Verdt turen for loppene."),
            ),
            # The second reader would have passed it, as it did. The rule does not ask.
            _review((959, True, ""), (3, True, "")),
        )
        selection = await curate(factory_for(fake), CuratorRequest(candidates=self._weekend()))

        assert [p.event_id for p in selection.picks] == [3]
        assert all("Thanksgiving" not in p.reason for p in selection.picks)

    async def test_a_title_copied_with_slips_still_names_its_event(self):
        """Punctuation and case are copying, not a different event."""
        fake = FakeOpenAI(
            _draft((959, "Verdt ein latter.", "improteater med småsceneri 16 oktober")),
            _review((959, True, "")),
        )
        selection = await curate(factory_for(fake), CuratorRequest(candidates=self._weekend()))
        assert [p.event_id for p in selection.picks] == [959]

    async def test_the_second_reader_sees_each_reason_under_its_own_record_and_nothing_else(self):
        fake = FakeOpenAI(
            _draft((959, "Verdt ein latter.", self._weekend()[0].title)),
            _review((959, True, "")),
        )
        await curate(factory_for(fake), CuratorRequest(candidates=self._weekend()))

        assert len(fake.calls) == 2
        dossier = "\n".join(
            str(message["content"])
            for message in fake.calls[1]["messages"]
            if message["role"] != "system"
        )
        assert "[959] Improteater" in dossier
        assert dossier.index("[959]") < dossier.index("GRUNNGJEVING: Verdt ein latter.")
        # The records it was not asked about are not there to find a claim in.
        assert "Thanksgiving" not in dossier
        assert "[992]" not in dossier
        assert "[3]" not in dossier


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
