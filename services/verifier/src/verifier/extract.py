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
from .models import ExtractedEvent, ExtractPageRequest, ExtractRequest

log = logging.getLogger(__name__)

SYSTEM = """Du hentar ut informasjon om lokale arrangement i Noreg frå bilete, og svarar berre med
strukturerte data.

Biletet kan vere ein plakat på ei oppslagstavle, eit skjermbilete av ei Facebook-hending, ei
annonse i ei avis, eit program eller ei nettside. Handsam alle likt: finn arrangementet i biletet.

Reglar:
- Skriv berre av det som faktisk står i biletet. Gjett aldri, og finn aldri opp felt.
- Manglar eit felt, la det stå tomt og før det opp i `unreadable`.
- Relative datoar ("laurdag 14.", "i morgon") skal reknast ut frå datoen du får oppgitt som i dag.
- Står det ei gjentaking i staden for ein dato ("torsdager", "kvar tysdag", "første måndag i
  månaden"), fyll ut `recurrence` og la `date` stå tom. Ikkje finn opp ein einskild dato for eit
  arrangement som gjentar seg — det er feil svar, sjølv om datoen er plausibel.
- Listar biletet fleire datoar ein for ein ("27.aug. 24.sept. 29.okt. og 26.nov", "9., 16. og 23.
  mars"), fyll ut `dates` med alle saman og la `date` stå tom. Dette er IKKJE ei gjentaking: fire
  torsdagar spreidde over hausten følgjer inga regel, og å velje den første er feil — som oftast er
  ho alt passert.
- Ein dato utan årstal skal reknast ut frå datoen du får oppgitt som i dag. Er datoen då passert,
  høyrer han til neste år.
- Er det både ein dato og ei gjentaking, fyll ut begge.
- Vekedagar i `recurrence.weekdays`: 1 = måndag, 7 = sundag.
- Er staden namngitt slik at han inneheld ein norsk kommune ("Vertshuset Bømlo"), fyll ut
  `municipality` med kommunen i tillegg til `venue_name`. Det er avskrift, ikkje gjetting. Står det
  ingen stad i biletet, la begge stå tomme — finn aldri opp ein stad.
- Klokkeslett i 24-timarsformat. Er berre starttid oppgitt, la sluttid stå tom.
- Er det fleire arrangement i biletet, ta det som er tydelegast presentert som hovudsaka.
- Ignorer navigasjon, reklame, kommentarar, «liker»-tal og anna krom rundt sjølve arrangementet.
- `confidence` skal spegle kor sikker du er på at biletet faktisk viser eit arrangement og at du
  las det rett. Er biletet uskarpt, delvis dekt eller utan arrangement: sett låg confidence.
- Viser biletet ikkje eit arrangement i det heile, sett confidence til 0 og forklar i `note`.
- `note` skal vere éi setning på nynorsk, til personen som lasta opp biletet.
- `thumbnail` er utsnittet som bør bli miniatyrbilete på eit hendingskort — den delen av biletet
  som fortel kva dette er. Typisk hovudmotivet og tittelen; sjeldan finskrifta nedst eller
  Facebook-kroma rundt. Bruk brøkdelar av biletet (0-1), der x/y er øvre venstre hjørne. Utsnittet
  skal vere breiare enn det er høgt. Er du i tvil, la det stå tomt — eit dårleg utsnitt er verre
  enn ingen.

Kategoriar: musikk, teater, utstilling, sport, mote, kyrkjeliv, festival, litteratur, stand-up,
show, mat-og-drikke, dans, marknad, konferanse, kurs, anna."""


