"""Choosing a thumbnail out of an image nobody read.

The model is stubbed here as everywhere else — what is asserted is the contract around it: that a
box comes back as a box, that "I could not tell" comes back as nothing rather than as an error, and
that the sampling is pinned so one picture does not get two different cards on two uploads.
"""

import json
from typing import ClassVar

from verifier.crop import suggest_crop
from verifier.models import CropRequest


class _Client:
    """Answers one completion with a fixed payload, and records what it was asked."""

    def __init__(self, payload: str | None, finish_reason: str = "stop"):
        self.calls: list[dict] = []
        outer = self

        class _Completions:
            async def create(self, **kwargs):
                outer.calls.append(kwargs)

                class _Msg:
                    content = payload

                class _Choice:
                    message = _Msg()

                _Choice.finish_reason = finish_reason

                class _Completion:
                    choices: ClassVar[list] = [_Choice()]

                return _Completion()

        class _Chat:
            completions = _Completions()

        self.chat = _Chat()


class _Factory:
    model = "stub-deployment"

    def __init__(self, payload: str | None, finish_reason: str = "stop"):
        self.recorded = _Client(payload, finish_reason)

    def client(self):
        return self.recorded


def _request() -> CropRequest:
    return CropRequest(image_base64="A" * 200, media_type="image/jpeg")


async def test_a_box_comes_back_as_a_box():
    payload = json.dumps(
        {"thumbnail": {"x": 0.0, "y": 0.1, "width": 1.0, "height": 0.5}, "note": "Motivet øvst."}
    )
    result = await suggest_crop(_Factory(payload), _request())  # type: ignore[arg-type]
    assert result.thumbnail is not None
    assert result.thumbnail.y == 0.1
    assert result.thumbnail.height == 0.5


async def test_unsure_is_an_answer_not_an_error():
    """The prompt tells the model to leave it empty when in doubt, and this is that path.

    It must not raise: the caller keeps the whole image, which is what the person sent us. A crop
    that fails loudly here would turn "no box" into "no thumbnail", which is the worse outcome of
    the two by a distance.
    """
    payload = json.dumps({"thumbnail": None, "note": "Uklart kva som er motivet."})
    result = await suggest_crop(_Factory(payload), _request())  # type: ignore[arg-type]
    assert result.thumbnail is None


async def test_a_filtered_image_yields_no_box_rather_than_an_exception():
    factory = _Factory(None, finish_reason="content_filter")
    result = await suggest_crop(factory, _request())  # type: ignore[arg-type]
    assert result.thumbnail is None
    assert result.note


async def test_sampling_is_pinned_so_one_picture_gets_one_crop():
    """Two uploads of the same image must not produce two different cards."""
    from verifier.llm import SEED, TEMPERATURE

    payload = json.dumps({"thumbnail": None, "note": "."})
    factory = _Factory(payload)
    await suggest_crop(factory, _request())  # type: ignore[arg-type]
    (call,) = factory.recorded.calls
    assert call["temperature"] == TEMPERATURE == 0.0
    assert call["seed"] == SEED
    assert call["response_format"]["json_schema"]["strict"] is True


async def test_the_image_is_the_only_thing_sent():
    """No date, no fields, no page text — this endpoint asks one question about one picture.

    Worth asserting because the obvious way to build it would have been to reuse the extraction
    request, which carries `today` and a prompt about reading events. That call costs several times
    as much and answers a question nobody asked here.
    """
    factory = _Factory(json.dumps({"thumbnail": None, "note": "."}))
    await suggest_crop(factory, _request())  # type: ignore[arg-type]
    (call,) = factory.recorded.calls
    (system, user) = call["messages"]
    assert system["role"] == "system"
    kinds = [part["type"] for part in user["content"]]
    assert kinds == ["image_url", "text"]
    assert "miniatyrbilete" in user["content"][1]["text"]
