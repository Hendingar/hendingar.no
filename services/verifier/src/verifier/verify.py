"""The verification pipeline.

Deliberately mixed: the checks a rule can decide are decided by a rule, and only the genuinely
judgemental ones consult a model. Every check returns its reasoning, because the README promises
the agent's reasoning is auditable — a verdict with no record of why is the black box we said we
would not build.
"""

import json
import logging
import re
from datetime import datetime, timedelta

from .coverage import classify_coverage, covered_sentence
from .llm import SEED, TEMPERATURE, LlmClientFactory
from .models import CheckResult, VerifyRequest, VerifyResponse

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


_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "uncertain", "fail"]},
        "confidence": {"type": "integer"},
        "reasoning": {"type": "string"},
    },
    "required": ["verdict", "confidence", "reasoning"],
    "additionalProperties": False,
}


async def _judge(factory: LlmClientFactory, check: str, prompt: str) -> CheckResult:
    client = factory.client()
    completion = await client.chat.completions.create(
        model=factory.model,
        max_completion_tokens=500,
        # Same reasoning as extraction: a verdict that flips between runs on identical input is
        # not a verdict. We store the reasoning and show it to people, so it has to be stable.
        temperature=TEMPERATURE,
        seed=SEED,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "verdict", "schema": _RESULT_SCHEMA, "strict": True},
        },
    )
    choice = completion.choices[0]
    if choice.finish_reason == "content_filter" or not choice.message.content:
        # Fail open to a human, never to publication.
        return CheckResult(
            check=check,  # type: ignore[arg-type]
            verdict="uncertain",
            confidence=0,
            reasoning="Automatisk vurdering kunne ikkje fullførast, så vi kunne ikkje avgjere denne.",
            model=factory.model,
        )
    data = json.loads(choice.message.content)
    return CheckResult(
        check=check,  # type: ignore[arg-type]
        verdict=data["verdict"],
        confidence=max(0, min(100, int(data["confidence"]))),
        reasoning=data["reasoning"],
        model=factory.model,
    )


async def check_plausibility(factory: LlmClientFactory, request: VerifyRequest) -> CheckResult:
    return await _judge(
        factory,
        "plausibility",
        "Er dette eit verkeleg lokalt arrangement, eller er det spam, reklame eller ein test?\n\n"
        f"Tittel: {request.title}\n"
        f"Skildring: {request.description or '(ingen)'}\n"
        f"Stad: {request.venue_name or '(ukjend)'}, {request.municipality or '(ukjend kommune)'}\n"
        f"Arrangør: {request.organizer_name or '(ukjend)'}\n"
        f"Tid: {request.starts_at}",
    )


async def check_categorisation(factory: LlmClientFactory, request: VerifyRequest) -> CheckResult:
    """Advisory. Reports a better category where it sees one, and never refuses the event.

    The prompt asks for no ``fail``, and the verdict is clamped anyway: a `fail` from *any* check
    rejects the submission outright, so leaving that outcome reachable here would mean a dropdown
    choice could lose a real event — the one thing this check is not allowed to do. Asking a model
    politely is not the same as making it impossible. See ``BLOCKING_CHECKS``.
    """
    result = await _judge(
        factory,
        "categorisation",
        f"Passar kategorien «{request.category}» til dette arrangementet?\n\n"
        f"Tittel: {request.title}\n"
        f"Skildring: {request.description or '(ingen)'}\n\n"
        "Svar 'pass' om kategorien er rimeleg, 'uncertain' om ein annan passar klart betre "
        "(nemn kva for ein i reasoning). Bruk ALDRI 'fail' her: eit val i ei nedtrekksliste er "
        "ikkje grunn til å avvise eit ekte arrangement, og eit 'fail' frå kvar som helst av "
        "sjekkane avviser innsendinga.",
    )
    if result.verdict == "fail":
        return result.model_copy(update={"verdict": "uncertain"})
    return result


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


async def verify(factory: LlmClientFactory | None, request: VerifyRequest) -> VerifyResponse:
    """Run every check. Without a model, the rule-based checks still run and the rest defers."""
    checks: list[CheckResult] = [
        check_normalisation(request),
        check_duplicate(request),
        check_coverage(request),
        check_corroboration(request),
    ]

    if factory is None:
        checks.append(
            CheckResult(
                check="plausibility",
                verdict="uncertain",
                confidence=0,
                reasoning="Automatisk vurdering er ikkje slått på, så vi kunne ikkje avgjere denne.",
                deterministic=True,
            )
        )
    else:
        checks.append(await check_plausibility(factory, request))
        checks.append(await check_categorisation(factory, request))

    if any(c.verdict == "fail" for c in checks):
        recommendation = "reject"
    elif any(
        (c.verdict == "uncertain" or c.confidence < CONFIDENCE_FLOOR) and c.check in BLOCKING_CHECKS
        for c in checks
    ):
        recommendation = "review"
    else:
        recommendation = "publish"

    blocking = [
        c
        for c in checks
        if c.verdict != "pass" and (c.check in BLOCKING_CHECKS or c.verdict == "fail")
    ]
    caveats = [c for c in checks if c.verdict != "pass" and c not in blocking]

    if blocking:
        summary = " ".join(c.reasoning for c in blocking)
    elif caveats:
        # Published, with the caveat stated. Leading with "could not be confirmed" on an event we
        # just published read as a refusal, which is how a fishing festival looked rejected.
        summary = "Alle avgjerande sjekkar gjekk gjennom. " + " ".join(c.reasoning for c in caveats)
    else:
        summary = "Alle sjekkar gjekk gjennom."
    return VerifyResponse(checks=checks, recommendation=recommendation, summary=summary)