SYSTEM_PAGE = """Du hentar ut informasjon om lokale arrangement i Noreg frå teksten på ei nettside, og
svarar berre med strukturerte data.

Teksten er heile den lesbare sida, med markup fjerna — så han inneheld navigasjon, botntekst,
informasjonskapsel-varsel og anna krom i tillegg til sjølve arrangementet. Finn arrangementet.

Reglar:
- Skriv berre av det som faktisk står i teksten. Gjett aldri, og finn aldri opp felt.
- Manglar eit felt, la det stå tomt og før det opp i `unreadable`.
- Er sida ei liste over fleire arrangement, ta det som står først og tydelegast. Ikkje bland felt
  frå to ulike arrangement — det er verre enn å hente ut eitt av dei.
- Relative datoar ("laurdag 14.", "i morgon") skal reknast ut frå datoen du får oppgitt som i dag.
  Ein dato utan årstal høyrer til neste år dersom han alt er passert.
- Står det ei gjentaking i staden for ein dato ("torsdagar", "kvar tysdag"), fyll ut `recurrence`
  og la `date` stå tom. Listar sida fleire datoar ein for ein, fyll ut `dates` med alle.
- Klokkeslett i 24-timarsformat. Er berre starttid oppgitt, la sluttid stå tom.
- Ignorer meny, søkefelt, "les meir", deling, personvern og anna som ikkje er arrangementet.
- `confidence` skal spegle om sida faktisk handlar om eit arrangement og om du las det rett. Er
  sida ei forside, ei nyheitssak eller ei liste utan tydeleg hovudsak: sett låg confidence.
- Handlar sida ikkje om eit arrangement i det heile, sett confidence til 0 og forklar i `note`.
- `note` skal vere éi setning på nynorsk, til personen som limte inn lenkja.
- `thumbnail` skal alltid stå tomt her. Det finst ikkje noko bilete å skjere ut av ein tekst.

Kategoriar: musikk, teater, utstilling, sport, mote, kyrkjeliv, festival, litteratur, stand-up,
show, mat-og-drikke, dans, marknad, konferanse, kurs, anna."""

# A page is mostly not the event. Enough for a long listing, capped so one enormous page cannot
# become one enormous bill — the app truncates too, and this is the backstop.
MAX_PAGE_CHARS = 12_000


def _harden(node: dict) -> None:
    """Apply strict-mode rules to an object schema and everything nested inside it.

    Strict mode requires every property to be listed in `required` and `additionalProperties:
    false` — on nested objects too, not just the root. Pydantic emits neither, and it hoists nested
    models into `$defs`, which are reached through `$ref` and so need hardening in place.
    """
    if node.get("type") == "object" and "properties" in node:
        node["additionalProperties"] = False
        node["required"] = list(node["properties"].keys())
    for key in ("properties", "$defs"):
        for child in node.get(key, {}).values():
            if isinstance(child, dict):
                _harden(child)
    for child in node.get("anyOf", []):
        if isinstance(child, dict):
            _harden(child)
    items = node.get("items")
    if isinstance(items, dict):
        _harden(items)


def _schema() -> dict:
    """JSON Schema for the structured response, hardened for strict mode."""
    schema = ExtractedEvent.model_json_schema()
    _harden(schema)
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


async def extract_page(factory: LlmClientFactory, request: ExtractPageRequest) -> ExtractedEvent:
    """Read an event out of page text.

    Same schema, same determinism settings and the same review step as the poster path: what comes
    back pre-fills a form a person checks before anything is sent. The only differences are the
    prompt, which has to cope with navigation and footers rather than a photograph, and that no
    thumbnail crop is asked for — there is no image here to crop.
    """
    client = factory.client()
    completion = await client.chat.completions.create(
        model=factory.model,
        max_completion_tokens=2000,
        temperature=TEMPERATURE,
        seed=SEED,
        messages=[
            {"role": "system", "content": SYSTEM_PAGE},
            {
                "role": "user",
                "content": (
                    f"I dag er {request.today}. Sida ligg på {request.url}.\n\n"
                    f"{request.text[:MAX_PAGE_CHARS]}"
                ),
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "extracted_event", "schema": _schema(), "strict": True},
        },
    )

    choice = completion.choices[0]
    if choice.finish_reason == "content_filter":
        # Same treatment as an unreadable poster: a normal outcome, not a server error. The person
        # fills the form in themselves.
        return ExtractedEvent(
            confidence=0,
            unreadable=["heile sida"],
            note="Sida kunne ikkje lesast automatisk. Fyll inn skjemaet sjølv.",
        )

    content = choice.message.content
    if not content:
        raise ValueError("model returned no content")
    return ExtractedEvent.model_validate(json.loads(content))
