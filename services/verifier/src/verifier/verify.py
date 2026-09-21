"""The verification pipeline.

Deliberately mixed: the checks a rule can decide are decided by a rule, and only the genuinely
judgemental ones consult a model. Every check returns its reasoning, because the README promises
the agent's reasoning is auditable — a verdict with no record of why is the black box we said we
would not build.
"""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from agent_framework.orchestrations import ConcurrentBuilder
from pydantic import BaseModel

from .coverage import classify_coverage, covered_sentence
from .llm import AgentFactory, recording
from .models import AgentCall, CheckName, CheckResult, Verdict, VerifyRequest, VerifyResponse

log = logging.getLogger(__name__)

# Below this, a passing verdict still goes to a human.
CONFIDENCE_FLOOR = 70

#: Checks that can hold an event back on their own.
#:
#: Corroboration is deliberately absent. It asks whether the event can be confirmed *somewhere
#: else*, and the honest answer for most submissions is no: somebody photographing a poster on a
#: noticeboard has no URL to give, and the poster is the source. Treating that absence as doubt
#: about the event held back a real fishing festival whose other four checks passed at 90–100%,
#: because a 60% confidence sat under the floor.
#:
#: Categorisation is absent for the same reason, and it took the same kind of report to see it. An
#: opening party submitted as `anna` came back "uncertain, 70%: a category like 'fest' might fit
#: better" — which is a fair remark and not a reason to refuse the event. Nobody looking for that
#: party would have failed to find it under `anna`; they simply never got the chance, because with
#: no human queue "review" means no.
#:
#: There is a second argument, and it is the one that settles it: `importers/mec` files *every*
#: event it imports as `anna` on purpose, because guessing a category from a listing that states
#: none would be inventing a fact. Publishing hundreds of imported events under a deliberately
#: vague category while refusing a person's for a suboptimal one is not a standard, it is an
#: inconsistency. A category is metadata we can improve; it is not grounds to reject a real local
#: event.
#:
#: Both still report what they found, and both still appear on the verdict and in /kø — so a sender
#: is told a better category exists, and can change it if they agree. What they no longer do is
#: decide the outcome.
#:
#: Coverage is here, and it is the only one of these a sender can fail without having got
#: anything wrong. An event in Bergen is a real, well-formed, correctly categorised event; it is
#: simply not one this calendar covers, and publishing it is the failure. So it blocks — and unlike
#: the other three it can also `fail` outright, because "somewhere else" is not a thing a human
#: review would resolve differently. See `coverage.py`.
BLOCKING_CHECKS = frozenset({"plausibility", "duplicate", "normalisation", "coverage"})

SYSTEM = """Du vurderer innsende arrangement for hendingar.no, ein open kalender for lokale
arrangement i Noreg.

Du skal vere hjelpsam, ikkje mistenksam. Dei aller fleste innsendingar er ekte arrangement frå folk
som vil dele noko. Avvis berre det som klart er spam, reklame, ein test, eller noko som ikkje er eit
arrangement i det heile.

Svar med:
- verdict: "pass" (klart greitt), "uncertain" (i tvil), "fail" (klart ikkje ei hending)
- confidence: 0-100
- reasoning: éi til to setningar på nynorsk. Dette blir vist til folk, ikkje berre logga."""


