"""The fields of a JSON object that are already finished, read from a prefix of it.

A strict-schema answer arrives over the wire a few characters at a time and in the order the schema
declares, so a poster's title is complete and correct seconds before its organiser exists. This is
what lets a reader see that rather than a timer pretending to know.

**Nothing here guesses.** A field is reported only once its value has been closed — a string with
its final quote, a number with the delimiter after it, a literal spelled out in full. A truncated
string is indistinguishable from a short one to `json.loads`, which is exactly the mistake that
would put half a title in front of somebody and then change it. So the scanner tracks where a value
ends rather than trying to repair the prefix into something parseable.

Top level only. A nested object or array is scanned for balance so the scan can continue past it,
but never reported half-built: `recurrence` and `thumbnail` are structures a reader does not read,
and the authoritative typed object arrives at the end regardless.
"""

from __future__ import annotations

import json
from typing import Any

__all__ = ["completed_fields"]


def completed_fields(prefix: str) -> dict[str, Any]:
    """Every top-level key in `prefix` whose value is fully present, in the order they appear.

    `prefix` is however much of a JSON object has arrived. Returns an empty dict for anything that
    is not the start of an object, which covers the cases worth being relaxed about: an empty
    string, leading whitespace, and a model that opened with prose instead of a brace.
    """
    index = _skip_space(prefix, 0)
    if index >= len(prefix) or prefix[index] != "{":
        return {}
    index += 1

    fields: dict[str, Any] = {}
    while True:
        index = _skip_space(prefix, index)
        if index >= len(prefix) or prefix[index] == "}":
            return fields

        key_end = _end_of_string(prefix, index)
        if key_end is None:
            return fields
        key = json.loads(prefix[index:key_end])

        index = _skip_space(prefix, key_end)
        if index >= len(prefix) or prefix[index] != ":":
            return fields

        value_start = _skip_space(prefix, index + 1)
        value_end = _end_of_value(prefix, value_start)
        if value_end is None:
            return fields

        # A number is the one value whose end is only known from what follows it: `16` may still
        # become `160`. `_end_of_value` reports where it stopped, and the delimiter is the proof.
        after = _skip_space(prefix, value_end)
        if after >= len(prefix) or prefix[after] not in ",}":
            return fields

        fields[key] = json.loads(prefix[value_start:value_end])
        index = after + 1 if prefix[after] == "," else after


def _skip_space(text: str, index: int) -> int:
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    return index


def _end_of_string(text: str, index: int) -> int | None:
    """One past the closing quote of the string starting at `index`, or None if it is unfinished.

    Backslashes are counted rather than looked at: an odd run before a quote escapes it, an even
    run is a literal backslash and the quote closes the string. `"\\\\"` is a complete string of one
    character and must not read as an open one.
    """
    if index >= len(text) or text[index] != '"':
        return None
    index += 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return index + 1
        index += 1
    return None


#: The literals, and how long each one is.
_LITERALS = {"true": 4, "false": 5, "null": 4}


def _end_of_value(text: str, index: int) -> int | None:
    """One past the end of the value starting at `index`, or None if it has not finished arriving."""
    if index >= len(text):
        return None

    char = text[index]
    if char == '"':
        return _end_of_string(text, index)
    if char in "{[":
        return _end_of_structure(text, index)

    for literal, length in _LITERALS.items():
        if text.startswith(literal, index):
            return index + length
    # A literal still being spelled out — `nul` — is not a literal yet.
    if any(literal.startswith(text[index:]) for literal in _LITERALS):
        return None

    end = index
    while end < len(text) and text[end] in "-+.eE0123456789":
        end += 1
    # Nothing numeric here at all: the prefix is malformed rather than short, and there is nothing
    # further to be learned from it.
    return end if end > index else None


def _end_of_structure(text: str, index: int) -> int | None:
    """One past the matching bracket, or None if it has not been closed yet.

    Strings inside are skipped whole, so a brace in a description cannot close the object around it.
    """
    depth = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            end = _end_of_string(text, index)
            if end is None:
                return None
            index = end
            continue
        if char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return None
