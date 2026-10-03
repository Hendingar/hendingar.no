# 0022 — /haugen asks TypeSafe's Jev, live, with the one API key in the system

**Status:** accepted (2026-10-03)
**Amends:** [ADR 0008](0008-verification-service.md) — "no API key anywhere" now has one exception, and it lives in the verifier
**Builds on:** [ADR 0017](0017-written-suggestions.md) (a model reachable only by something a person does), [ADR 0018](0018-kurator.md) (no popularity in the payload)

## Context

The listing filters by kind: a category chip, a source, a venue, a word that must appear in the
text. None of that answers how people actually ask about an evening — "noko for ungdom", "ting å
gjere ute", "noko som gjer deg sprek". Those are about who an event is for, where it happens and
what it does to you, and no column holds that.

TypeSafe's **Jev** is a different kind of model from the ones the verifier already runs. It does
not write. It takes a state and a set of typed questions and answers each with a calibrated
probability, in a few hundred milliseconds, at $0.042 per million input tokens with output free.
One yes/no question per event — "is this what they are asking for?" — is exactly its shape.

Measured on 2026-10-03 against 150 real upcoming events: three parallel requests, ~350 ms inside
the model, ~42k input tokens, about a fifth of a cent per question. A nonsense query keeps every
event under 0.15.

## Decision

**`/haugen` shows the next 120 events as a pile of round thumbnails. A question is put to Jev
through the verifier, and the events it answers yes to float up.**

### Where the call happens

- `services/verifier/src/verifier/jev.py` is the only place that holds the key or knows the URL.
  `haugen.py` owns the question. `POST /haugen` is the endpoint, internal like the rest.
- Jev is not an `Agent` and does not go through `llm.AgentFactory`: there is no sampling to pin,
  no schema to enforce and no text to write. The one-door rule is kept by a second door in the
  same building, not by forcing a classifier through a chat client.
- **The key is a Container App secret on the verifier, and nowhere else.** The app never sees it.
  TypeSafe offers no Entra auth, so this is the first credential the system stores rather than
  mints. It is optional: without `TYPESAFE_API_KEY` the endpoint answers 503 and the page falls
  back to text matching. Nothing else changes.

### What can spend money

A GET never does. The pile and a `?q=` in the address bar are `query` functions answered by plain
text matching, so a crawler following a shared link costs nothing. Only the `askPile` `command`
reaches Jev, and a command is a POST that a person causes by typing — the same argument ADR 0017
made for writing help.

Behind the command, in order (`app/src/lib/server/pile-answer.ts`):

1. **A cache** keyed by the question and the exact pile, 15 minutes, 500 entries. The second
   person to ask "konsertar" costs nothing.
2. **A budget** of 60 uncached questions a minute for the whole site. Past it the answer is text
   matching until it refills. There is no per-visitor limit, because that needs a visitor id.
3. **A fallback** to text matching on any failure: no verifier, no key, a timeout (4 s), an error.
   A text answer is never cached, so one cold start does not pin a worse answer for 15 minutes.

### What is sent, and what is not

Per event: title, category label, the time as words ("laurdag kveld"), place, municipality,
organiser and the first 240 characters of the description. **No hearts, no views, no rank** — the
same rule as the kurator, enforced by a test on the wire body.

The question somebody typed goes to TypeSafe, because that is the service. It is not logged by us
— not in the verifier, not in the app, not on failure — not stored, and not sent to analytics. The
README's "no search terms" holds.

### The question is in Nynorsk

Measured as a 2×2 over 150 real events and nine labelled searches — English vs Nynorsk, plain vs
with definitions of the corpus:

| Variant                      | Right above wrong | Right ones float | Tokens/question |
| ---------------------------- | ----------------- | ---------------- | --------------- |
| English                      | 93%               | 25/33            | 36k             |
| **Nynorsk**                  | **99%**           | **31/33**        | 42k             |
| English + corpus definitions | 95%               | 26/33            | 50k             |
| Nynorsk + corpus definitions | 99%               | 31/33            | 61k             |

The search and the events are Nynorsk, and asking in the same language lets Jev compare like with
like: "kino" found all five films instead of two. Definitions cost tokens for nothing. The labelled
set is `services/verifier/evals/haugen/`, and `pnpm verifier:eval:haugen` re-measures it.

### The page shows its working

Each answer carries what happened: the model, how many events it judged, the time inside the
model, on our server and to the browser, the tokens, and whether it came from the cache. The page
prints it under the box and in full below the pile, with a histogram of every score. A pile that
floats things for no visible reason asks to be trusted; this shows the working instead.

## Consequences

- The pile was 150 at first and is 120 (same day): tokens are paid per event asked about, so the
  pile size is the price of a question. 120 is two requests of sixty instead of three.

- One stored secret. `TYPESAFE_API_KEY` is a GitHub secret passed to `infra/verifier.bicep`, which
  creates the Container App secret only when it is non-empty.
- The verifier scales to zero, so the first question after a quiet night may meet a cold start and
  get the text answer. The next keystroke gets Jev.
- Thresholds — 0.5 to float, 0.35 to dim — are the app's (`app/src/lib/haugen.ts`), so they can
  move without a verifier deploy. The eval reads the same two numbers.
- Known weak spots, recorded so they are not rediscovered: "noko for ungdom" floats children's
  events too, and a babysong in a church reads as a concert when the category is missing.

## How we would know we were wrong

- The eval's "right above wrong" falls under 95%, or people's searches stop matching what floats —
  the question needs work, or Jev is the wrong tool for it.
- The budget is hit on ordinary evenings, not by scripts — the cap is too low, or the cache key is
  too narrow.
- TypeSafe changes terms, pricing or availability in a way that makes a stored third-party key a
  worse trade than it is today. The fallback means turning it off is one deleted secret.

## Not decided here

Whether the pile should cap how many answers float, and whether "ungdom" needs a narrower question.
Both are tuning, against the eval, not architecture.
