"""The pile on /haugen: how well each upcoming event answers what somebody typed.

One yes/no question per event — "is this what they are looking for?" — answered by Jev with a
probability, and nothing else. No ordering is decided here and no threshold is applied: the app
owns both, because they are a matter of how the page feels and should be tunable without a
deploy. This file owns the *question*.

Why the wording reads the way it does, measured against jev-1.13 on 2026-10-03:

- **The search sits in `state`, the event in the question.** State is shared by every question in
  a request, so the one thing every question is about goes there once. Each event then appears
  only in its own question, which keeps unrelated events out of each answer — the model page warns
  that irrelevant detail in state costs accuracy.
- **"Read `search` literally".** The first wording asked whether someone searching would "want to
  go to" an event. Jev answered generously: a big-band concert in the kulturhus scored 0.55 for
  "ting å gjere ute", against 0.80 for a mountain walk. Telling it that a named place, audience or
  activity must be *clearly* true of the event took the concert to 0.15 and the walk to 0.87, and
  lifted "noko for ungdom" on the youth club from 0.74 to 0.84.
- **In Nynorsk, all of it** — the question, the criteria, and the field names. Measured on 2026-10-03
  as a 2×2 over 150 real events and nine labelled searches: English vs Nynorsk, and plain vs
  with definitions of the corpus ("born er under 13…"). Nynorsk lifted the share of right-above-
  wrong pairs from 93% to 99% and the labelled answers that float from 25/33 to 31/33. It found
  all five films for "kino" where English found two, and "for born" went from two of seven to
  seven of seven. The definitions changed almost nothing in Nynorsk and cost 47% more tokens, so
  they are not here. The search and the events are Nynorsk; a question in the same language asks
  Jev to compare like with like.
- **The time is words, never a timestamp.** Jev reads dates as text and is documented as poor at
  comparing them, so `when` is "laurdag kveld" — which is what somebody types anyway.

Nothing about attention is sent: no hearts, no views, no rank. The pile answers what was asked,
not what was popular, and a popularity number in the payload would be a second question hidden in
the first. Same rule as the kurator, and the same test enforces it.
"""

import asyncio
import json
import time

from .jev import JevClient
from .llm import AgentFactory
from .models import (
    HaugenCompareRequest,
    HaugenComparison,
    HaugenEvent,
    HaugenRanking,
    HaugenRequest,
    HaugenScore,
    HaugenSide,
    HaugenSideScore,
    HaugenVerdicts,
)

# Each event costs ~250 input tokens as a question. Jev allows 64k per request; sixty events is
# about 15k, which leaves room for long descriptions and keeps each request well inside the
# per-request budget. Chunks run in parallel, so splitting costs no latency.
CHUNK_SIZE = 60

# A description is context, not content. The first sentences say what an event is; the rest is
# directions and ticket prices, which only dilute the answer.
DESCRIPTION_CHARS = 240

QUESTION = (
    "Ein besøkjande på ein lokal arrangementskalender skreiv `søk`. Er `hending` den typen "
    "arrangement dei leitar etter? Les `søk` bokstavleg: nemner det ein stad (ute), eit publikum "
    "(ungdom, born) eller ein aktivitet (trening, musikk), må sjølve hendinga tydeleg vere det."
)

CRITERIA = {
    "true": "Tittelen, kategorien eller skildringa av `hending` viser tydeleg at det er det `søk` "
    "spør etter",
    "false": "`hending` er ikkje tydeleg det `søk` spør etter, eller ingenting ved hendinga seier det",
}


def describe(event: HaugenEvent) -> dict[str, str]:
    """The event as Jev sees it. Empty fields are left out rather than sent as blanks."""
    fields = {
        "tittel": event.title,
        "kategori": event.category_label,
        "når": event.when,
        "stad": event.venue_name,
        "kommune": event.municipality,
        "arrangør": event.organizer_name,
        "skildring": _clip(event.description),
    }
    return {k: v for k, v in fields.items() if v}


def question_for(event: HaugenEvent) -> dict:
    return {
        "instructions": {"hending": describe(event), "spørsmål": QUESTION},
        "criteria": CRITERIA,
    }


async def rank(client: JevClient, request: HaugenRequest) -> HaugenRanking:
    """Score every event against the search. Raises `JevUnavailable` if any chunk fails.

    All or nothing on purpose: a pile where half the events were scored and half were not would
    float the scored half for no reason the visitor could see.
    """
    if not request.events:
        return HaugenRanking(scores=[], model=client.model)

    chunks = [request.events[i : i + CHUNK_SIZE] for i in range(0, len(request.events), CHUNK_SIZE)]
    state = {"søk": request.query}
    started = time.perf_counter()
    answers = await asyncio.gather(
        *(
            client.nouls(state, {f"e{event.id}": question_for(event) for event in chunk})
            for chunk in chunks
        )
    )
    scores = [
        HaugenScore(event_id=event.id, score=answer.nouls[f"e{event.id}"])
        for chunk, answer in zip(chunks, answers, strict=True)
        for event in chunk
    ]
    best = max(scores, key=lambda s: s.score)
    best_event = next(e for e in request.events if e.id == best.event_id)
    return HaugenRanking(
        scores=scores,
        model=answers[0].model,
        example=example_request(client.model, state, best_event),
        elapsed_ms=round((time.perf_counter() - started) * 1000),
        requests=len(chunks),
        input_tokens=sum(a.input_tokens for a in answers),
    )


