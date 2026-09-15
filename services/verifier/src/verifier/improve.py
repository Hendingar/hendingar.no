"""A writer and a fact-checker, arguing about somebody's description until it is safe to offer.

This is the one place in the repo that *generates* prose about an event rather than reading it, and
everything here is built around making that safe rather than making it good.

**Why two agents rather than one better prompt.** A single "tidy this up" call produces fluent text
and no way to tell which parts of it are true. The failure is not that a model writes badly — it is
that a thin submission rewritten confidently reads as a well-documented event, so the text gets
*more* persuasive exactly where it has the least behind it. Free admission, a family audience, a
support act: all plausible, none stated, all the kind of thing a reader would act on.

So the draft is written by one agent and audited by another whose only job is to find claims the
submission does not contain. They go round until the checker approves, and — this is the part that
matters — **an unapproved draft is thrown away**. No suggestion is a perfectly good outcome and the
common one to plan for. The sender keeps what they wrote, which is what we had anyway.

The group chat is Agent Framework's (ADR 0016). This is what it is for: iterative refinement, where
each turn sees what the last one said. The rest of the service deliberately does not work this way
— the judging checks are concurrent and the appeal jurors never see each other, because
independence is the property those need. Here the whole value is in the second look.

Three things are still rules rather than judgement, because a rule can decide them:

* the text is dropped unless the checker said `approved`;
* every number in it must already appear in the submission (`_numbers_are_grounded`);
* only the description is ever rewritten. Not the title, which is what the event *is* and what the
  duplicate check matches on, and not the date, place or category, which are facts with fields.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from agent_framework.orchestrations import GroupChatBuilder
from pydantic import BaseModel

from .llm import AgentFactory
from .models import ImproveRequest, ImproveSuggestion

log = logging.getLogger(__name__)

#: Writer, checker, writer, checker. Two drafts is enough to fix what one round finds; a third
#: round has never changed a verdict that the second did not, and every round is a model call
#: somebody is waiting on.
MAX_ROUNDS = 4

MAX_TOKENS = 700

#: Long enough for four sentences about a village concert, short enough that a runaway draft is
#: refused rather than shown. The form allows 5000; nothing we write needs a tenth of that.
MAX_DESCRIPTION_CHARS = 600

WRITER = "skribenten"
CHECKER = "faktasjekkaren"

WRITER_BRIEF = """Du skriv korte skildringar til ein lokal hendingskalender for Sunnhordland.

Du får ei innsending som ein person har fylt ut sjølv. Skriv ei skildring på nynorsk, to til fire
setningar, som fortel ein lesar kva dette er.

Den absolutte regelen: **du kan berre bruke det som står i innsendinga.** Du skriv om, du ryddar,
du bind saman — du legg aldri til noko. Ikkje pris, ikkje aldersgrense, ikkje «gratis», ikkje «for
heile familien», ikkje eit oppvarmingsband, ikkje kor mange som plar kome. Står det ikkje i
innsendinga, finst det ikkje for deg. Det er betre å skrive tre tørre setningar enn ei god setning
du fann på.

Skriv til ein som vurderer å gå: kva skjer, kvar, og kva slag kveld er dette. Ikkje gjenta dato og
klokkeslett — dei står på kortet frå før. Ingen utropsteikn, ingen reklamespråk.

`missing` er noko anna: der listar du opp kva ein lesar ville vilje vite som innsendinga IKKJE
seier — til dømes at det ikkje står kva det kostar, kven som arrangerer, eller når det sluttar.
Det er spørsmål til innsendaren, ikkje noko du skal fylle ut sjølv. Maks fire, på nynorsk, korte.

Har faktasjekkaren innvendingar, skriv utkastet om og fjern nøyaktig det som blei påpeika. Ikkje
forsvar deg — du har berre eitt svar, og det er eit nytt utkast."""

CHECKER_BRIEF = """Du kontrollerer at ei skildring ikkje påstår noko innsendinga ikkje seier.

