"""Reading a half-arrived JSON object.

The property under test is not "does it parse" but **does it ever report a value that later
changes**. A truncated string parses perfectly well as a shorter string, so the obvious
implementation — repair the prefix and `json.loads` it — would put "Pokémont" in front of somebody
and silently correct it to "Pokémontreff i biblioteket" a moment later. Every test here is an
answer to that.
"""

import json

from verifier.partial import completed_fields

WHOLE = {
    "title": "Pokémontreff i biblioteket",
    "description": 'Eit tilbod i samarbeid med Bømlo TCG. "Alle" er velkomne.',
    "category": "anna",
    "date": "2026-09-21",
    "start_time": "16:00",
    "end_time": None,
    "recurrence": {"freq": "weekly", "interval": 1, "weekdays": [1], "nth": None, "until": None},
    "dates": [],
    "venue_name": "Bømlo folkebibliotek",
    "confidence": 92,
    "unreadable": [],
    "note": "Lese frå skjermbiletet.",
}
TEXT = json.dumps(WHOLE, ensure_ascii=False)


class TestItNeverReportsSomethingThatChanges:
    def test_no_prefix_ever_disagrees_with_the_whole(self):
        """The one that matters, over every cut point there is.

        Whatever a prefix reports must equal what the finished object says. A value that appeared
        and then changed is the bug this module exists to not have, and a loop over every length is
        the only honest way to assert it does not.
        """
        for cut in range(len(TEXT) + 1):
            for key, value in completed_fields(TEXT[:cut]).items():
                assert key in WHOLE, f"invented {key!r} at cut {cut}"
                assert value == WHOLE[key], f"{key!r} was {value!r} at cut {cut}"

    def test_fields_only_ever_accumulate(self):
        """A field that appeared must never disappear again as more arrives."""
        seen: set[str] = set()
        for cut in range(len(TEXT) + 1):
            now = set(completed_fields(TEXT[:cut]))
            assert seen <= now, f"lost {seen - now} at cut {cut}"
            seen = now

    def test_the_whole_object_reports_every_key(self):
        assert completed_fields(TEXT) == WHOLE


class TestWhereAValueEnds:
    def test_an_unfinished_string_is_not_reported(self):
        assert completed_fields('{"title": "Pokémont') == {}

    def test_a_string_is_reported_the_moment_it_closes(self):
        assert completed_fields('{"title": "Pokémontreff",') == {"title": "Pokémontreff"}

    def test_a_number_waits_for_the_delimiter(self):
        """`16` may still become `160`, so a number with nothing after it is not finished."""
        assert completed_fields('{"confidence": 9') == {}
        assert completed_fields('{"confidence": 92') == {}
        assert completed_fields('{"confidence": 92,') == {"confidence": 92}
        assert completed_fields('{"confidence": 92}') == {"confidence": 92}

    def test_a_literal_waits_until_it_is_spelled_out(self):
        assert completed_fields('{"end_time": nul') == {}
        assert completed_fields('{"end_time": null,') == {"end_time": None}

    def test_a_quote_inside_a_string_does_not_close_it(self):
        text = '{"description": "Han sa \\"hei\\" til alle", "category": "anna"}'
        assert completed_fields(text)["description"] == 'Han sa "hei" til alle'

    def test_a_trailing_backslash_is_a_character_and_not_an_escape(self):
        """`"\\\\"` is a complete one-character string. Reading it as open would stall the scan."""
        assert completed_fields('{"note": "\\\\", "category": "anna"}') == {
            "note": "\\",
            "category": "anna",
        }

    def test_a_brace_inside_a_string_does_not_close_the_object(self):
        assert completed_fields('{"note": "ope {24}", "category": "anna"}')["note"] == "ope {24}"


class TestNestedValues:
    def test_an_unclosed_structure_stops_the_scan_rather_than_reporting_half_of_it(self):
        text = '{"title": "Kino", "recurrence": {"freq": "weekly"'
        assert completed_fields(text) == {"title": "Kino"}

    def test_a_closed_structure_is_reported_whole_and_the_scan_continues_past_it(self):
        text = '{"recurrence": {"freq": "weekly"}, "venue_name": "Huset",'
        assert completed_fields(text) == {
            "recurrence": {"freq": "weekly"},
            "venue_name": "Huset",
        }


class TestThingsThatAreNotAnObject:
    def test_an_empty_prefix_is_no_fields_rather_than_an_error(self):
        assert completed_fields("") == {}

    def test_leading_whitespace_is_fine(self):
        assert completed_fields('  \n {"category": "anna"}') == {"category": "anna"}

    def test_prose_instead_of_json_is_no_fields_rather_than_an_error(self):
        """Close to unreachable behind a strict schema, and the cost of being wrong is a spinner."""
        assert completed_fields("Beklagar, eg kan ikkje lese dette biletet.") == {}

    def test_an_empty_object_is_no_fields(self):
        assert completed_fields("{}") == {}
