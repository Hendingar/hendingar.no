"""Choosing a thumbnail out of an image nobody read.

The socket is fake here as everywhere else — what is asserted is the contract around it: that a
box comes back as a box, that "I could not tell" comes back as nothing rather than as an error, and
that the sampling is pinned so one picture does not get two different cards on two uploads.
"""

import json

from fake_model import FakeOpenAI, factory_for

from verifier.crop import suggest_crop
from verifier.models import CropRequest


def _request() -> CropRequest:
    return CropRequest(image_base64="A" * 200, media_type="image/jpeg")


async def test_a_box_comes_back_as_a_box():
    payload = json.dumps(
        {"thumbnail": {"x": 0.0, "y": 0.1, "width": 1.0, "height": 0.5}, "note": "Motivet øvst."}
    )
    result = await suggest_crop(factory_for(FakeOpenAI(payload)), _request())
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
    result = await suggest_crop(factory_for(FakeOpenAI(payload)), _request())
    assert result.thumbnail is None


async def test_a_filtered_image_yields_no_box_rather_than_an_exception():
    fake = FakeOpenAI(None, finish_reason="content_filter")
    result = await suggest_crop(factory_for(fake), _request())
    assert result.thumbnail is None
    assert result.note


async def test_sampling_is_pinned_so_one_picture_gets_one_crop():
    """Two uploads of the same image must not produce two different cards."""
    from verifier.llm import SEED, TEMPERATURE

    fake = FakeOpenAI(json.dumps({"thumbnail": None, "note": "."}))
    await suggest_crop(factory_for(fake), _request())
    (call,) = fake.calls
    assert call["temperature"] == TEMPERATURE == 0.0
    assert call["seed"] == SEED
    assert call["response_format"]["json_schema"]["strict"] is True


async def test_the_schema_is_hardened_for_strict_mode():
    """Strict mode rejects a schema that does not close every object, nested ones included.

    This used to be a hand-written dict in `crop.py` for exactly that reason. It is now generated
    from `CropSuggestion`, so the assertion moves here: the generated schema must still close the
    nullable nested box, or every crop call starts failing with a 400 nothing in this repo raised.
    """
    fake = FakeOpenAI(json.dumps({"thumbnail": None, "note": "."}))
    await suggest_crop(factory_for(fake), _request())
    schema = fake.last["response_format"]["json_schema"]["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"thumbnail", "note"}
    box = schema["$defs"]["ThumbnailCrop"]
    assert box["additionalProperties"] is False
    assert set(box["required"]) == {"x", "y", "width", "height"}


async def test_the_image_is_the_only_thing_sent():
    """No date, no fields, no page text — this endpoint asks one question about one picture.

    Worth asserting because the obvious way to build it would have been to reuse the extraction
    request, which carries `today` and a prompt about reading events. That call costs several times
    as much and answers a question nobody asked here.
    """
    fake = FakeOpenAI(json.dumps({"thumbnail": None, "note": "."}))
    await suggest_crop(factory_for(fake), _request())
    (call,) = fake.calls
    system, *user = call["messages"]
    assert system["role"] == "system"
    sent = [part["type"] for message in user for part in _parts(message)]
    assert sent == ["image_url", "text"]
    assert "miniatyrbilete" in str(call["messages"][-1]["content"])


def _parts(message: dict) -> list[dict]:
    """A message's content as parts, whether it arrived as a list of them or as plain text."""
    content = message["content"]
    return content if isinstance(content, list) else [{"type": "text", "text": content}]