Du får innsendinga først, og deretter eit utkast frå skribenten. Gå gjennom utkastet påstand for
påstand og spør om kvar einaste ein står i innsendinga.

Du godkjenner IKKJE:
- fakta som ikkje står der: pris, aldersgrense, varigheit, artistar, kor mange som kjem
- vurderingar som les som fakta: «populær», «årviss», «velkjend», «tradisjonsrik»
- stader, namn eller tidspunkt som ikkje er oppgitte

Du har ingen innvendingar mot omskriving, rekkjefølgje, tone eller grammatikk. Det er ikkje jobben
din, og eit utkast du sender tilbake for språkets skuld kostar berre ei runde.

`problems`: éi line per påstand du ikkje fann dekning for, med orda frå utkastet sitert, på
nynorsk. Innsendaren får lese dei, så skriv til dei — ikkje om dei.

Er alt dekt, set `approved` til true og la `problems` stå tom."""


class _Draft(BaseModel):
    """The writer's turn."""

    description: str
    missing: list[str]


class _Review(BaseModel):
    """The fact-checker's turn."""

    approved: bool
    problems: list[str]


def _record(request: ImproveRequest) -> str:
    """The submission, as the only thing either agent is allowed to draw on."""
    return "\n".join(
        [
            "Dette er innsendinga. Alt du kan bruke står her, og ingenting anna:",
            "",
            f"Tittel: {request.title}",
            f"Kategori: {request.category}",
            f"Startar: {request.starts_at}",
            f"Sluttar: {request.ends_at or '(ikkje oppgitt)'}",
            f"Stad: {request.venue_name or '(ikkje oppgitt)'}",
            f"Kommune: {request.municipality or '(ikkje oppgitt)'}",
            f"Arrangør: {request.organizer_name or '(ikkje oppgitt)'}",
            f"Kjelde: {request.source_url or '(ingen)'}",
            "",
            "Skildringa innsendaren skreiv sjølv:",
            request.description or "(ho er tom)",
        ]
    )


_NUMBER = re.compile(r"\d+")


def _numbers(text: str) -> set[int]:
    """Every run of digits in `text`, as numbers.

    As numbers rather than as strings so that reformatting a date does not read as inventing one:
    the record holds `2026-09-05` and a draft may reasonably write "5. september". `05` and `5` are
    the same fact and must compare equal.
    """
    return {int(match) for match in _NUMBER.findall(text)}


def _numbers_are_grounded(description: str, record: str) -> bool:
    """No number may appear in the draft that is not already in the submission.

    A rule rather than a second opinion, on the same grounds as `check_coverage`: the highest-cost
    inventions are numeric — a price, a phone number, an age limit, a door time — and whether a
    number is present in a record is a fact, not a judgement. The fact-checker is asked to catch
    these too, and mostly does; this is what makes "mostly" acceptable.

    It is deliberately loose about small numbers: an ISO timestamp carries 0, 2, 9 and so on, so a
    draft saying "to scener" passes. That is the trade. What it catches without exception is the
    distinctive number nobody submitted — `250 kroner`, `18 år`, `1963`.
    """
    return _numbers(description) <= _numbers(record)


def _merged(lists: Any) -> list[str]:
    """Every line from every round, in order, without repeats."""
    seen: list[str] = []
    for lines in lists:
        for line in lines:
            if line not in seen:
                seen.append(line)
    return seen


