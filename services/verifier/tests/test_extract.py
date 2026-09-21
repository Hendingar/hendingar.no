"""Reading a poster, and watching it be read.

The blocking path is scored by the evals against the live model, so what is worth asserting here is
the relationship between the two: that the streamed read is the *same* read, that what it shows
mid-flight is safe to show, and that the finished object is identical either way. A second path
that quietly answered differently would mean two people photographing one poster got two drafts,
which is the thing extraction's determinism settings exist to prevent.
"""

import json

from fake_model import FakeOpenAI, factory_for

from verifier.extract import STREAMED_FIELDS, extract_poster, extract_poster_stream
from verifier.llm import SEED, TEMPERATURE
from verifier.models import ExtractRequest

POSTER = {
    "title": "Pokémontreff i biblioteket",
    "description": "Eit nytt tilbod i biblioteket i samarbeid med Bømlo TCG.",
    "category": "anna",
    "date": "2026-09-21",
    "start_time": "16:00",
    "end_time": "17:00",
    "recurrence": None,
    "dates": [],
    "venue_name": "Bømlo folkebibliotek",
    "municipality": "Bømlo",
    "organizer_name": "Bømlo TCG",
    "ticket_url": None,
    "confidence": 92,
    "unreadable": [],
    "note": "Lese frå skjermbiletet.",
    "thumbnail": None,
}
PAYLOAD = json.dumps(POSTER, ensure_ascii=False)


def _request() -> ExtractRequest:
    return ExtractRequest(image_base64="A" * 200, media_type="image/jpeg", today="2026-09-21")


async def _collect(fake: FakeOpenAI):
    return [event async for event in extract_poster_stream(factory_for(fake), _request())]


class TestTheStreamIsTheSameRead:
    async def test_it_ends_with_exactly_what_the_blocking_call_returns(self):
        """The claim that lets the two coexist.

        `/extract` is what the evals score and ADR 0016 pinned its payload, so it stays a plain
        completion. That is only defensible while the streamed read reaches the identical answer.
        """
        streamed = await _collect(FakeOpenAI(PAYLOAD))
        blocking = await extract_poster(factory_for(FakeOpenAI(PAYLOAD)), _request())

        assert streamed[-1][0] == "event"
        assert streamed[-1][1].model_dump() == blocking.model_dump()

    async def test_sampling_is_pinned_on_the_streamed_read_too(self):
        """Determinism is a property of temperature and seed, not of how the bytes arrive."""
        fake = FakeOpenAI(PAYLOAD)
        await _collect(fake)

        (call,) = fake.calls
        assert call["temperature"] == TEMPERATURE == 0.0
        assert call["seed"] == SEED
        assert call["response_format"]["json_schema"]["strict"] is True
        assert call["stream"] is True

    async def test_the_blocking_read_still_sends_a_plain_completion(self):
        """Deliberate, and the reason `extract_poster` is not the streamed path collapsed.

        Changing what `/extract` sends would move the eval baseline without anybody running the
        evals. If this assertion ever has to be deleted, the evals have to be re-run first.
        """
        fake = FakeOpenAI(PAYLOAD)
        await extract_poster(factory_for(fake), _request())

        (call,) = fake.calls
        assert not call.get("stream")


class TestWhatIsShownWhileItReads:
    async def test_the_fields_arrive_in_the_order_a_reader_wants_them(self):
        fields = [
            payload.name for kind, payload in await _collect(FakeOpenAI(PAYLOAD)) if kind == "field"
        ]

        assert fields[0] == "title"
        assert "date" in fields and "venue_name" in fields
        # Schema order, which is what makes the title land first rather than by luck.
        assert fields == [name for name in STREAMED_FIELDS if name in fields]

    async def test_every_streamed_value_matches_the_finished_object(self):
        """The property `partial.completed_fields` exists for: nothing shown is later corrected."""
        events = await _collect(FakeOpenAI(PAYLOAD))
        final = events[-1][1]

        for kind, payload in events:
            if kind == "field":
                assert str(getattr(final, payload.name)) == payload.value

    async def test_nothing_about_the_reading_is_streamed_as_if_it_were_the_event(self):
        """`confidence`, `note` and `unreadable` are about the read, not about the evening.

        They still arrive on the finished object. What they must not do is sit in a list of fields
        beside the title, where they read as facts about somebody's Saturday.
        """
        fields = {
            payload.name for kind, payload in await _collect(FakeOpenAI(PAYLOAD)) if kind == "field"
        }

        assert not fields & {"confidence", "note", "unreadable", "thumbnail", "recurrence", "dates"}

    async def test_an_absent_field_is_not_announced(self):
        """A poster with no ticket link should not produce a row saying so."""
        fields = {
            payload.name for kind, payload in await _collect(FakeOpenAI(PAYLOAD)) if kind == "field"
        }

        assert "ticket_url" not in fields


class TestWhenThereIsNothingToRead:
    async def test_an_empty_answer_is_an_unreadable_image_rather_than_a_crash(self):
        """The content filter, and a model that says nothing, land in the same place.

        Both leave the person in front of a form they can fill in themselves — this path's whole
        promise, and the reason a failure here is never a submission's problem.
        """
        events = await _collect(FakeOpenAI(""))

        assert [kind for kind, _ in events] == ["event"]
        assert events[0][1].confidence == 0
        assert events[0][1].unreadable == ["heile biletet"]

    async def test_a_truncated_answer_raises_rather_than_half_filling_a_form(self):
        """A cut-off read is not a draft. Better a failure the caller degrades from.

        The fields already shown were each complete when shown — that is `completed_fields`' whole
        job — but the object they belong to is not, and validating it is what says so.
        """
        import pytest

        with pytest.raises(ValueError):
            await _collect(FakeOpenAI(PAYLOAD[: len(PAYLOAD) // 2]))
