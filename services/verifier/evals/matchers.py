"""The scoring vocabulary, shared by every eval runner.

Split out of `run.py` when the second runner arrived. There are two kinds of eval here — did the
model read the poster (`run.py`), and did the pipeline reach the right verdict (`run_verify.py`) —
and they differ only in what they call and what they assert about. The matchers are the same
matchers, and two copies of "what does `oneOf` mean" is exactly the drift CLAUDE.md rule 1 is about.

Not a package: these are scripts, so `evals/` is on `sys.path` when either runner is executed
directly and a plain `from matchers import …` resolves.
"""

from __future__ import annotations

from dataclasses import dataclass


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
    than raising, so a case can assert on a nested rule without first asserting it exists.

    A list index is a path segment: `checks.0.verdict`. The verification eval needs it, and the
    alternative — a second lookup function for one runner — is how two of these grow apart.
    """
    node: object = payload
    for part in path.split("."):
        if node is None:
            return None
        if isinstance(node, list):
            if not part.isdigit() or int(part) >= len(node):
                raise SystemExit(f"expected.json asserts unknown index {path!r}")
            node = node[int(part)]
            continue
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
