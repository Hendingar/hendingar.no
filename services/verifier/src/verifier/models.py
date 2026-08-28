"""Wire contracts. These mirror the Zod schemas in packages/core/src/validation.ts.

Two definitions of one shape is a drift risk, so the app has a contract test that asserts the
field sets still agree — see app/src/lib/server/verifier.spec.ts.
"""

from typing import Literal

from pydantic import BaseModel, Field

CategorySlug = Literal[
    "musikk",
    "teater",
    "utstilling",
    "sport",
    "mote",
    "kyrkjeliv",
    "festival",
    "litteratur",
    "stand-up",
    "show",
    "mat-og-drikke",
    "dans",
    "marknad",
    "konferanse",
    "kurs",
    "anna",
]

CheckName = Literal["plausibility", "duplicate", "normalisation", "categorisation", "corroboration"]
Verdict = Literal["pass", "uncertain", "fail"]


class ExtractRequest(BaseModel):
    """A photograph of a poster, base64-encoded, plus its media type."""

    image_base64: str
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    # Today at the venue, so relative dates on a poster ("laurdag 14.") resolve correctly.
    today: str = Field(description="YYYY-MM-DD, local date where the poster was photographed")


class ExtractedEvent(BaseModel):
    """Everything is nullable except confidence and the notes.

    A poster that omits the organiser is normal; a model that invents one is worse than a blank
    field a human fills in. `unreadable` drives the UI's highlighting.
    """

    title: str | None = None
    description: str | None = None
    category: CategorySlug | None = None
    date: str | None = Field(default=None, description="YYYY-MM-DD, local at the venue")
    start_time: str | None = Field(default=None, description="HH:MM, 24-hour, local")
    end_time: str | None = None
    venue_name: str | None = None
    municipality: str | None = None
    organizer_name: str | None = None
    ticket_url: str | None = None
    confidence: int = Field(ge=0, le=100)
    unreadable: list[str] = Field(default_factory=list)
    note: str = Field(description="One sentence in Nynorsk about what was read and what was not")


class CandidateEvent(BaseModel):
    """An event already in the database, for the duplicate check to compare against."""

    id: int
    title: str
    starts_at: str
    venue_name: str | None = None


class VerifyRequest(BaseModel):
    title: str
    description: str | None = None
    category: CategorySlug
    starts_at: str
    ends_at: str | None = None
    venue_name: str | None = None
    municipality: str | None = None
    organizer_name: str | None = None
    source_url: str | None = None
    # Pre-filtered by the caller — the database does the searching, the model does the judging.
    candidates: list[CandidateEvent] = Field(default_factory=list)


class CheckResult(BaseModel):
    check: CheckName
    verdict: Verdict
    confidence: int = Field(ge=0, le=100)
    reasoning: str
    # True when a plain rule decided it and no model was consulted.
    deterministic: bool = False
    model: str | None = None


class VerifyResponse(BaseModel):
    checks: list[CheckResult]
    # 'published' only when every check passes with enough confidence; otherwise a human decides.
    recommendation: Literal["publish", "review", "reject"]
    summary: str
