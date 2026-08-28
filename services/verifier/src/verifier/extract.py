"""Read a photographed poster, screenshot or advert into a structured draft event.

This is the one place a model looks at an image. Its output is never published directly: it
pre-fills a form a human then reviews and confirms. That review step is what makes the whole
approach safe — the model is a typing shortcut, not an authority.

Extraction is transcription, not generation, so it is pinned as close to deterministic as the API
allows: temperature 0, a fixed seed, and a strict JSON schema. Two people photographing the same
poster should get the same draft, and re-reading an image should not produce a different answer the
second time.
"""

import json
import logging

from .llm import SEED, TEMPERATURE, LlmClientFactory
from .models import ExtractedEvent, ExtractRequest

log = logging.getLogger(__name__)

SYSTEM = """Du hentar ut informasjon om lokale arrangement i Noreg frå bilete, og svarar berre med
strukturerte data.

Biletet kan vere ein plakat på ei oppslagstavle, eit skjermbilete av ei Facebook-hending, ei
annonse i ei avis, eit program eller ei nettside. Handsam alle likt: finn arrangementet i biletet.

Reglar:
- Skriv berre av det som faktisk står i biletet. Gjett aldri, og finn aldri opp felt.
- Manglar eit felt, la det stå tomt og før det opp i `unreadable`.
- Relative datoar ("laurdag 14.", "i morgon") skal reknast ut frå datoen du får oppgitt som i dag.
- Klokkeslett i 24-timarsformat. Er berre starttid oppgitt, la sluttid stå tom.
- Er det fleire arrangement i biletet, ta det som er tydelegast presentert som hovudsaka.
- Ignorer navigasjon, reklame, kommentarar, «liker»-tal og anna krom rundt sjølve arrangementet.
- `confidence` skal spegle kor sikker du er på at biletet faktisk viser eit arrangement og at du
  las det rett. Er biletet uskarpt, delvis dekt eller utan arrangement: sett låg confidence.
- Viser biletet ikkje eit arrangement i det heile, sett confidence til 0 og forklar i `note`.
- `note` skal vere éi setning på nynorsk, til personen som lasta opp biletet.

Kategoriar: musikk, teater, utstilling, sport, mote, kyrkjeliv, festival, litteratur, stand-up,
show, mat-og-drikke, dans, marknad, konferanse, kurs, anna."""


def _schema() -> dict:
    """JSON Schema for the structured response.

    Derived from the Pydantic model, then adjusted for the strict-mode rules the API enforces:
    every property required (nullable instead of optional) and `additionalProperties: false`.
    """
    schema = ExtractedEvent.model_json_schema()
    schema["additionalProperties"] = False
    schema["required"] = list(schema.get("properties", {}).keys())
    return schema


async def extract_poster(factory: LlmClientFactory, request: ExtractRequest) -> ExtractedEvent:
    client = factory.client()
    completion = await client.chat.completions.create(
        model=factory.model,
        max_completion_tokens=2000,
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
                    {
                        "type": "text",
                        "text": (
                            f"I dag er {request.today}. Hent ut arrangementet frå dette biletet."
                        ),
                    },
                ],
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "extracted_event", "schema": _schema(), "strict": True},
        },
    )

    choice = completion.choices[0]
    if choice.finish_reason == "content_filter":
        # The content filter is a normal outcome, not an exception. Report it as an unreadable
        # image rather than a server error, so the person just fills in the form themselves.
        return ExtractedEvent(
            confidence=0,
            unreadable=["heile biletet"],
            note="Biletet kunne ikkje lesast automatisk. Fyll inn skjemaet sjølv.",
        )

    content = choice.message.content
    if not content:
        raise ValueError("model returned no content")
    return ExtractedEvent.model_validate(json.loads(content))
