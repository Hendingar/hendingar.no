# 0019 — The writing help is watched, not waited for

**Status:** accepted (2026-09-21)
**Amends:** [ADR 0017](0017-written-suggestions.md) — the same decision about what may be offered, delivered differently
**Builds on:** [ADR 0016](0016-agent-framework.md) — the group chat, now run streamed

## Context

ADR 0017 settled what `/improve` may hand over: a description, only when a second agent has
confirmed every claim in it is already in the submission, and **an unapproved draft is thrown
away**. It also said, correctly, that refusal would be the common case and that the UI had to be
built around it.

What it did not settle was how long that answer takes to arrive, and the shape of the wait turned
out to matter as much as the shape of the answer. Four sequential model calls stand between the
button and the verdict — writer, checker, writer, checker — and the ordinary verdict is _no text_.
As a single response that is ten to twenty seconds of a disabled button reading "Skriv og
kontrollerer…", ending in a sentence saying we could not do this safely.

That is the worst wait-to-answer ratio in the product, and it is on the one feature whose whole
argument is that **the reasoning is the product, not a debug log**. The reasoning existed the entire
time. Both agents had spoken, at length, about exactly why the text was being held back. The
service collected all of it, computed a verdict from it, and threw the turns on the floor.

The appeal panel had already answered this question once, in `ko/[id]/appell/+server.ts`: three
jurors, streamed, each shown as it lands, because "nobody should watch a blank screen for the
length of three model round-trips". The writing help is that same problem with one more round-trip
and a worse payoff.

## Decision

**The turns are streamed to the person who asked for them, and the verdict is unchanged.**

- `improve_stream` in `services/verifier` runs the group chat with `stream=True` and yields each
  turn as the panel parses it, then exactly one `suggestion` — always last.
- `POST /improve/stream` writes those as server-sent events. `POST /send-inn/skrivehjelp` in the
  app re-emits them, validated frame by frame against the shared Zod schemas.
- `DescriptionHelp.svelte` renders each turn as it arrives: what the writer wrote, and what the
  fact-checker struck out of it.

Three things are rules rather than presentation, because a rule can decide them:

1. **A turn on screen is a report and never an offer.** The accept button belongs to the final
   suggestion alone. A draft a reader watches go past may be the very one the fact-checker strikes,
   or one the number rule refuses after the checker waved it through — and neither is acceptable
   text, however good it looked for the second it was on screen.
2. **One code path decides.** `improve()` — which `/improve`, the CLI and the evals still use —
   collapses `improve_stream` to its last event rather than reaching the verdict its own way. Two
   routes that decided separately could disagree about one submission, and nobody would find it
   until two people got different text for the same words.
3. **A stream that ends without deciding is a failure**, not an empty answer. The browser says so
   in the same sentence it uses for every other failure here: your text still stands.

### What this amends in ADR 0017

"An unapproved draft is discarded" now reads: discarded **as an offer**, and shown **as a report**.
That is a real change and worth stating plainly, because the first version of this feature was
built on the idea that an unsafe sentence should never reach a reader's eyes at all.

The argument for showing it is that the refusal is otherwise unreadable. "We found claims that are
not in your submission" is an assertion; the draft, beside the line the fact-checker struck out of
it, is evidence — and it is evidence the sender can act on, because the gap it exposes is usually
something they could simply have written down. The risk that somebody copies a struck draft out of
the panel by hand is real and is accepted: it is their own event, they are looking at their own
form, and nothing about it is published without going through the six checks anyway.

## Consequences

**`stream: true` now goes on the wire, for this endpoint only.** Running an orchestration streamed
puts every participant's chat client into streaming mode — `ctx.is_streaming()` in the framework's
`AgentExecutor`, with no per-agent opt-out. ADR 0016 pinned this payload deliberately, so the change
is asserted rather than discovered: `tests/test_improve.py` checks that temperature, seed and the
strict schema are untouched **and** that `stream` is set, and that `/extract` still sends a plain
completion. Determinism is a property of temperature and seed, not of how the bytes arrive.

**`improveText` is gone.** A remote `command` cannot stream, and keeping it as a second way to ask
the same question would have been the disagreement rule 2 exists to prevent. `POST` is what
preserves the property that made it a `command` in the first place: a crawler following a link
cannot spend four model calls.

**`/improve` has no caller in the app any more.** It is still the collapsed contract and still what
`improve()` is tested through, which is worth having — but if a year passes with nothing calling it,
it should go rather than be maintained for its own sake.

**The panel is testable in CI for the first time.** CI has no verifier, so end-to-end coverage of
this feature was previously limited to asserting that it fails politely. Playwright now fulfils the
route with the exact bytes `services/verifier` writes, and the service's own tests assert that shape
from the other side — so the two meet in the middle rather than agreeing with themselves.

**It is still invisible without a verifier** (CLAUDE.md rule 8), and the route says 503 as well as
the button being hidden: a control hidden in a page is not a route nobody can reach.

## How we'd know we were wrong

- Somebody copies a struck draft out of the panel and submits it. The number rule and the six
  checks still stand between that and a published event, but it would mean showing the turns had
  taught people to route around the audit, and the honest response is to stop showing drafts and
  show only what was struck.
- The turns read as noise — four blocks of text nobody reads on the way to the same one-line
  answer. Then this bought a progress bar at the cost of a screenful, and the panel should collapse
  to "the fact-checker is reading it…" and the verdict.
- A framework upgrade changes what a streamed run puts on the wire in a way the pinned assertions
  do not catch, and two people get different drafts of the same submission. That is the failure
  ADR 0016 named, arriving through the door this ADR opened.
