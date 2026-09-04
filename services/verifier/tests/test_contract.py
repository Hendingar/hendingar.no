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


def test_extraction_fields_match_the_shared_schema():
    """Every field the service returns must be named in the app's schema, or it is dropped.

    The app validates each extraction against `extractedEventSchema` in packages/core, and Zod
    strips what the schema does not name — silently. That is exactly how a poster listing four
    evenings kept arriving as one: the service had learned to report them and nobody downstream
    was listening. Python cannot import the TypeScript, so the two are compared here.
    """
    from verifier.models import ExtractedEvent

    validation = (
        Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "validation.ts"
    ).read_text(encoding="utf-8")
    schema = validation.split("export const extractedEventSchema", 1)[1].split("\n});", 1)[0]

    # The service speaks snake_case and the schema camelCase; only multi-word names differ.
    camel = {
        "start_time": "startTime",
        "end_time": "endTime",
        "venue_name": "venueName",
        "organizer_name": "organizerName",
        "ticket_url": "ticketUrl",
    }

    missing = [
        field
        for field in ExtractedEvent.model_fields
        if not re.search(rf"^\s*{re.escape(camel.get(field, field))}\s*:", schema, re.MULTILINE)
    ]
    assert not missing, (
        f"named by the verifier but not by extractedEventSchema: {missing}. "
        "The app will drop these without an error."
    )
