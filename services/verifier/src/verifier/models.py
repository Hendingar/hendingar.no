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

CheckName = Literal[
    "plausibility",
    "duplicate",
    "normalisation",
    "coverage",
    "categorisation",
    "corroboration",
]
Verdict = Literal["pass", "uncertain", "fail"]


class ExtractRequest(BaseModel):
    """A photograph of a poster, base64-encoded, plus its media type."""

    image_base64: str
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    # Today at the venue, so relative dates on a poster ("laurdag 14.") resolve correctly.
    today: str = Field(description="YYYY-MM-DD, local date where the poster was photographed")


class CropRequest(BaseModel):
    """An image that is going to be a card thumbnail, and nothing else to do with it.

    Separate from `ExtractRequest` because the caller has a different question. Extraction is asked
    once, while somebody waits, to fill in a form. This is asked after an event has been approved,
    about a picture that was attached to a form somebody typed themselves — so there are no fields
    to read and no date to resolve against, only "which part of this is worth keeping".
    """

    image_base64: str
    media_type: Literal["image/jpeg", "image/png", "image/webp"]


class ExtractPageRequest(BaseModel):
    """The readable text of a web page somebody linked to, plus where it came from.

    The fallback for pages that publish no structured data. Where a page carries schema.org — as
    most Norwegian event sites do — the app reads that itself and never gets here: that is the
    site's own assertion about its own event, and no model can improve on it.

    Text, not HTML. The markup is stripped before sending, because none of it is the event and all
    of it is tokens.
    """

    text: str
    # The page's address. Given to the model as context only: a path like /arrangement/haustfest
    # often carries the name, and the host says who is speaking.
    url: str
    today: str = Field(description="YYYY-MM-DD, local date of the reader")


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


class ThumbnailCrop(BaseModel):
    """Where the interesting part of the poster is, as fractions of the image.

    A poster is usually portrait with a band of small print at the bottom; an event card wants a
    landscape thumbnail. Cropping to the centre cuts the face off a concert poster and keeps the
    ticket terms, which is the wrong half.

    Fractions rather than pixels because the browser downscales before sending, so the model never
    sees the size the crop will be applied at. Best effort by definition — a missing or nonsensical
    box just means no crop, never a broken image.
    """

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class CropSuggestion(BaseModel):
    """Where to cut a thumbnail out of one image — or the model saying it does not know.

    `thumbnail` is null when nothing in the picture reads as a subject, and that is a useful answer
    rather than a failure: the caller falls back to a centred landscape band of the whole image,
    which is what the person sent and better than a guess that cuts the face off.
    """

    thumbnail: ThumbnailCrop | None = Field(
        default=None,
        description="The part worth keeping, in fractions of the image. Empty if unsure.",
    )
    note: str = Field(
        default="",
        description="One short sentence, Nynorsk, on what was chosen. For logs, not for a reader.",
    )


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
    dates: list[str] = Field(
        default_factory=list,
        description=(
            "Every date the image names, YYYY-MM-DD, when it lists them one by one rather than "
            "stating a rule. Set INSTEAD of date."
        ),
    )
    venue_name: str | None = None
    municipality: str | None = None
    organizer_name: str | None = None
    ticket_url: str | None = None
    confidence: int = Field(ge=0, le=100)
    unreadable: list[str] = Field(default_factory=list)
    note: str = Field(description="One sentence in Nynorsk about what was read and what was not")
    thumbnail: ThumbnailCrop | None = Field(
        default=None,
        description="The part of the image worth keeping as a card thumbnail. Best effort.",
    )


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


class ImproveRequest(BaseModel):
    """A submission as it stands in the form, before anybody has judged it.

    The same fields `VerifyRequest` carries, minus the duplicate candidates: this asks what the
    text could say, not whether we already have the event.
    """

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category: CategorySlug
    starts_at: str
    ends_at: str | None = None
    venue_name: str | None = None
    municipality: str | None = None
    organizer_name: str | None = None
    source_url: str | None = None


class ImproveSuggestion(BaseModel):
    """A description the sender may take or leave, and what was learned either way.

    `description` is null far more often than it is set, and that is the design rather than a
    failure mode: it is only filled when a second agent has confirmed every claim in it is already
    in the submission. `missing` and `removed` are useful even then — they are the honest half of
    the answer, and they survive a discarded draft.
    """

    description: str | None = Field(
        default=None, description="The proposed text, or null when none could be grounded"
    )
    removed: list[str] = Field(
        default_factory=list,
        description="Claims the fact-checker struck out, in its own words, for the sender to read",
    )
    missing: list[str] = Field(
        default_factory=list,
        description="Facts a reader would want that the submission does not state. Questions, not guesses",
    )
    note: str = Field(description="One sentence in Nynorsk to the person who wrote the text")
    rounds: int = Field(
        default=0, ge=0, description="How many turns the writer and the fact-checker took"
    )


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
