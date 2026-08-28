"""The one contract we cannot make a compiler enforce.

`packages/core/src/verification.ts` is the single source of truth for the check names (CLAUDE.md
rule 1). Python cannot import it, so this test reads the file and asserts the two lists agree.
Without it, renaming a check in TypeScript would silently produce rows this service never writes.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from verifier.models import CheckName, Verdict

_CORE = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "verification.ts"


def _string_array(name: str) -> list[str]:
    source = _CORE.read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.DOTALL)
    assert match, f"{name} not found in {_CORE}"
    return re.findall(r"'([^']+)'", match.group(1))


def test_check_names_match_core() -> None:
    assert _string_array("VERIFICATION_CHECKS") == list(get_args(CheckName))


def test_verdicts_match_core() -> None:
    assert _string_array("VERIFICATION_VERDICTS") == list(get_args(Verdict))
