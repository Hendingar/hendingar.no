"""Read a photographed poster, screenshot or advert into a structured draft event.

This is the one place a model looks at an image. Its output is never published directly: it
pre-fills a form a human then reviews and confirms. That review step is what makes the whole
approach safe — the model is a typing shortcut, not an authority.

Extraction is transcription, not generation, so it is pinned as close to deterministic as the API
allows: temperature 0, a fixed seed, and a strict JSON schema. Two people photographing the same
poster should get the same draft, and re-reading an image should not produce a different answer the
second time. All three live in `llm.py` now and apply to every agent this service builds.

The strict schema used to be hand-hardened here — strict mode requires `additionalProperties:
false` and every property in `required`, on nested objects too, and Pydantic emits neither. Naming
`ExtractedEvent` as the agent's `response_format` gets the same schema from the OpenAI SDK's own
converter, nested `$defs` included, so that function is gone rather than duplicated.
"""

import logging
from collections.abc import AsyncIterator
from typing import Literal

from agent_framework import Content, Message

from .llm import AgentFactory
from .models import ExtractedEvent, ExtractedField, ExtractPageRequest, ExtractRequest
from .partial import completed_fields

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

# A read is the whole event: title, description, dates, venue, and a crop box. Generous because
# running out of tokens mid-object produces no event at all, not a shorter one.
MAX_TOKENS = 2000


def _unreadable(what: str, subject: str) -> ExtractedEvent:
    """The content filter is a normal outcome, not an exception.

    Report it as an unreadable image rather than a server error, so the person just fills in the
    form themselves instead of meeting a failure they can do nothing about.
    """
    return ExtractedEvent(
        confidence=0,
        unreadable=[what],
        note=f"{subject} kunne ikkje lesast automatisk. Fyll inn skjemaet sjølv.",
    )


def _poster_agent(factory: AgentFactory):
    return factory.agent(
        name="plakatlesaren",
        instructions=SYSTEM,
        response_format=ExtractedEvent,
        max_tokens=MAX_TOKENS,
    )


def _poster_message(request: ExtractRequest) -> Message:
    # The image is already base64 from the browser, so it travels as the `data:` URI it will be
    # sent as. Handing over raw bytes would decode and re-encode it for nothing.
    return Message(
        role="user",
        contents=[
            Content.from_uri(
                uri=f"data:{request.media_type};base64,{request.image_base64}",
                media_type=request.media_type,
            ),
            Content.from_text(
                f"I dag er {request.today}. Hent ut arrangementet frå dette biletet."
            ),
        ],
    )


async def extract_poster(factory: AgentFactory, request: ExtractRequest) -> ExtractedEvent:
    """One image, one answer.

    Deliberately NOT the streamed path collapsed, which is what `improve` does one file over. The
    extraction evals in `evals/` score this function against the live model, and ADR 0016 kept the
    wire payload byte-for-byte on the argument that nothing measured about extraction should have to
    be re-measured. Changing what this sends would quietly move that baseline. `extract_poster_stream`
    is the same agent, the same prompt and the same schema over a different transport, and a test
    asserts the reassembled bytes are identical — which is the claim that lets the two coexist.
    """
    response = await factory.run(_poster_agent(factory), _poster_message(request))

    if response.finish_reason == "content_filter":
        return _unreadable("heile biletet", "Biletet")
    if response.value is None:
        raise ValueError("model returned no content")
    return response.value


#: What the caller is handed while the model is still writing, and then at the end.
type PosterEvent = tuple[Literal["field"], ExtractedField] | tuple[Literal["event"], ExtractedEvent]

#: The fields worth putting in front of somebody mid-read, in the order the schema emits them.
#:
#: Not every key. `unreadable`, `confidence` and `note` are about the reading rather than about the
#: evening and read as noise beside a title; `recurrence`, `dates` and `thumbnail` are structures a
#: person does not read. All of them still arrive on the finished object, which is the only thing
#: that ever reaches the form.
STREAMED_FIELDS: tuple[str, ...] = (
    "title",
    "description",
    "category",
    "date",
    "start_time",
    "end_time",
    "venue_name",
    "municipality",
    "organizer_name",
    "ticket_url",
)


async def extract_poster_stream(
    factory: AgentFactory, request: ExtractRequest
) -> AsyncIterator[PosterEvent]:
    """The same read, reported field by field as the model writes them.

    **Why this is worth doing.** Reading a poster is the longest single wait in the product — five
    to fifteen seconds of one call — and the page could say nothing true about it, so it narrated
    stages on a timer: "Les tittel og dato…" at three seconds whether or not that had happened. A
    strict-schema answer is emitted in schema order, so the title is finished and correct while the
    organiser does not yet exist. There is a real answer to show and it was being thrown away.

    **A streamed field is for reading and never for filling in.** Only the `event` at the end
    reaches the form, and only a person pressing a button puts it there — the review step is what
    makes reading somebody's poster with a model defensible at all, and a half-written draft that
    populated inputs behind their back would take it away. `partial.completed_fields` is what makes
    the distinction safe rather than hopeful: it reports a value only once it has been closed, so
    nothing shown here can change afterwards.
    """
    agent = _poster_agent(factory)
    text = ""
    sent: set[str] = set()

    async for update in factory.run_stream(agent, _poster_message(request)):
        piece = getattr(update, "text", "") or ""
        if not piece:
            continue
        text += piece
        for name, value in completed_fields(text).items():
            if name in sent or name not in STREAMED_FIELDS or value is None or value == "":
                continue
            sent.add(name)
            yield "field", ExtractedField(name=name, value=str(value))

    if not text.strip():
        # An empty stream is the content filter, or a model that said nothing at all. Both leave the
        # person in front of a form they can fill in themselves, which is this path's whole promise.
        yield "event", _unreadable("heile biletet", "Biletet")
        return

    yield "event", ExtractedEvent.model_validate_json(text)


async def extract_page(factory: AgentFactory, request: ExtractPageRequest) -> ExtractedEvent:
    """Read an event out of page text.

    Same schema, same determinism settings and the same review step as the poster path: what comes
    back pre-fills a form a person checks before anything is sent. The only differences are the
    prompt, which has to cope with navigation and footers rather than a photograph, and that no
    thumbnail crop is asked for — there is no image here to crop.
    """
    agent = factory.agent(
        name="sidelesaren",
        instructions=SYSTEM_PAGE,
        response_format=ExtractedEvent,
        max_tokens=MAX_TOKENS,
    )
    response = await factory.run(
        agent,
        f"I dag er {request.today}. Sida ligg på {request.url}.\n\n{request.text[:MAX_PAGE_CHARS]}",
    )

    if response.finish_reason == "content_filter":
        return _unreadable("heile sida", "Sida")
    if response.value is None:
        raise ValueError("model returned no content")
    return response.value
