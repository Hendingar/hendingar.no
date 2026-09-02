"""Score extraction against real images with hand-written ground truth.

Run on demand, never in CI: this calls the live model. See evals/README.md for why.
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from verifier.config import load_config
from verifier.extract import extract_poster
from verifier.llm import LlmClientFactory
from verifier.models import ExtractRequest

CASES = Path(__file__).parent / "cases"


@dataclass
class Failure:
    field: str
    matcher: str
    expected: object
    actual: object

    def __str__(self) -> str:
        return f"{self.field}: expected {self.matcher} {self.expected!r}, got {self.actual!r}"


def _norm(value: object) -> object:
    if isinstance(value, str):
        return value.strip().lower()
    if isinstance(value, list):
        return [_norm(v) for v in value]
    return value


def resolve(payload: dict, path: str) -> object:
    """Look up a dotted field path. `recurrence.freq` reads through a null parent as null rather
    than raising, so a case can assert on a nested rule without first asserting it exists."""
    node: object = payload
    for part in path.split("."):
        if node is None:
            return None
        if not isinstance(node, dict) or part not in node:
            raise SystemExit(f"expected.json asserts unknown field {path!r}")
        node = node[part]
    return node


def check(field: str, rule: dict, actual: object) -> list[Failure]:
    """Apply every matcher declared for one field. Unknown matchers are an error, not a skip —
    a typo'd matcher silently passing would make the whole eval worthless."""
    out: list[Failure] = []
    for matcher, expected in rule.items():
        if matcher == "equals":
            ok = _norm(actual) == _norm(expected)
        elif matcher == "contains":
            ok = isinstance(actual, str) and str(_norm(expected)) in str(_norm(actual))
        elif matcher == "oneOf":
            ok = _norm(actual) in [_norm(v) for v in expected]
        elif matcher == "isNull":
            ok = (actual is None) is bool(expected)
        elif matcher == "atLeast":
            ok = isinstance(actual, int | float) and actual >= expected
        elif matcher == "atMost":
            ok = isinstance(actual, int | float) and actual <= expected
        else:
            raise SystemExit(f"unknown matcher {matcher!r} on field {field!r}")
        if not ok:
            out.append(Failure(field, matcher, expected, actual))
    return out


async def run_case(factory: LlmClientFactory, case: Path) -> tuple[bool, list[Failure], dict]:
    spec = json.loads((case / "expected.json").read_text(encoding="utf-8"))
    image = next(case.glob("image.*"))
    media = "image/png" if image.suffix == ".png" else "image/jpeg"

    result = await extract_poster(
        factory,
        ExtractRequest(
            image_base64=base64.b64encode(image.read_bytes()).decode(),
            media_type=media,
            today=spec["today"],
        ),
    )
    got = result.model_dump()

    failures: list[Failure] = []
    for field, rule in spec["expect"].items():
        failures.extend(check(field, rule, resolve(got, field)))
    return not failures, failures, got


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
            print("      got: " + json.dumps(got, ensure_ascii=False))

    print(f"\n{passed}/{len(cases)} cases passed")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
