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


class ExtractedRecurrence(BaseModel):
    """A stated repetition: "torsdager", "kvar tysdag", "første måndag i månaden".

    This field exists because omitting it caused hallucination, not merely lost information. With
    nowhere to put "every Thursday", the model put a concrete date in `date` — and picked the wrong
    weekday. A schema that cannot express what the image says forces a guess.
    """

    freq: Literal["daily", "weekly", "monthly"]
    interval: int = Field(default=1, ge=1, le=52, description="Every N periods; 2 = annakvar")
    weekdays: list[int] = Field(
        default_factory=list, description="1=Monday … 7=Sunday. Empty for daily."
    )
    nth: int | None = Field(
        default=None, description="Monthly only: 1-5, or -1 for the last of the month"
    )
    until: str | None = Field(default=None, description="YYYY-MM-DD, last date, if stated")


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
    recurrence: ExtractedRecurrence | None = Field(
        default=None,
        description="Set INSTEAD of date when the image states a repetition rather than one date",
    )
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


class AppealRequest(BaseModel):
    """An event the checks declined, plus the sender's case for it."""

    title: str
    description: str | None = None
    category: CategorySlug
    starts_at: str
    venue_name: str | None = None
    municipality: str | None = None
    organizer_name: str | None = None
    source_url: str | None = None
    #: What the automatic check said, so a juror is arguing with a stated reason rather than a mood.
    rejection_reason: str | None = None
    #: The sender's own words. Bounded here as well as in the app: this reaches a model.
    appeal: str = Field(min_length=10, max_length=2000)
    #: Which seat on the panel to ask. One call per juror, so the caller can stream them.
    juror: str


class JurorVerdict(BaseModel):
    juror: str
    name: str
    publish: bool
    confidence: int = Field(ge=0, le=100)
    reasoning: str
    model: str | None = None
