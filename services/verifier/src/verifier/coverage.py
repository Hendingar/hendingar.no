"""Where hendingar.no publishes, and how a stated place is matched against it.

The second copy of ``packages/core/src/coverage.ts``. Python cannot import TypeScript, so the two
lists are compared in ``tests/test_contract.py`` — the same arrangement as the check names, and for
the same reason: a place added on one side and not the other is a silent disagreement about what
the site covers.

Read the TypeScript for the reasoning. The short version: a concert in Grieghallen, Bergen was
submitted and published, because no check asked where the event was.
"""

from __future__ import annotations

import re
import unicodedata

#: The municipalities we publish.
COVERED_MUNICIPALITIES: tuple[str, ...] = ("Stord", "Bømlo", "Fitjar")

#: Places inside each of them, because almost nobody writes the municipality.
#:
#: A poster says "Leirvik" and a sender types "Leirvik". One word per entry — matching is per
#: token, so a two-word entry could never match, and a test says so.
COVERED_PLACES: dict[str, tuple[str, ...]] = {
    "Stord": (
        "Leirvik",
        "Sagvåg",
        "Litlabø",
        "Nysæter",
        "Ådland",
        "Rommetveit",
        "Grunnavågen",
        "Huglo",
        "Føyno",
        "Heiane",
        "Valvatna",
        "Tysevågen",
    ),
    "Bømlo": (
        "Svortland",
        "Bremnes",
        "Moster",
        "Mosterhamn",
        "Rubbestadneset",
        "Langevåg",
        "Espevær",
        "Finnås",
        "Meling",
        "Hollundsdalen",
        "Foldrøyhamn",
        "Hiskjo",
        "Urangsvåg",
        "Våge",
        "Økland",
        "Vorland",
        "Gilje",
        "Sakseid",
        "Innvær",
        "Goddo",
        "Rolvsnes",
        "Siggjarvåg",
    ),
    "Fitjar": (
        "Rimbareid",
        "Årskog",
        "Sælevik",
        "Dåfjorden",
        "Øvrebygda",
        "Vestbøstad",
        "Osternes",
        "Koløy",
        "Selsøy",
        "Engesund",
    ),
}

#: Words that name somewhere without naming a municipality.
#:
#: The reason the check has three outcomes rather than two: "Vestland" is not one of our three, and
#: it is also not evidence the event is somewhere else — Stord is in Vestland. "Sunnhordland" is the
#: likeliest of the lot, being the region all three are in and what the local paper is called.
UNCOMMITTED_PLACE_WORDS: frozenset[str] = frozenset(
    {
        "vestland",
        "vestlandet",
        "hordaland",
        "sunnhordland",
        "sunnhordaland",
        "noreg",
        "norge",
        "norway",
        "kommune",
        "kommunen",
        "fylke",
        "ukjend",
        "ukjent",
    }
)

_FOLD = str.maketrans({"ø": "o", "å": "a", "æ": "ae"})


def place_tokens(value: str) -> list[str]:
    """``Bømlo`` → ``['bomlo']``, ``5410 SAGVÅG`` → ``['5410', 'sagvag']``.

    Tokens, not a substring search, and the reason is Stordal — a place 400km north that contains
    "Stord". ``'stordal'.startswith('stord')`` is true and would publish it here.
    """
    folded = unicodedata.normalize("NFD", value.lower().translate(_FOLD))
    stripped = "".join(c for c in folded if not unicodedata.combining(c))
    return [t for t in re.split(r"[^a-z0-9]+", stripped) if t]


#: Every token that means "inside", mapped to the municipality it belongs to.
_INSIDE: dict[str, str] = {
    token: municipality
    for municipality in COVERED_MUNICIPALITIES
    for place in (municipality, *COVERED_PLACES[municipality])
    for token in place_tokens(place)
}


def classify_coverage(municipality: str | None, venue_name: str | None) -> tuple[str, str]:
    """Where is this event, as far as anything we were told can say?

    Returns ``(state, detail)`` where state is ``inside``, ``outside``, ``nothing-stated`` or
    ``too-broad``. `detail` is the municipality for ``inside``, the stated place for ``outside``,
    and empty otherwise.

    Deliberately asymmetric: a covered name **anywhere** we look means inside, while only the
    municipality field can mean outside. Free text is good evidence that a place is ours and poor
    evidence that it is not — an "outside" read off a venue name would refuse a Stord event held at
    "Bergen Bar", and there is one of those in most towns in Norway.
    """
    stated = (municipality or "").strip()
    stated_tokens = place_tokens(stated)

    for token in stated_tokens:
        if token in _INSIDE:
            return "inside", _INSIDE[token]

    for token in place_tokens((venue_name or "").strip()):
        if token in _INSIDE:
            return "inside", _INSIDE[token]

    if not stated_tokens:
        return "nothing-stated", ""
    if all(token in UNCOMMITTED_PLACE_WORDS for token in stated_tokens):
        return "too-broad", stated
    return "outside", stated


def covered_sentence(conjunction: str = "og") -> str:
    """``Stord, Bømlo og Fitjar`` — from the list, so the sentence cannot go stale."""
    names = list(COVERED_MUNICIPALITIES)
    if len(names) == 1:
        return names[0]
    last = names.pop()
    return f"{', '.join(names)} {conjunction} {last}"
