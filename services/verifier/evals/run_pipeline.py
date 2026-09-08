"""Score the verification pipeline against hand-written cases, on the live model.

The sibling of `run.py`. That one asks whether the model read the poster; this one asks whether
the pipeline reached the right decision about an event already in our shape — which is a different
question with a different failure mode, and the one that decides whether something gets published.

**These are not tests.** `pytest` covers every rule hermetically and must (CLAUDE.md rule 6). What
it cannot cover is the interaction between a rule and a confident model: the Bergen concert was
published because plausibility answered "yes, a real concert" at 90% and nothing outranked it. That
is a property of the whole pipeline with a real model in it, so it is measured here, on demand.

    pnpm verifier:eval:pipeline                 # every case
    pnpm verifier:eval:pipeline bergen          # cases whose name contains "bergen"

Requires the same environment as running the service and an `az login`. See evals/README.md.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from matchers import Failure, check, resolve

from verifier.config import load_config
from verifier.llm import LlmClientFactory
from verifier.models import VerifyRequest
from verifier.verify import verify

CASES = Path(__file__).parent / "pipeline"

_OFFSET = re.compile(r"^([+-])(\d+)([dh])$")


def resolve_when(value: str) -> str:
    """`+7d` → an ISO instant seven days from now. Anything else is passed through untouched.

    Cases assert on `normalisation`, which asks whether an event is in the future — so a case
    written with a literal date is a case that starts failing for the wrong reason on a date
    nobody chose. An offset says what the case means: "a week out", "yesterday".
    """
    match = _OFFSET.match(value)
    if not match:
        return value
    sign, amount, unit = match.groups()
    delta = timedelta(**{"d": {"days": int(amount)}, "h": {"hours": int(amount)}}[unit])
    return (datetime.now(UTC) + (delta if sign == "+" else -delta)).isoformat()


def flatten(response: dict) -> dict:
    """The response, plus its checks keyed by name.

    A case wants to say "coverage failed", and `checks` is a list whose order is an implementation
    detail of `verify()`. Asserting `checks.3.verdict` would make every case a hostage to the order
    the pipeline happens to append in, so the checks are also offered as `check.<name>`.
    """
    return {**response, "check": {c["check"]: c for c in response["checks"]}}


async def run_case(factory: LlmClientFactory, case: Path) -> tuple[bool, list[Failure], dict]:
    spec = json.loads((case / "case.json").read_text(encoding="utf-8"))
    payload = dict(spec["request"])
    for field in ("starts_at", "ends_at"):
        if isinstance(payload.get(field), str):
            payload[field] = resolve_when(payload[field])

    response = await verify(factory, VerifyRequest(**payload))
    got = flatten(response.model_dump())

    failures: list[Failure] = []
    for field, rule in spec["expect"].items():
        failures.extend(check(field, rule, resolve(got, field)))
    return not failures, failures, got


def summarise(got: dict) -> str:
    """One line per check, because the verdict alone never says why it went that way."""
    lines = [f"      → {got['recommendation']}: {got['summary']}"]
    for result in got["checks"]:
        how = result["model"] or ("regel" if result["deterministic"] else "?")
        lines.append(
            f"        {result['check']:<14} {result['verdict']:<9} "
            f"{result['confidence']:>3}%  {how}  {result['reasoning']}"
        )
    return "\n".join(lines)


async def main() -> int:
    needle = sys.argv[1] if len(sys.argv) > 1 else ""
    cases = sorted(c for c in CASES.iterdir() if c.is_dir() and needle in c.name)
    if not cases:
        print(f"no cases matching {needle!r}", file=sys.stderr)
        return 2

    factory = LlmClientFactory(load_config())
    passed = 0
    for case in cases:
        ok, failures, got = await run_case(factory, case)
        print(f"\n{'PASS' if ok else 'FAIL'}  {case.name}")
        if ok:
            passed += 1
        else:
            for failure in failures:
                print(f"      {failure}")
            print(summarise(got))

    print(f"\n{passed}/{len(cases)} cases passed")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
