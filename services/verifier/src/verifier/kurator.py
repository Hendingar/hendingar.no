"""Which of this weekend's events are worth going out for — a judgement, made once a night.

Every other model call in this service answers a question with a correct answer. Is this a real
event, is that a date, does this claim appear in the record. This one does not: "worth going out
for" is an opinion, and the honest thing is to build it as one rather than to dress it up as a
measurement.

That shapes three decisions.

**It is one reader's opinion and says so.** Every pick carries a sentence of reasoning a person can
read and disagree with. There is no score, no stars, no ordering by anything but the order the
kurator gave. A selection that cannot be argued with is a ranking wearing a cardigan.

**Popularity is not an input.** The candidates arrive with no heart count, no view count, nothing
about attention at all (`CuratorCandidate`). This repo has written down four separate times that it
does not want a popularity signal leaking into a listing — `EventGrid.svelte`, `EventTile.svelte`,
`schema.ts` on hearts, and the `/poppis` lede — and the way to keep that true rather than
aspirational is for the numbers never to be in the payload. `/poppis` answers "what are people
looking at" honestly and separately; this answers a different question and must not quietly become
the first one.

**A second reader checks the reasons, not the taste.** Taste is not auditable and it is not the
failure worth guarding against. What is: a reason that asserts something the record does not
contain — a sold-out room, a returning favourite, a line-up nobody submitted — which is ADR 0017's
problem in a new place. So `Motlesaren` audits each reason against its own event's fields and
objects to inventions, and has no opinion about whether the choice was good.

Two model calls a night, total: the kurator speaks, the second reader answers, and that is the
whole conversation. An objected pick is dropped rather than rewritten — there is no round left to
rewrite it in, and three good picks are not improved by a fourth that had to be argued for.

**The second reader sees only what was picked, each reason under its own record.** It used to be a
group chat, so Motlesaren read the kurator's answer beneath the whole weekend's listing. On
2026-10-13 the kurator wrote a reason about a Thanksgiving cooking class against the id of an
improv night, and Motlesaren passed it: every word of the reason *was* in "oppføringa" — just in a
different one, sixty entries further down. The improv night went on the front page explaining
itself as a dinner. A reader who can see every record can always find the claim somewhere, so it
is now handed nothing but the picked records, each followed by the reason given for it.

And the kurator copies each pick's title beside its id, which a rule then compares with the record
behind that id. A reason is written about the event the model has in mind, and the title says which
one that was; an id is a number it can transpose. When the two disagree the pick is dropped before
anyone's opinion is asked — see `_admissible`.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from .coverage import covered_sentence
from .llm import AgentFactory, parse_answer
from .models import CuratorCandidate, CuratorPick, CuratorRequest, CuratorSelection

log = logging.getLogger(__name__)

MAX_TOKENS = 900

#: Three is a selection somebody reads. Six is a listing, and we already have one of those.
MAX_PICKS = 3

#: Below this there is nothing to choose between, and a "selection" of two out of two is a lie.
MIN_CANDIDATES = 4

#: A weekend in three municipalities does not produce more than this, and a prompt that grows
#: without bound is a bill that grows without bound.
MAX_CANDIDATES = 60

CURATOR = "kuratoren"
READER = "motlesaren"

CURATOR_BRIEF = f"""Du er kurator for hendingar.no, ein open kalender for {covered_sentence()}.

Du får alt som skjer i helga som kjem. Vel inntil {MAX_PICKS} som du meiner er verdt å gå ut for,
og grunngjev kvart val med éi setning på nynorsk.

Dette er ei smaksdom, og du skal tore å ha ei meining. Men den skal vere forankra:

- Vel det som faktisk skjer på ein stad, ein gong, med nokon til stades. Ei utstilling som står
  open heile hausten er ikkje ei helgehending.
- Vel det som er tydeleg kva er: eit konkret program, ein namngjeven artist, eit lag, ein stad.
  «Open kafé» fortel ingen noko.
- Vel breitt. Tre konsertar er ikkje eit utval, det er ein sjanger. Ser du noko som gir helga ei
  anna form — eit loppemarknad, ein dugnad, ein fotballkamp, ei gudsteneste med noko spesielt —
  så tel det.
- Vel gjerne det vesle. Ei bygdehending med tjue menneske kan vere meir verdt å gå til enn det
  største namnet i programmet. Du veit ingenting om kor populært noko er, og det er med vilje.

For kvart val skriv du `event_id` og `title` ordrett slik dei står i lista, så grunngjevinga.

Grunngjevinga skal seie kvifor NETTOPP denne er verdt tida til nokon, og berre bruke det som står i
oppføringa. Ikkje finn på publikumstal, prisar, tradisjonar, «årets», «populære» eller «utselde».
Skriv til ein lesar, ikkje om hendinga: «verdt turen fordi ...».

Finn du ingenting du kan stå for, vel ingenting. Eit tomt utval er eit ærleg svar."""

READER_BRIEF = """Du les kurator sine val i motvind.

