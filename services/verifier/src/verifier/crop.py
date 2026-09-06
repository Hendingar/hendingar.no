"""Choose the part of an image worth keeping as a card thumbnail.

The poster path never comes here: reading a poster already returns a crop box beside the fields, at
no extra cost, and asking twice would be a second call for something we have. This is for the image
that was never read — one somebody attached to a form they typed in themselves, or one whose read
failed — where the alternative is not a better crop but no crop at all.

Asked once, after the event has been approved, so a picture belonging to a declined submission is
never sent anywhere. Best effort by definition: an empty answer means the caller falls back to a
centred landscape band of the whole image, which is still the picture the person chose to send.
"""

import json
import logging

from .llm import SEED, TEMPERATURE, LlmClientFactory
from .models import CropRequest, CropSuggestion

log = logging.getLogger(__name__)

SYSTEM = """Du vel kva del av eit bilete som skal bli miniatyrbilete på eit hendingskort, og svarar
berre med strukturerte data.

Biletet kan vere ein plakat, eit skjermbilete, eit foto frå staden eller eit program. Du skal ikkje
hente ut informasjon om arrangementet — berre peike ut utsnittet.

Reglar:
- Vel den delen som fortel kva dette er: hovudmotivet og tittelen.
- Hald deg unna finskrifta nedst, logorekkja, QR-kodar og krom frå Facebook eller nettlesaren.
- Utsnittet skal vere breiare enn det er høgt, for kortet er det.
- Bruk brøkdelar av biletet (0-1), der x/y er øvre venstre hjørne.
- Er biletet allereie eit greitt landskapsbilete utan krom, kan heile biletet vere utsnittet.
- Er du i tvil om kva som er motivet, la `thumbnail` stå tomt. Eit dårleg utsnitt er verre enn
  ingen: utan utsnitt brukar vi heile biletet, og det er alltid forsvarleg.
- `note` er éi kort setning på nynorsk om kva du valde."""

_SCHEMA = {
    "type": "object",
    "properties": {
        "thumbnail": {
            "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "width": {"type": "number"},
                        "height": {"type": "number"},
                    },
                    "required": ["x", "y", "width", "height"],
                    "additionalProperties": False,
                },
                {"type": "null"},
            ]
        },
        "note": {"type": "string"},
    },
    "required": ["thumbnail", "note"],
    "additionalProperties": False,
}


async def suggest_crop(factory: LlmClientFactory, request: CropRequest) -> CropSuggestion:
    """One image in, one box or nothing out.

    A small budget on purpose: the answer is four numbers and a sentence, and this runs while
    somebody is reading their receipt rather than waiting on a spinner.
    """
    client = factory.client()
    completion = await client.chat.completions.create(
        model=factory.model,
        max_completion_tokens=300,
        # Same box for the same picture, every time. A thumbnail that moves between runs would make
        # two uploads of one image produce two different cards.
        temperature=TEMPERATURE,
        seed=SEED,
        messages=[
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{request.media_type};base64,{request.image_base64}"
                        },
                    },
                    {"type": "text", "text": "Vel utsnittet som skal bli miniatyrbilete."},
                ],
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "crop_suggestion", "schema": _SCHEMA, "strict": True},
        },
    )

    choice = completion.choices[0]
    if choice.finish_reason == "content_filter" or not choice.message.content:
        # Not an error. The caller keeps the whole image, which is what it would have done with a
        # box it could not use anyway.
        return CropSuggestion(thumbnail=None, note="Biletet kunne ikkje vurderast automatisk.")

    return CropSuggestion.model_validate(json.loads(choice.message.content))
