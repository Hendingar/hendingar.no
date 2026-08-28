"""Read a photographed poster into a structured draft event.

This is the one place a model looks at an image. Its output is never published directly: it
pre-fills a form a human then reviews and confirms. That review step is what makes the whole
approach safe — the model is a typing shortcut, not an authority.
"""

import json
import logging

from .llm import LlmClientFactory
from .models import ExtractedEvent, ExtractRequest

log = logging.getLogger(__name__)

SYSTEM = """Du les plakatar for lokale arrangement i Noreg og hentar ut strukturerte data.

Reglar:
- Skriv berre av det som faktisk står på plakaten. Gjett aldri.
- Manglar eit felt, la det stå tomt og før det opp i `unreadable`.
- Relative datoar ("laurdag 14.") skal reknast ut frå datoen du får oppgitt som i dag.
- Klokkeslett i 24-timarsformat. Er berre starttid oppgitt, la sluttid stå tom.
- `confidence` skal spegle kor sikker du er på at dette faktisk er ein arrangementsplakat og at
  du las han rett. Er biletet uskarpt, delvis dekt eller ikkje ein plakat: sett låg confidence.
- Er dette ikkje ein arrangementsplakat i det heile, sett confidence til 0 og forklar i `note`.
- `note` skal vere éi setning på nynorsk, til personen som tok biletet.

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
                            f"I dag er {request.today}. Hent ut arrangementet frå denne plakaten."
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
            unreadable=["heile plakaten"],
            note="Biletet kunne ikkje lesast automatisk. Fyll inn skjemaet under.",
        )

    content = choice.message.content
    if not content:
        raise ValueError("model returned no content")
    return ExtractedEvent.model_validate(json.loads(content))