Du har INGA meining om smaken. Om kurator vel ein bingokveld framfor ein konsert, er det kurator
sitt val og ikkje di sak.

Du får berre oppføringane kurator valde, kvar med grunngjevinga for nettopp den hendinga under seg.

Jobben din er éin ting: kvar einaste påstand i grunngjevinga må stå i oppføringa rett over ho. Det
held ikkje at det står i ei anna oppføring.
Du avviser eit val når grunngjevinga:
- handlar om noko anna enn hendinga ho står under
- påstår fakta som ikkje står der: pris, publikumstal, kven som spelar, kor lenge det varer
- hevdar noko om status: «populær», «årviss», «utseld», «kjend», «tradisjonsrik»
- viser til noko utanfor oppføringa: fjorårets utgåve, andre hendingar, kva folk plar meine

Du avviser IKKJE eit val fordi grunngjevinga er tam, fordi du ville valt annleis, eller fordi
språket kunne vore betre.

Svar med éin `verdicts`-post per val kurator gjorde, med `event_id`, `ok`, og `problem` — der
`problem` er tomt når `ok` er sant, og elles éi setning på nynorsk om kva som ikkje stod der."""


class _DraftPick(BaseModel):
    """One pick as the kurator states it — with the title, so the id can be checked against it."""

    event_id: int
    title: str = Field(description="Tittelen på hendinga, ordrett slik han står i lista")
    reason: str = Field(
        description="Éi setning på nynorsk om kvifor denne er verdt å gå ut for. Ei meining, "
        "sagt som ei meining, som ein lesar kan vere usamd i."
    )


class _Draft(BaseModel):
    """Kuratoren's turn."""

    picks: list[_DraftPick]
    note: str = ""


class _Verdict(BaseModel):
    event_id: int
    ok: bool
    problem: str = ""


class _Review(BaseModel):
    """Motlesaren's turn: one verdict per pick, and no opinion about the choosing."""

    verdicts: list[_Verdict]


def _record(candidate: CuratorCandidate) -> list[str]:
    """One event, as everything either agent is told about it."""
    lines = [
        f"[{candidate.id}] {candidate.title}",
        f"    Kategori: {candidate.category}",
        f"    Tid: {candidate.starts_at}",
        (
            f"    Stad: {candidate.venue_name or '(ikkje oppgitt)'}, "
            f"{candidate.municipality or '(ukjend kommune)'}"
        ),
    ]
    if candidate.organizer_name:
        lines.append(f"    Arrangør: {candidate.organizer_name}")
    if candidate.source_name:
        lines.append(f"    Kjelde: {candidate.source_name}")
    lines.append(f"    Skildring: {candidate.description or '(inga)'}")
    return lines


def _listing(candidates: list[CuratorCandidate]) -> str:
    """Everything on offer — the kurator's whole brief."""
    lines = [
        "Dette er alt som skjer i helga. Kvar oppføring er alt du veit om den hendinga:",
        "",
    ]
    for candidate in candidates:
        lines.extend(_record(candidate))
        lines.append("")
    return "\n".join(lines)


def _dossier(picks: list[_DraftPick], candidates: list[CuratorCandidate]) -> str:
    """What Motlesaren is shown: each picked record, and under it the reason given for it.

    Nothing else from the weekend. A reader that can see sixty records can find any claim in one
    of them — which is how a cooking class's reason passed as an improv night's (module docstring).
    """
    by_id = {candidate.id: candidate for candidate in candidates}
    lines = ["Kurator valde desse. Kontroller kvar grunngjeving berre mot oppføringa over ho.", ""]
    for pick in picks:
        lines.extend(_record(by_id[pick.event_id]))
        lines.append(f"    GRUNNGJEVING: {pick.reason}")
        lines.append("")
    return "\n".join(lines)


def _parse[M: BaseModel](response: Any, model: type[M]) -> M | None:
    return parse_answer(
        getattr(response, "text", ""),
        model,
        finish_reason=getattr(response, "finish_reason", None),
        who=model.__name__,
    )


def _same_title(stated: str, actual: str) -> bool:
    """Whether the kurator named the event behind the id it gave.

    Letters and digits only, case-folded: a dropped "!" or a doubled space is a copying slip, not
    a different event — while "Kokkekurs: Canadian Thanksgiving" against "Improteater med
    Småsceneri" is exactly the transposition this exists to catch.
    """

    def norm(title: str) -> str:
        return re.sub(r"[\W_]+", "", title.casefold())

    return norm(stated) == norm(actual)