class _Panel:
    """The termination condition, which is also how the conversation is read back.

    The group chat's own output is the orchestrator's closing line, and the per-participant
    messages only surface as events on a *streamed* run. Nothing here streams — the caller asks one
    question and waits for one answer — so this doubles as the collector: the predicate is the one
    place the framework hands over the whole conversation without being asked for a stream.
    """

    def __init__(self) -> None:
        self.drafts: list[_Draft] = []
        self.reviews: list[_Review] = []

    def __call__(self, conversation: Any) -> bool:
        self.drafts = [d for d in (_parse(m, WRITER, _Draft) for m in conversation) if d]
        self.reviews = [r for r in (_parse(m, CHECKER, _Review) for m in conversation) if r]
        return bool(self.reviews) and self.reviews[-1].approved

    @property
    def rounds(self) -> int:
        return len(self.drafts) + len(self.reviews)

    @property
    def problems(self) -> list[str]:
        """Everything the checker struck, across every round, in order and without repeats."""
        return _merged(review.problems for review in self.reviews)

    @property
    def missing(self) -> list[str]:
        """Every gap named in any draft, not only the last one.

        A gap is a property of the submission rather than of a draft: what the sender did not say
        about the cost does not become known between round one and round two. A writer that names
        it once and forgets to repeat it while rewriting is not withdrawing it, so the union is the
        honest reading — and it keeps the useful half of the answer when the draft itself is
        dropped, which is the common case here.
        """
        return _merged(draft.missing for draft in self.drafts)


def _parse(message: Any, author: str, model: type[BaseModel]) -> Any:
    """One message as the object its author was asked for, or nothing.

    A turn that does not parse is skipped rather than raised on. The strict schema makes it close
    to unreachable, and the cost of being wrong is a suggestion nobody gets — which is the outcome
    this endpoint is allowed to have anyway.
    """
    if getattr(message, "author_name", None) != author:
        return None
    try:
        return model.model_validate_json(message.text)
    except ValueError:
        log.warning("%s said something unparseable", author)
        return None


def _nothing(note: str, panel: _Panel | None = None) -> ImproveSuggestion:
    """No text offered — with the half of the answer that is still worth having."""
    return ImproveSuggestion(
        description=None,
        removed=panel.problems if panel else [],
        missing=panel.missing if panel else [],
        note=note,
        rounds=panel.rounds if panel else 0,
    )


async def improve(factory: AgentFactory, request: ImproveRequest) -> ImproveSuggestion:
    """Run the two agents over one submission and return what survived."""
    writer = factory.agent(
        name=WRITER, instructions=WRITER_BRIEF, response_format=_Draft, max_tokens=MAX_TOKENS
    )
    checker = factory.agent(
        name=CHECKER, instructions=CHECKER_BRIEF, response_format=_Review, max_tokens=MAX_TOKENS
    )

    panel = _Panel()

    def speaker(state: Any) -> str:
        """Strict alternation, writer first. There is nothing for a manager to decide here."""
        names = list(state.participants.keys())
        return names[state.current_round % len(names)]

    workflow = GroupChatBuilder(
        participants=[writer, checker],
        selection_func=speaker,
        termination_condition=panel,
        max_rounds=MAX_ROUNDS,
    ).build()

    record = _record(request)
    await factory.run_workflow(workflow, record)

    if not panel.drafts:
        return _nothing("Vi fekk ikkje skrive eit framlegg denne gongen.", panel)

    if not (panel.reviews and panel.reviews[-1].approved):
        # The whole point. An unchecked draft is not a safer draft for having been written twice.
        return _nothing(
            "Vi skreiv eit framlegg, men faktasjekken fann påstandar som ikkje står i innsendinga "
            "di, så vi held det tilbake. Teksten din står som han er.",
            panel,
        )

    description = panel.drafts[-1].description.strip()

    if len(description) > MAX_DESCRIPTION_CHARS:
        return _nothing(
            "Framlegget blei for langt til å bruke. Teksten din står som han er.", panel
        )

    if not _numbers_are_grounded(description, record):
        log.warning("draft carried a number the submission does not")
        return _nothing(
            "Framlegget inneheldt eit tal som ikkje står i innsendinga di, så vi held det tilbake. "
            "Teksten din står som han er.",
            panel,
        )

    if description == (request.description or "").strip():
        return _nothing("Teksten din er alt så god som vi klarte å gjere han.", panel)

    return ImproveSuggestion(
        description=description,
        removed=panel.problems,
        missing=panel.missing,
        note=(
            "Framlegget byggjer berre på det du har skrive, og er kontrollert mot innsendinga di. "
            "Du bestemmer om du vil bruke det."
        ),
        rounds=panel.rounds,
    )