def _clip(text: str | None) -> str | None:
    if not text:
        return None
    text = " ".join(text.split())
    if len(text) <= DESCRIPTION_CHARS:
        return text
    cut = text[:DESCRIPTION_CHARS].rsplit(" ", 1)[0]
    return f"{cut}…"


def example_request(model: str, state: dict, event: HaugenEvent) -> dict:
    """One question exactly as it went over the wire, for the page to show.

    The body Jev receives is `{model, state, questions}` with one entry per event; this is that
    body cut down to a single entry, so what the page prints is the real structure and the real
    words rather than a paraphrase of them.
    """
    return {
        "model": model,
        "state": state,
        "questions": {f"e{event.id}": {"type": "noul", **question_for(event)}},
    }


# The same question, asked of a chat model. Everything Jev is told is here, in the same words —
# the difference being compared is the kind of model, not the brief.
LLM_INSTRUCTIONS = (
    f"{QUESTION}\n\nJa: {CRITERIA['true']}.\nNei: {CRITERIA['false']}.\n\n"
    "Du får `søk` og ei liste med `hendingar`. Svar for kvar hending med id-en, ja eller nei, og "
    "kor sannsynleg det er at svaret er ja, som eit tal frå 0 til 1."
)


async def compare(
    factory: AgentFactory, jev: JevClient, request: HaugenCompareRequest
) -> HaugenComparison:
    """The same events, the same question: Jev and a chat model, timed side by side.

    Run at the same time, each with its own clock, so neither waits on the other. Either side may
    fail without taking the other with it — a comparison where one column says why it is empty
    is still a comparison.
    """
    jev_side, llm_side = await asyncio.gather(_ask_jev(jev, request), _ask_llm(factory, request))
    return HaugenComparison(jev=jev_side, llm=llm_side)


async def _ask_jev(jev: JevClient, request: HaugenCompareRequest) -> HaugenSide:
    started = time.perf_counter()
    try:
        answer = await jev.nouls(
            {"søk": request.query}, {f"e{e.id}": question_for(e) for e in request.events}
        )
    except Exception as exc:  # noqa: BLE001 — the other column must survive this one failing
        return HaugenSide(model=jev.model, elapsed_ms=_since(started), error=type(exc).__name__)
    return HaugenSide(
        model=answer.model,
        elapsed_ms=_since(started),
        input_tokens=answer.input_tokens,
        scores=[
            HaugenSideScore(event_id=e.id, score=answer.nouls[f"e{e.id}"]) for e in request.events
        ],
    )


async def _ask_llm(factory: AgentFactory, request: HaugenCompareRequest) -> HaugenSide:
    agent = factory.agent(
        name="haugen-samanlikning",
        instructions=LLM_INSTRUCTIONS,
        response_format=HaugenVerdicts,
        # About twenty tokens a verdict. Sized to the request, so sixty events are not cut off
        # half-way through the list — a truncated reply fails to parse and the column is empty.
        max_tokens=max(400, 30 * len(request.events)),
    )
    message = json.dumps(
        {
            "søk": request.query,
            "hendingar": [{"id": e.id, **describe(e)} for e in request.events],
        },
        ensure_ascii=False,
    )
    started = time.perf_counter()
    try:
        response = await factory.run(agent, message)
    except Exception as exc:  # noqa: BLE001 — the other column must survive this one failing
        return HaugenSide(model=factory.model, elapsed_ms=_since(started), error=type(exc).__name__)
    elapsed = _since(started)
    usage = getattr(response, "usage_details", None) or {}
    verdicts = {v.id: v for v in (response.value.svar if response.value else [])}
    return HaugenSide(
        model=factory.model,
        elapsed_ms=elapsed,
        input_tokens=_int(usage.get("input_token_count")),
        output_tokens=_int(usage.get("output_token_count")),
        scores=[
            HaugenSideScore(
                event_id=e.id,
                score=min(1.0, max(0.0, verdicts[e.id].sannsyn)),
                ja=verdicts[e.id].ja,
            )
            for e in request.events
            if e.id in verdicts
        ],
    )


def _since(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def _int(value: object) -> int | None:
    return value if isinstance(value, int) else None