def _iso(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def check_normalisation(request: VerifyRequest) -> CheckResult:
    """A rule, not a model: dates either parse and make sense, or they don't."""
    starts = _iso(request.starts_at)
    if starts is None:
        return CheckResult(
            check="normalisation",
            verdict="fail",
            confidence=100,
            reasoning=f"Starttidspunktet '{request.starts_at}' kan ikkje tolkast.",
            deterministic=True,
        )

    ends = _iso(request.ends_at) if request.ends_at else None
    if ends and ends <= starts:
        return CheckResult(
            check="normalisation",
            verdict="uncertain",
            confidence=90,
            reasoning="Sluttidspunktet er før starttidspunktet.",
            deterministic=True,
        )

    now = datetime.now(starts.tzinfo)
    if starts < now - timedelta(days=1):
        return CheckResult(
            check="normalisation",
            verdict="uncertain",
            confidence=85,
            reasoning="Arrangementet ligg i fortida. Er årstalet rett?",
            deterministic=True,
        )
    if starts > now + timedelta(days=730):
        return CheckResult(
            check="normalisation",
            verdict="uncertain",
            confidence=80,
            reasoning="Arrangementet ligg meir enn to år fram i tid.",
            deterministic=True,
        )

    return CheckResult(
        check="normalisation",
        verdict="pass",
        confidence=100,
        reasoning="Dato og tid er gyldige og ligg framover i tid.",
        deterministic=True,
    )


def check_coverage(request: VerifyRequest) -> CheckResult:
    """A rule: is this event in one of the municipalities we publish?

    The check that was missing. A concert by The Watch in Grieghallen, Bergen was submitted, passed
    plausibility at 90%, categorisation at 90%, normalisation at 100% and duplicate at 95%, and went
    live — because every one of those questions has a correct answer for a Bergen concert and none
    of them is "where is it". "Bergen" travelled through the whole pipeline as a string nothing
    compared to anything.

    A rule rather than a model, on the same grounds as `check_duplicate`: which municipality a place
    is in is a fact. A model asked "is Grieghallen in Stord" would usually be right, cost a call,
    and be occasionally, unpredictably wrong about the one thing the product is.

    Three outcomes, not two, and the middle one is the point:

    * a covered place is named          → ``pass``
    * somewhere else is named           → ``fail``, because no human review resolves "Bergen"
    * nothing places it, or a county    → ``uncertain``, so it goes back to the person who knows

    That last branch is why the kommune box being optional is still safe. Leaving it empty does not
    refuse the event; it means we ask. What it no longer does is publish.
    """
    state, detail = classify_coverage(request.municipality, request.venue_name)

    if state == "inside":
        return CheckResult(
            check="coverage",
            verdict="pass",
            confidence=100,
            reasoning=f"Hendinga ligg i {detail}, som vi dekkjer.",
            deterministic=True,
        )
    if state == "outside":
        return CheckResult(
            check="coverage",
            verdict="fail",
            confidence=95,
            reasoning=(
                f"«{detail}» er ikkje ein av kommunane vi dekkjer. hendingar.no legg ut "
                f"hendingar i {covered_sentence()}."
            ),
            deterministic=True,
        )
    if state == "too-broad":
        return CheckResult(
            check="coverage",
            verdict="uncertain",
            confidence=50,
            reasoning=(
                f"«{detail}» er større enn ein kommune, så vi kunne ikkje avgjere om hendinga "
                f"ligg i {covered_sentence()}. Skriv kommunen."
            ),
            deterministic=True,
        )
    return CheckResult(
        check="coverage",
        verdict="uncertain",
        confidence=50,
        reasoning=(
            "Ingen kommune oppgitt, så vi kunne ikkje avgjere om hendinga ligg i "
            f"{covered_sentence()}. Skriv kommunen, så går ho ut med ein gong."
        ),
        deterministic=True,
    )


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _similarity(a: str, b: str) -> float:
    """Token overlap (Jaccard). Crude on purpose — it only has to shortlist for a human."""
    left, right = set(_normalise(a).split()), set(_normalise(b).split())
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def check_duplicate(request: VerifyRequest) -> CheckResult:
    """Also a rule. The database already shortlisted candidates by time window; this scores them.

    A model is not needed to notice that two events share a title and a start time, and using one
    here would make a cheap, explainable check expensive and unpredictable.
    """
    if not request.candidates:
        return CheckResult(
            check="duplicate",
            verdict="pass",
            confidence=100,
            reasoning="Ingen liknande arrangement i same tidsrom.",
            deterministic=True,
        )

    best = max(request.candidates, key=lambda c: _similarity(request.title, c.title))
    score = _similarity(request.title, best.title)
    same_venue = (
        request.venue_name
        and best.venue_name
        and _normalise(request.venue_name) == _normalise(best.venue_name)
    )

    if score >= 0.8 and same_venue:
        return CheckResult(
            check="duplicate",
            verdict="fail",
            confidence=90,
            reasoning=(
                f"Ser ut til å vere same arrangement som «{best.title}» på same stad. "
                "Er det det, kan du gjere den betre med det du sende i staden."
            ),
            deterministic=True,
        )
    if score >= 0.5:
        return CheckResult(
            check="duplicate",
            verdict="uncertain",
            confidence=70,
            reasoning=(
                f"Liknar på «{best.title}» i same tidsrom. Er det den same, kan du gjere den "
                "betre med det du sende i staden for å sende henne inn på nytt."
            ),
            deterministic=True,
        )
    return CheckResult(
        check="duplicate",
        verdict="pass",
        confidence=95,
        reasoning="Ingen av dei liknande arrangementa ser ut til å vere det same.",
        deterministic=True,
    )


class _Judgement(BaseModel):
    """What one judging agent must answer with. Internal — the wire shape is `CheckResult`."""

    verdict: Verdict
    # Bare, and clamped by `_to_result`. Strict mode does not enforce a numeric range, so a model
    # is free to answer 400 — and a check thrown away over that would read as "could not decide".
    confidence: int
    reasoning: str


# One judging call is a sentence of reasoning and two numbers. Enough headroom that a model which
# thinks out loud before answering still lands the object.
MAX_TOKENS = 500


@dataclass(frozen=True)
class _ModelCheck:
    """A seat at the judging table: which check it answers, and what it is asked to weigh."""

    check: CheckName
    question: str


#: The two checks a rule cannot decide.
#:
#: They are asked *concurrently*, of the same rendered submission, because they are independent
#: questions about one record — "is this real" does not depend on "is the category right", and
#: neither improves for having seen the other's answer. Asking them one after the other, which is
#: what this did before, spent two round-trips of a person's time on the submit button for no
#: better verdict.
_MODEL_CHECKS: tuple[_ModelCheck, ...] = (
    _ModelCheck(
        check="plausibility",
        question=(
            "Spørsmålet ditt er dette: Er dette eit verkeleg lokalt arrangement, eller er det "
            "spam, reklame eller ein test? Vurder heile innsendinga under eitt."
        ),
    ),
    _ModelCheck(
        check="categorisation",
        question=(
            "Spørsmålet ditt er dette: Passar kategorien som er vald til arrangementet? "
            "Svar 'pass' om kategorien er rimeleg, 'uncertain' om ein annan passar klart betre "
            "(nemn kva for ein i reasoning). Bruk ALDRI 'fail' her: eit val i ei nedtrekksliste er "
            "ikkje grunn til å avvise eit ekte arrangement, og eit 'fail' frå kvar som helst av "
            "sjekkane avviser innsendinga."
        ),
    ),
)


def _case(request: VerifyRequest) -> str:
    """The submission, rendered once, for every judging agent to read.

    One rendering rather than a prompt per check: the record is the same record, and two prompts
    that each named a different subset of it is how `coverage` came to be missing in the first
    place — nothing compared the place to anything because no prompt carried it.
    """
    return (
        f"Tittel: {request.title}\n"
        f"Kategori: {request.category}\n"
        f"Skildring: {request.description or '(ingen)'}\n"
        f"Stad: {request.venue_name or '(ukjend)'}, {request.municipality or '(ukjend kommune)'}\n"
        f"Arrangør: {request.organizer_name or '(ukjend)'}\n"
        f"Tid: {request.starts_at}"
    )


def _undecided(check: CheckName, model: str | None) -> CheckResult:
    """Fail open to a human, never to publication."""
    return CheckResult(
        check=check,
        verdict="uncertain",
        confidence=0,
        reasoning="Automatisk vurdering kunne ikkje fullførast, så vi kunne ikkje avgjere denne.",
        model=model,
    )


def _not_asked(check: CheckName) -> CheckResult:
    """A check we chose not to run, said as that and not as one that failed to answer.

    `_undecided` is a different sentence: it means we asked and could not get an answer, which is
    a fact about our own availability and the reason rule 8 exists. This means the submission was
    already refused by a rule before we got here, so asking would have cost somebody a wait for a
    verdict that could not change the outcome.

    `deterministic` is true because it is: the decision not to ask was made by a rule, not by a
    model, and `model` is null because none was called. The sender is shown that badge to tell a
    model's opinion from a fact, and "Modell" on a call that never happened would be the wrong one.
    """
    return CheckResult(
        check=check,
        verdict="uncertain",
        confidence=0,
        reasoning="Innsendinga blei stoppa av ein annan kontroll, så denne blei ikkje vurdert.",
        deterministic=True,
    )


def _to_result(check: CheckName, text: str, model: str) -> CheckResult:
    """One agent's answer as a check result, with the rules that must not depend on the model.

    Categorisation is clamped here rather than trusted to obey its prompt: a `fail` from *any*
    check rejects the submission outright, so leaving that outcome reachable would mean a dropdown
    choice could lose a real event. Asking a model politely is not the same as making it
    impossible. See ``BLOCKING_CHECKS``.
    """
    judgement = _Judgement.model_validate_json(text)
    verdict = judgement.verdict
    if check == "categorisation" and verdict == "fail":
        verdict = "uncertain"
    return CheckResult(
        check=check,
        verdict=verdict,
        confidence=max(0, min(100, judgement.confidence)),
        reasoning=judgement.reasoning,
        model=model,
    )


def _in_declared_order(judged: dict[str, CheckResult], model: str | None) -> list[CheckResult]:
    """Both checks, in the order this file declares them, whatever the orchestration returned.

    The framework's fan-in already hands results back in participant order rather than completion
    order — measured, with a deliberately slow participant, not assumed. This does not exist to
    correct that. It exists so that a check *missing* from the aggregate still appears, as
    undecided: every check the sender is shown has to be one of ours, and a check that quietly
    vanished would be read downstream as one that passed.
    """
    return [judged.get(check.check) or _undecided(check.check, model) for check in _MODEL_CHECKS]


async def model_checks(factory: AgentFactory, request: VerifyRequest) -> list[CheckResult]:
    """Ask both judging agents at once, and report them in a fixed order."""
    agents = [
        factory.agent(
            name=check.check,
            instructions=f"{SYSTEM}\n\n{check.question}",
            response_format=_Judgement,
            max_tokens=MAX_TOKENS,
        )
        for check in _MODEL_CHECKS
    ]

    def aggregate(responses) -> dict[str, CheckResult]:
        results: dict[str, CheckResult] = {}
        for response in responses:
            check: CheckName = response.executor_id  # the agent's name is the check's name
            text = response.agent_response.messages[-1].text if response.agent_response else ""
            if response.agent_response.finish_reason == "content_filter" or not text:
                results[check] = _undecided(check, factory.model)
                continue
            try:
                results[check] = _to_result(check, text, factory.model)
            except ValueError:
                # A malformed answer is an answer we cannot act on, not a reason to lose the
                # submission. The strict schema makes this close to unreachable; the branch is
                # here because "close to" is not "never" and the cost of being wrong is an event.
                log.warning("check %s returned something unreadable", check)
                results[check] = _undecided(check, factory.model)
        return results

    workflow = ConcurrentBuilder(participants=agents).with_aggregator(aggregate).build()
    outputs = (await factory.run_workflow(workflow, _case(request))).get_outputs()
    return _in_declared_order(outputs[0] if outputs else {}, factory.model)


def check_corroboration(request: VerifyRequest) -> CheckResult:
    """A rule: either a source was given or it wasn't. Whether it resolves is a later problem.

    Reports honestly and never blocks on its own — see ``BLOCKING_CHECKS``. Most people
    photographing a poster on a noticeboard have no URL to give, and the poster is the source.
    """
    if not request.source_url:
        return CheckResult(
            check="corroboration",
            verdict="uncertain",
            confidence=60,
            reasoning=(
                "Ingen kjelde-URL oppgitt, så vi kunne ikkje stadfeste hendinga andre stader. "
                "Det åleine stoppar henne ikkje."
            ),
            deterministic=True,
        )
    return CheckResult(
        check="corroboration",
        verdict="pass",
        confidence=80,
        reasoning=f"Kjelde oppgitt: {request.source_url}",
        deterministic=True,
    )


def _unavailable(check: CheckName) -> CheckResult:
    """No model is configured at all, which is a fact about us and not about the submission."""
    return CheckResult(
        check=check,
        verdict="uncertain",
        confidence=0,
        reasoning="Automatisk vurdering er ikkje slått på, så vi kunne ikkje avgjere denne.",
        deterministic=True,
    )


async def verify(factory: AgentFactory | None, request: VerifyRequest) -> VerifyResponse:
    """Run the rules, and only then decide whether asking a model can still change the answer.

    The rules come first because they are free — four pure functions over a record already in
    memory — and because one of their outcomes settles the whole thing. **A `fail` anywhere is
    `reject`**, which is the rule three lines below this and has always been. So once a rule has
    failed, the two model calls cannot move the recommendation; they can only be spent, and spent
    while somebody waits on the submit button for them.

    The case that makes this worth doing is the one where the calls are least use. An event in
    Bergen is refused by `check_coverage` (ADR 0015) and is a real, well-formed, correctly
    categorised concert — so the two questions we would go on to ask are "does this look genuine"
    and "is the category right", and the honest answers are yes and yes. That was two model calls
    and the wait for the slower of them, to tell a sender something true and irrelevant about an
    event we had already declined.

    What does not change: every sender still sees all six checks. A check that is not asked says
    so (`_not_asked`) rather than vanishing, because a check missing from the list reads downstream
    as one that passed — the same reason `_in_declared_order` exists one function up.
    """
    checks: list[CheckResult] = [
        check_normalisation(request),
        check_duplicate(request),
        check_coverage(request),
        check_corroboration(request),
    ]

    #: The checks that were never put, so the summary can leave them out of the sentence a sender
    #: reads. They stay in `checks` and they stay in the recommendation below — an unasked check is
    #: `uncertain`, so it can only ever make the outcome more cautious, never less. What it must
    #: not do is talk: "this was not assessed" appended to the reason it was not assessed is a
    #: circle, and it would land in front of the one sentence that says what to fix.
    unasked: frozenset[str] = frozenset()

    #: What the model calls behind this verdict cost. Empty on both branches that make none,
    #: which is the honest reading: a submission a rule refused cost nothing to refuse.
    calls: list[AgentCall] = []

    if factory is None:
        # Both of them, not just the blocking one. `plausibility` alone was enough to force
        # `review` and so was all this branch ever emitted, which left the sender in an
        # environment without a verifier looking at five rows where the page promises six.
        checks.extend(_unavailable(check.check) for check in _MODEL_CHECKS)
    elif any(check.verdict == "fail" for check in checks):
        unasked = frozenset(check.check for check in _MODEL_CHECKS)
        checks.extend(_not_asked(check.check) for check in _MODEL_CHECKS)
    else:
        with recording() as recorded:
            checks.extend(await model_checks(factory, request))
        calls = recorded

    if any(c.verdict == "fail" for c in checks):
        recommendation = "reject"
    elif any(
        (c.verdict == "uncertain" or c.confidence < CONFIDENCE_FLOOR) and c.check in BLOCKING_CHECKS
        for c in checks
    ):
        recommendation = "review"
    else:
        recommendation = "publish"

    spoke = [c for c in checks if c.check not in unasked]
    blocking = [
        c
        for c in spoke
        if c.verdict != "pass" and (c.check in BLOCKING_CHECKS or c.verdict == "fail")
    ]
    caveats = [c for c in spoke if c.verdict != "pass" and c not in blocking]

    if blocking:
        summary = " ".join(c.reasoning for c in blocking)
    elif caveats:
        # Published, with the caveat stated. Leading with "could not be confirmed" on an event we
        # just published read as a refusal, which is how a fishing festival looked rejected.
        summary = "Alle avgjerande sjekkar gjekk gjennom. " + " ".join(c.reasoning for c in caveats)
    else:
        summary = "Alle sjekkar gjekk gjennom."
    return VerifyResponse(
        checks=checks, recommendation=recommendation, summary=summary, calls=calls
    )
