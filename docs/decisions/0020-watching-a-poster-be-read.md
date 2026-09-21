# 0020 — A poster is watched being read, and `/extract` does not change

**Status:** accepted (2026-09-21)
**Builds on:** [ADR 0019](0019-streamed-writing-help.md) — a streamed turn is a report, never an offer
**Bounded by:** [ADR 0016](0016-agent-framework.md) — the pinned extraction payload, and why it stays pinned

## Context

Reading a photographed poster is the longest single wait on the site: one vision call, five to
fifteen seconds, with somebody watching the button they pressed. The panel in front of it could say
nothing true about what was happening, so it narrated. "Les tittel og dato…" appeared three seconds
in whether or not that had happened; "Finn stad og arrangør…" at seven; a bar crept along
`1 - 0.5^(t/8)`, an elapsed-time curve chosen to slow down and never arrive.

None of that was dishonest by intent — each line was commented as a stage the request genuinely
passes through, and the curve was picked precisely so it could not claim to be finished. But the
component said why it had to work that way, and the reason was wrong:

> _The model gives us one answer at the end and nothing in between — there is no token stream to
> follow for a strict-schema extraction._

There is. A strict-schema answer is emitted like any other completion, a few characters at a time,
**in the order the schema declares its properties**. `title` is finished and correct while
`organizer_name` does not yet exist. The real answer was arriving the whole time and being thrown
away, and a timer was guessing at it.

## Decision

**The fields are shown as the model finishes writing them, and `/extract` is left alone.**

Two halves, and the second matters as much as the first.

### The streamed read

`extract_poster_stream` runs the same agent, prompt and schema over a streaming transport and
yields each top-level field once it is complete, then the validated `ExtractedEvent`.
`POST /extract/stream` writes those as server-sent events; `POST /send-inn/lesing` re-emits them
after renaming the service's `snake_case` to the `camelCase` the rest of that boundary speaks.

`partial.completed_fields` is what makes this safe rather than hopeful. **A value is reported only
once it has been closed** — a string with its final quote, a number with the delimiter after it, a
literal spelled out in full. The obvious implementation is to repair the prefix and `json.loads` it,
and it is wrong in the one way that matters: a truncated string parses perfectly well as a shorter
string, so "Pokémont" would go on screen and be silently corrected a moment later. A test walks
every cut point of a full answer and asserts no prefix ever disagrees with the whole.

Two rules carry over from [ADR 0019](0019-streamed-writing-help.md) unchanged:

1. **A field on screen is a report and never an offer.** Only the validated whole reaches the form,
   and only a person pressing a button puts it there. The review step is what makes reading
   somebody's poster with a model defensible at all, and a panel that populated inputs as tokens
   arrived would have quietly removed it.
2. **A read that dies halfway fills in nothing.** What was already shown stays on screen — "we got
   this far" is worth more to somebody deciding whether to retry than an error alone — but the form
   is untouched and the photograph is still held.

### `/extract` stays a plain completion

This is the deliberate part. `improve` collapsed its blocking route onto the streamed one so the two
could not disagree; extraction does the opposite, and for a reason specific to it.

`evals/run.py` scores `extract_poster` against the live model, and ADR 0016 kept its wire payload
byte-for-byte on the explicit argument that nothing measured about extraction should have to be
re-measured. Flipping it to streamed would move that baseline without anybody running the evals —
and the evals cannot run in CI, so nothing would have failed.

What makes two paths acceptable here is that there is no judgement in either. Extraction transcribes;
the bytes reassemble to the identical object, and a test asserts exactly that rather than assuming
it. A second test asserts `/extract` still sends no `stream` flag, so deleting that assertion is the
thing a future change has to do on purpose — and the ADR says what to do first, which is run the
evals.

### The bar measures something now

Progress is the fraction of expected fields that have arrived, not a curve over elapsed time. It
still never reaches 100, because the last step is the validated object and that lands after the last
field.

## Consequences

**`extractFromPhoto` and the TypeScript `extractPoster` are gone.** A remote `command` cannot
stream, and keeping either as a second way to ask would be the disagreement rule 1 above exists to
prevent. `POST /send-inn/lesing` keeps the property that made it a `command`: a crawler following a
link cannot spend a vision call.

**The panel is testable in CI for the first time.** CI has no verifier, so this path could only ever
be tested for being absent or failing politely. Playwright now fulfils the route with the exact bytes
the service writes, and `tests/test_extract.py` asserts that shape from the other side.

**Playwright fulfils a route atomically**, so the browser specs cannot observe the ordering — the
whole stream lands in one read. "Title first, in schema order" is asserted in the service's tests,
where it is a property of the code rather than of the harness. Worth knowing before somebody writes
a flaky spec trying to catch it in the browser.

**Field order is the model's, not ours.** It follows the schema because constrained decoding follows
the schema, which is a strong habit rather than a guarantee in the API contract. Nothing breaks if it
changes — the fields would simply appear in a different order — so this is a dependency worth naming
and not worth defending against.

## How we'd know we were wrong

- A field appears and then changes. That is the one thing `completed_fields` exists to prevent, and
  a single occurrence means the scanner is wrong rather than that the prompt needs work.
- People start copying values out of the streamed list instead of waiting for the form to fill,
  and get half a draft. Then showing fields has taught them to route around the review step, and
  the honest response is to show progress without values.
- The evals move after some later change and nobody notices because `/extract` was quietly switched
  to the streamed path. The assertion in `tests/test_extract.py` is there to make that a deliberate
  act; if it is ever deleted, this is the record that says run the evals first.
