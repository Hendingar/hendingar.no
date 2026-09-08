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
_COVERAGE_TS = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "coverage.ts"


def _string_array(name: str) -> list[str]:
    source = _CORE.read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.DOTALL)
    assert match, f"{name} not found in {_CORE}"
    return re.findall(r"'([^']+)'", match.group(1))


def test_check_names_match_core() -> None:
    assert _string_array("VERIFICATION_CHECKS") == list(get_args(CheckName))


def test_verdicts_match_core() -> None:
    assert _string_array("VERIFICATION_VERDICTS") == list(get_args(Verdict))


def test_covered_municipalities_match_core() -> None:
    """The area we publish, agreed between the two languages that both decide it.

    `services/verifier` refuses an event outside the area and `app/` refuses to let an appeal
    overturn that; both read their own copy of the list. A municipality added on one side only
    would mean the check rejects an event the appeal route is happy to publish, or the reverse —
    and neither would fail a test or log anything.
    """
    from verifier.coverage import COVERED_MUNICIPALITIES

    source = _COVERAGE_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const COVERED_MUNICIPALITIES = \[(.*?)\] as const;", source, re.DOTALL
    )
    assert match, f"COVERED_MUNICIPALITIES not found in {_COVERAGE_TS}"
    assert re.findall(r"'([^']+)'", match.group(1)) == list(COVERED_MUNICIPALITIES)


def test_covered_places_match_core() -> None:
    """The village and postal-town names too, because they are what decides most submissions.

    Compared as a flat set: which municipality a place belongs to matters to the reasoning we
    show, but a name known to only one of the two copies is the drift that changes a verdict.
    """
    from verifier.coverage import COVERED_PLACES

    source = _COVERAGE_TS.read_text(encoding="utf-8")
    block = source.split("export const COVERED_PLACES", 1)[1].split("\n};", 1)[0]
    ours = {place for places in COVERED_PLACES.values() for place in places}
    assert set(re.findall(r"'([^']+)'", block)) == ours


def test_uncommitted_place_words_match_core() -> None:
    """The list that decides "we cannot tell" rather than "not here".

    Drift here is the expensive direction: a county name present in one copy and missing from the
    other turns a submission that should come back to its sender into a rejection.
    """
    from verifier.coverage import UNCOMMITTED_PLACE_WORDS

    source = _COVERAGE_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const UNCOMMITTED_PLACE_WORDS = \[(.*?)\] as const;", source, re.DOTALL
    )
    assert match, f"UNCOMMITTED_PLACE_WORDS not found in {_COVERAGE_TS}"
    assert set(re.findall(r"'([^']+)'", match.group(1))) == set(UNCOMMITTED_PLACE_WORDS)


def test_crop_box_fields_match_the_shared_schema():
    """The crop endpoint's box is validated against `thumbnailCropSchema` in packages/core.

    Zod strips what a schema does not name, so a box that gained a field here — a rotation, say —
    would arrive in the browser with that field silently gone, and the crop would be applied as if
    it had never been asked for. Same failure mode as the extraction fields below, one call newer.
    """
    from verifier.models import ThumbnailCrop

    validation = (
        Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "validation.ts"
    ).read_text(encoding="utf-8")
    schema = validation.split("export const thumbnailCropSchema", 1)[1].split("\n});", 1)[0]

    missing = [
        field
        for field in ThumbnailCrop.model_fields
        if not re.search(rf"^\s*{re.escape(field)}\s*:", schema, re.MULTILINE)
    ]
    assert not missing, f"named by the verifier but not by thumbnailCropSchema: {missing}"


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
