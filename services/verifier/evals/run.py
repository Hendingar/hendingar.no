"""Score extraction against real images with hand-written ground truth.

Run on demand, never in CI: this calls the live model. See evals/README.md for why.
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from pathlib import Path

from matchers import Failure, check, resolve

from verifier.config import load_config
from verifier.extract import extract_poster
from verifier.llm import LlmClientFactory
from verifier.models import ExtractRequest

CASES = Path(__file__).parent / "cases"


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
