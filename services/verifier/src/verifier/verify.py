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
#: Corroboration still reports what it found, and a `fail` from any check still rejects. What it can
#: no longer do is turn "we could not cross-check this" into "a human must look at it" — which, with
#: nobody in the queue, meant no.
BLOCKING_CHECKS = frozenset({"plausibility", "duplicate", "normalisation", "categorisation"})

SYSTEM = """Du vurderer innsende arrangement for hendingar.no, ein open kalender for lokale
arrangement i Noreg.

Du skal vere hjelpsam, ikkje mistenksam. Dei aller fleste innsendingar er ekte arrangement frå folk
som vil dele noko. Avvis berre det som klart er spam, reklame, ein test, eller noko som ikkje er eit
arrangement i det heile.

Svar med:
- verdict: "pass" (klart greitt), "uncertain" (eit menneske bør sjå på det), "fail" (klart ikkje ei hending)
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
            reasoning=f"Ser ut til å vere same arrangement som «{best.title}» på same stad.",
            deterministic=True,
        )
    if score >= 0.5:
        return CheckResult(
            check="duplicate",
            verdict="uncertain",
            confidence=70,
            reasoning=f"Liknar på «{best.title}» i same tidsrom. Bør sjekkast av eit menneske.",
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
            reasoning="Automatisk vurdering kunne ikkje fullførast. Sendt til manuell sjekk.",
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
    return await _judge(
        factory,
        "categorisation",
        f"Passar kategorien «{request.category}» til dette arrangementet?\n\n"
        f"Tittel: {request.title}\n"
        f"Skildring: {request.description or '(ingen)'}\n\n"
        "Svar 'pass' om kategorien er rimeleg, 'uncertain' om ein annan passar klart betre "
        "(nemn kva for ein i reasoning), 'fail' berre om kategorien er heilt feil.",
    )


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
        check_corroboration(request),
    ]

    if factory is None:
        checks.append(
            CheckResult(
                check="plausibility",
                verdict="uncertain",
                confidence=0,
                reasoning="Automatisk vurdering er ikkje slått på. Sendt til manuell sjekk.",
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
