"""Choose the part of an image worth keeping as a card thumbnail.

The poster path never comes here: reading a poster already returns a crop box beside the fields, at
no extra cost, and asking twice would be a second call for something we have. This is for the image
that was never read — one somebody attached to a form they typed in themselves, or one whose read
failed — where the alternative is not a better crop but no crop at all.

Asked once, after the event has been approved, so a picture belonging to a declined submission is
never sent anywhere. Best effort by definition: an empty answer means the caller falls back to a
centred landscape band of the whole image, which is still the picture the person chose to send.
"""

import logging

from agent_framework import Content, Message

from .llm import AgentFactory
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

# The answer is four numbers and a sentence. A small budget on purpose: this runs while somebody is
# reading their receipt rather than waiting on a spinner.
MAX_TOKENS = 300


async def suggest_crop(factory: AgentFactory, request: CropRequest) -> CropSuggestion:
    """One image in, one box or nothing out.

    The schema used to be written out by hand here because `CropSuggestion` has a nullable nested
    object and strict mode is fussy about those. Naming the model as the agent's `response_format`
    produces the same `anyOf` with the same hardening, from the converter the OpenAI SDK ships.
    """
    agent = factory.agent(
        name="utsnittsvelgaren",
        instructions=SYSTEM,
        response_format=CropSuggestion,
        max_tokens=MAX_TOKENS,
    )
    response = await factory.run(
        agent,
        Message(
            role="user",
            contents=[
                Content.from_uri(
                    uri=f"data:{request.media_type};base64,{request.image_base64}",
                    media_type=request.media_type,
                ),
                Content.from_text("Vel utsnittet som skal bli miniatyrbilete."),
            ],
        ),
    )

    if response.finish_reason == "content_filter" or response.value is None:
        # Not an error. The caller keeps the whole image, which is what it would have done with a
        # box it could not use anyway.
        return CropSuggestion(thumbnail=None, note="Biletet kunne ikkje vurderast automatisk.")

    return response.value