def _admissible(picks: list[_DraftPick], candidates: list[CuratorCandidate]) -> list[_DraftPick]:
    """The rules a rule can decide, applied before anybody's opinion is consulted.

    * an event that is not on the list cannot be picked — the one hallucination that would put a
      stranger's event on our front page;
    * the title given must be the title of the event behind the id. The reason was written about
      the event the kurator had in mind and the title names it, so a mismatch means the reason
      would go on the page under somebody else's event. It did, once (module docstring);
    * an event cannot be picked twice;
    * one pick per category, which is what makes "vel breitt" true rather than merely asked for.
      Three concerts is a genre, not a selection, and prompting against it is not the same as
      preventing it. The first pick in a category wins, because the kurator's own order is the
      only ranking here;
    * at most `MAX_PICKS`.

    Fewer picks is always the acceptable outcome. Nothing is back-filled to reach three: a
    replacement chosen by a rule is not a judgement, and this whole endpoint is a judgement.
    """
    by_id = {candidate.id: candidate for candidate in candidates}
    kept: list[_DraftPick] = []
    seen_categories: set[str] = set()

    for pick in picks:
        candidate = by_id.get(pick.event_id)
        if candidate is None:
            log.warning("kurator picked %s, which was not on the list", pick.event_id)
            continue
        if not _same_title(pick.title, candidate.title):
            log.warning(
                "kurator gave id %s with the title %r, which is %r",
                pick.event_id,
                pick.title,
                candidate.title,
            )
            continue
        if any(k.event_id == pick.event_id for k in kept):
            continue
        if candidate.category in seen_categories:
            continue
        seen_categories.add(candidate.category)
        kept.append(pick)
        if len(kept) == MAX_PICKS:
            break
    return kept


async def curate(factory: AgentFactory, request: CuratorRequest) -> CuratorSelection:
    """Ask for the weekend's picks, and return only those that survived both passes."""
    candidates = request.candidates[:MAX_CANDIDATES]

    if len(candidates) < MIN_CANDIDATES:
        # Not a selection. Two events out of two is the whole listing with a label on it, and it
        # would read as a judgement nobody made.
        return CuratorSelection(
            picks=[],
            considered=len(candidates),
            note="For få hendingar i helga til at eit utval seier noko.",
        )

    kurator = factory.agent(
        name=CURATOR, instructions=CURATOR_BRIEF, response_format=_Draft, max_tokens=MAX_TOKENS
    )
    reader = factory.agent(
        name=READER, instructions=READER_BRIEF, response_format=_Review, max_tokens=MAX_TOKENS
    )

    draft = _parse(await factory.run(kurator, _listing(candidates)), _Draft)
    if draft is None:
        return CuratorSelection(
            picks=[], considered=len(candidates), note="Kuratoren kom ikkje fram til eit utval."
        )

    admissible = _admissible(draft.picks, candidates)
    if not admissible:
        # Nothing for a second reader to read, so no second call.
        return CuratorSelection(
            picks=[],
            considered=len(candidates),
            model=factory.model,
            note=_note(draft.note, kept=0, chosen=len(draft.picks)),
        )

    review = _parse(await factory.run(reader, _dossier(admissible, candidates)), _Review)
    # The last word on each pick. A pick nobody ruled on is not approved.
    verdicts = {v.event_id: v for v in review.verdicts} if review else {}

    approved: list[_DraftPick] = []
    for pick in admissible:
        verdict = verdicts.get(pick.event_id)
        if verdict is None or not verdict.ok:
            # Fails closed, like every other judgement in this service. A pick the second reader
            # did not clear is one we cannot show the reasoning for, and the reasoning is the
            # whole offer.
            log.info(
                "dropped pick %s: %s",
                pick.event_id,
                verdict.problem if verdict else "no verdict",
            )
            continue
        approved.append(pick)

    # Renumbered, because rank is a position in what is shown and gaps in it would invite a reader
    # to wonder what was at number two.
    picks = [
        CuratorPick(event_id=pick.event_id, rank=index, reason=pick.reason.strip())
        for index, pick in enumerate(approved, start=1)
    ]

    return CuratorSelection(
        picks=picks,
        considered=len(candidates),
        model=factory.model,
        note=_note(draft.note, kept=len(picks), chosen=len(draft.picks)),
    )


def _note(written: str, *, kept: int, chosen: int) -> str:
    """The kurator's own summary, but only while it is still true.

    The note is written in the same breath as the picks, which is *before* Motlesaren has said
    anything — so a selection that loses a pick to the audit keeps a sentence describing the
    selection it used to be. The first real run did exactly that: three chosen, one struck for
    claiming "internasjonal anerkjenning" about a film whose listing says no such thing, and a note
    that still opened "Eg har valt tre hendingar".

    Nobody reads that note on the page — the section carries its own lede — but the nightly run
    prints it into the workflow summary, which is where a person goes to see what happened. A
    summary that disagrees with the picks beside it is worse than no summary.

    So the written note stands only when nothing was dropped. Otherwise it is replaced by the
    count, which is the one thing that is certainly true and happens to be the more interesting
    fact: the audit bit.
    """
    if kept == 0:
        return "Kuratoren fann ingenting å stå for denne helga."
    if kept < chosen:
        return (
            f"{kept} av {chosen} val stod etter faktasjekken. "
            "Dei andre bygde på noko som ikkje står i oppføringa."
        )
    return written.strip()
