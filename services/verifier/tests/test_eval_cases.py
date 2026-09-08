"""Keep the pipeline eval corpus honest without spending a token on it.

`evals/run_pipeline.py` calls the live model, so it runs on demand and never in CI (CLAUDE.md rule
6). That leaves a gap the extraction evals have always had: a case with a misspelled request field
or an expectation on a check that does not exist fails only when somebody sits down to run the
suite, and reads as a model regression when it is a typo.

So this asserts everything about the corpus that can be asserted offline — the requests are valid,
the assertions address fields that exist — and then actually *runs* the assertions that are about
deterministic checks. `coverage` is a rule, so its verdict is the same with a model or without one,
which means the Bergen concert is a CI failure from here on and not merely an eval case.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import get_args

import pytest

from verifier.models import CheckName, CheckResult, VerifyRequest
from verifier.verify import verify

_EVALS = Path(__file__).resolve().parents[1] / "evals"
sys.path.insert(0, str(_EVALS))

from matchers import check as apply_matchers
from matchers import resolve
from run_pipeline import flatten, resolve_when

CASES = sorted(p for p in (_EVALS / "pipeline").iterdir() if p.is_dir())

#: Checks that reach the same verdict with no model at all, so their expectations run here.
DETERMINISTIC = {"coverage", "normalisation", "duplicate", "corroboration"}


def _spec(case: Path) -> dict:
    return json.loads((case / "case.json").read_text(encoding="utf-8"))


def _request(spec: dict) -> VerifyRequest:
    payload = dict(spec["request"])
    for field in ("starts_at", "ends_at"):
        if isinstance(payload.get(field), str):
            payload[field] = resolve_when(payload[field])
    return VerifyRequest(**payload)


def test_there_are_cases_at_all() -> None:
    """A glob that quietly matches nothing is how a suite reports 0/0 and exits zero."""
    assert len(CASES) >= 5


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.name)
class TestEveryCase:
    def test_says_where_it_came_from(self, case: Path) -> None:
        """A case with no provenance is a case nobody can check or correct later."""
        spec = _spec(case)
        assert spec.get("description", "").strip()
        assert spec.get("source", "").strip()

    def test_the_request_is_valid(self, case: Path) -> None:
        """A misspelled field would otherwise surface as a pydantic error mid-eval run."""
        assert _request(_spec(case)).title

    def test_it_asserts_something(self, case: Path) -> None:
        assert _spec(case)["expect"], "a case with no expectations always passes"

    def test_every_assertion_addresses_a_field_that_exists(self, case: Path) -> None:
        """`check.covrage.verdict` resolves to nothing and would fail as a wrong verdict."""
        for path in _spec(case)["expect"]:
            head, *rest = path.split(".")
            if head == "check":
                assert rest, f"{path}: name a check"
                assert rest[0] in get_args(CheckName), f"{path}: no such check"
                assert len(rest) == 2, f"{path}: name one field of the check"
                assert rest[1] in CheckResult.model_fields, f"{path}: no such field"
            else:
                assert head in {"recommendation", "summary", "checks"}, f"{path}: unknown field"

    async def test_the_deterministic_assertions_hold(self, case: Path) -> None:
        """The half of each case that needs no model — run for real, here, on every commit.

        `verify(None, …)` skips the two model checks and runs the four rules, so every expectation
        about a rule is checkable now. That is what makes the Bergen concert a failing test rather
        than a note in an eval directory somebody remembers to run.
        """
        got = flatten((await verify(None, _request(_spec(case)))).model_dump())

        failures = []
        for path, rule in _spec(case)["expect"].items():
            parts = path.split(".")
            if parts[0] != "check" or parts[1] not in DETERMINISTIC:
                continue
            failures.extend(apply_matchers(path, rule, resolve(got, path)))
        assert not failures, "; ".join(str(f) for f in failures)


def test_relative_start_times_resolve() -> None:
    """The offsets cases are written with. A literal date would rot; `+7d` says what it means."""
    seven = datetime.fromisoformat(resolve_when("+7d"))
    assert timedelta(days=6, hours=23) < seven - datetime.now(UTC) < timedelta(days=7, hours=1)

    yesterday = datetime.fromisoformat(resolve_when("-1d"))
    assert yesterday < datetime.now(UTC)

    # Anything that is not an offset is a real value and must survive untouched.
    assert resolve_when("2026-09-12T20:00:00+02:00") == "2026-09-12T20:00:00+02:00"


def test_the_bergen_case_is_still_in_the_corpus() -> None:
    """Named rather than merely counted.

    The corpus is the record of what has actually gone wrong here, and the case that documents a
    published Bergen concert is the one somebody would delete while tidying. If the coverage rule
    is ever deliberately removed, this fails and asks for that decision to be written down.
    """
    (bergen,) = (c for c in CASES if "bergen" in c.name)
    assert _spec(bergen)["expect"]["check.coverage.verdict"] == {"equals": "fail"}
