"""The appeal: one juror at a time, so the caller can stream them.

An automatic check said no. The person who sent the event in disagrees and has written down why.
This asks a panel — three jurors with genuinely different jobs — and the caller collects the votes.

**Why a panel rather than one better prompt.** The question is not "does this parse" but "is this
person telling the truth about a real event in their town", which is a judgement call. Asking once
gives one model's mood; asking three differently-framed jurors and taking the majority means a
single lenient or paranoid reading cannot decide it on its own. It also gives the person something
to read: three named opinions beat one verdict with no visible reasoning.

Each juror is a separate call so the app can show its verdict the moment it lands. Nobody should
watch a blank screen for the length of three model round-trips.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from .llm import SEED, TEMPERATURE, LlmClientFactory
from .models import AppealRequest, JurorVerdict

#: How many jurors must be convinced. Two of three.
QUORUM = 2


@dataclass(frozen=True)
class Juror:
    """One seat on the panel: who they are, and what they are asked to weigh."""

    id: str
    name: str
    brief: str


#: The panel.
#:
#: Deliberately not three flavours of "is this good". A sceptic that assumes bad faith, an advocate
#: that assumes good faith, and a local reader who only cares whether this is a real thing happening
#: in a real place — so a decision has to survive being looked at from three directions.
JURORS: tuple[Juror, ...] = (
    Juror(
        id="skeptic",
        name="Skeptikaren",
        brief=(
            "Du er skeptisk. Du leitar etter teikn på reklame, spam, eller ei hending som ikkje "
            "finst. Grunngjevinga frå innsendaren kan vere oppdikta — vurder om ho heng saman med "
            "sjølve hendinga. Du seier ja berre om du ikkje finn noko som skurrar."
        ),
    ),
    Juror(
        id="advocate",
        name="Forsvararen",
        brief=(
            "Du går ut frå at folk flest er ærlege. Ein plakat på ei oppslagstavle har sjeldan "
            "nettadresse, og ei lita bygdehending har sjeldan noka kjelde på nett. Du spør om det "
            "finst ein rimeleg grunn til at hendinga ser tynn ut, utan at ho er falsk."
        ),
    ),
    Juror(
        id="local",
        name="Lokalkjenninga",
        brief=(
            "Du bryr deg berre om éin ting: er dette noko som faktisk skjer, på ein stad folk kan "
            "kome til, på eit tidspunkt som gir meining? Du kjenner Sunnhordland. Namn på stader, "
            "lag og lokale som verkar ekte tel positivt; vage eller generiske hendingar tel negativt."
        ),
    ),
)

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "publish": {"type": "boolean"},
        "confidence": {"type": "integer"},
        "reasoning": {"type": "string"},
    },
    "required": ["publish", "confidence", "reasoning"],
}


def juror_by_id(juror_id: str) -> Juror | None:
    return next((j for j in JURORS if j.id == juror_id), None)


def _prompt(request: AppealRequest) -> str:
    lines = [
        f"Tittel: {request.title}",
        f"Kategori: {request.category}",
        f"Startar: {request.starts_at}",
        f"Stad: {request.venue_name or '(ikkje oppgitt)'}",
        f"Kommune: {request.municipality or '(ikkje oppgitt)'}",
        f"Arrangør: {request.organizer_name or '(ikkje oppgitt)'}",
        f"Kjelde: {request.source_url or '(ingen)'}",
        f"Skildring: {request.description or '(inga)'}",
        "",
        "Den automatiske kontrollen sa nei, med denne grunngjevinga:",
        request.rejection_reason or "(ikkje oppgitt)",
        "",
        "Innsendaren skriv:",
        request.appeal.strip(),
    ]
    return "\n".join(lines)


async def judge_appeal(
    factory: LlmClientFactory, juror: Juror, request: AppealRequest
) -> JurorVerdict:
    """One juror's vote. Never raises: a juror that cannot answer votes no, with a reason."""
    system = (
        f"{juror.brief}\n\n"
        "Du vurderer om ei innsend hending skal publiserast på ein lokal hendingskalender for "
        "Sunnhordland. Svar på nynorsk, i éi til to setningar. Grunngjevinga blir vist til "
        "innsendaren, så skriv til dei, ikkje om dei."
    )
    try:
        client = factory.client()
        completion = await client.chat.completions.create(
            model=factory.model,
            max_completion_tokens=400,
            # Same reasoning as every other call here: a verdict that flips between runs on
            # identical input is not a verdict, and this one is shown to the person it is about.
            temperature=TEMPERATURE,
            seed=SEED,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _prompt(request)},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "juror", "schema": _SCHEMA, "strict": True},
            },
        )
        choice = completion.choices[0]
        if choice.finish_reason == "content_filter" or not choice.message.content:
            return JurorVerdict(
                juror=juror.id,
                name=juror.name,
                publish=False,
                confidence=0,
                reasoning="Denne juroren klarte ikkje vurdere saka.",
                model=factory.model,
            )
        data = json.loads(choice.message.content)
        return JurorVerdict(
            juror=juror.id,
            name=juror.name,
            publish=bool(data["publish"]),
            confidence=max(0, min(100, int(data["confidence"]))),
            reasoning=data["reasoning"],
            model=factory.model,
        )
    except Exception as exc:  # noqa: BLE001 - a juror that fails votes no, it does not break the panel
        return JurorVerdict(
            juror=juror.id,
            name=juror.name,
            publish=False,
            confidence=0,
            reasoning=f"Denne juroren var ikkje tilgjengeleg ({type(exc).__name__}).",
            model=None,
        )
