# 0015 — The covered area is three municipalities, and it is a check

**Status:** accepted (2026-09-08)
**Amends:** [ADR 0006](0006-agentic-verification.md) — a sixth check, and the second one that can
`fail` outright

## Context

On 8 September 2026 somebody submitted a concert: The Watch playing Genesis in **Grieghallen,
Bergen**. It was published immediately, and the receipt shows why — every check answered correctly:

| check          | verdict   | confidence |                                                                           |
| -------------- | --------- | ---------- | ------------------------------------------------------------------------- |
| Normalisation  | pass      | 100 %      | the date parses and is in the future                                      |
| Duplicate      | pass      | 95 %       | we did not already have it                                                |
| Plausibility   | pass      | 90 %       | "a genuine concert … in Grieghallen, Bergen"                              |
| Categorisation | pass      | 90 %       | `musikk` fits a concert                                                   |
| Corroboration  | uncertain | 60 %       | no source URL, which does not block ([ADR 0012](0012-no-review-queue.md)) |

Nothing was broken. **No check asked where the event was.** "Bergen" travelled through the whole
pipeline as a string nothing compared to anything — the plausibility check even printed it, and
counted it in the event's favour, because a named concert hall is exactly what a real event has.

This is not a small miss. A local calendar that publishes an event 90km away is a different
product: the promise on the front page is what is happening _here_, and one Bergen listing makes
every other listing a thing the reader has to check.

The area was also never written down anywhere a machine could read. The README said "Pilot region:
Norway — Bergen, Haugalandet, Sunnhordland", which was aspiration; no source collects Bergen, no
check enforced anything, and the sentence told a submitter their event was welcome when it was not.

## Decision

**The covered area is Stord, Bømlo and Fitjar**, and it lives in
[`packages/core/src/coverage.ts`](../../packages/core/src/coverage.ts) — the municipalities, the
village and postal-town names inside them, and a pure `classifyCoverage`. Adding a municipality is
an edit to that list; the copy, the check and the question the UI prints all read from it.

**Coverage is a sixth verification check, and it is a rule.** Which municipality a place is in is a
fact, not a judgement. A model asked "is Grieghallen in Stord" would usually be right, cost a call,
and be occasionally and unpredictably wrong about the one thing this product is — the same argument
that keeps `duplicate` deterministic.

**It has three outcomes, and the middle one is the point:**

| what we were told                        | verdict     | recommendation |
| ---------------------------------------- | ----------- | -------------- |
| a covered municipality, village or venue | `pass`      | publishes      |
| a different municipality                 | `fail`      | `reject`       |
| nothing, or a county / a country         | `uncertain` | `review`       |

The third row is what keeps the kommune field safely optional. Most senders leave it empty — a
poster photographed off a noticeboard rarely states its own municipality — and their events are
local anyway. Reading an empty field as "somewhere else" would refuse the ordinary case to catch
the rare one. So an event we cannot place goes back to the person who _can_ place it, in `/kø`,
with the area named. `Sunnhordland`, `Vestland` and `Noreg` are in that row too: Stord is in
Vestland, so "Vestland" is not evidence of anything but zoom level.

**Matching is per token, folded.** `'stordal'.includes('stord')` is true, and Stordal is 400km
north — a substring search would publish it. Folded (`ø→o`, `å→a`, `æ→ae`) because `Bomlo` and
`Sagvag` are what people type on a phone that gave up.

**A covered name anywhere means inside; only the kommune field can mean outside.** Free text is
good evidence a place is ours and poor evidence that it is not: an "outside" read off a venue name
would refuse a Stord event held at "Bergen Bar", and there is one of those in most towns in Norway.

**Coverage is not appealable.** The appeal panel ([ADR 0012](0012-no-review-queue.md)) is three
models weighing whether somebody is telling the truth about an event in their town, and it can
publish. That is the right instrument for "is this spam" and the wrong one for "is this in Bømlo",
which has an answer. `app/src/routes/ko/[id]/appell/+server.ts` refuses an `outside` event before
any juror is asked. An event whose kommune was merely left blank still has something to appeal.

## Consequences

- A sixth value in the `verification_check` enum — additive, so
  [ADR 0010](0010-expand-contract-migrations.md) is satisfied (`0021_supreme_vargas.sql`).
- The list exists twice: TypeScript for the app, Python for the verifier, which cannot import it.
  Asserted against each other in `services/verifier/tests/test_contract.py`, the same arrangement
  as the check names — drift here would mean the check refuses an event the appeal route would
  publish, silently.
- **This check can refuse an event whose sender did nothing wrong.** Every other blocking check
  fires on something a submission got wrong; an event in Bergen is a real, well-formed, correctly
  categorised event. So its reasoning and its `/kø` hint both name the covered municipalities
  rather than only saying no.
- Imported events are **not** filtered by it. The importers are per-source and their sources are
  local; the row that got through was a human submission, and adding a filter to fifteen importers
  to solve a problem none of them has would be speculative. See "how we'd know" below.
- The README's pilot-region sentence is now the covered list rather than an ambition, because it is
  read by people deciding whether to submit.

## Alternatives considered

**Fold it into `normalisation`.** It already reads `municipality`, and no migration would be
needed. Rejected: a Bergen concert is perfectly well-formed, so the verdict panel would say
"Normalisering: Stoppa" and the sender would go and check their date format. The checks are shown
to people in their own words; a check that reports the wrong reason is worse than no check.

**Ask the model.** One line in the plausibility prompt. Rejected: it is the load-bearing question
for the whole product, and it would be answered by the same call that already said "a genuine
concert in Grieghallen, Bergen" and passed it at 90 %.

**Require the kommune field.** Tempting, and it makes the check a lookup. Rejected for now: the
photo path fills the form from a poster, and posters mostly do not state their municipality, so
this would put a mandatory empty box in front of the sender who is doing the most useful thing.
The `uncertain` branch gets the same safety without the wall — reconsider if senders routinely
ignore the hint and their events sit in `/kø` until they expire.

**A geocoder.** Already tried and recorded, for addresses rather than coverage: Kartverket's
place-name register matched five of sixteen real Sunnhordland venues correctly and four _wrongly_ —
"Øklandstunet" resolved to a lake — and did not contain Stord kulturhus at all. See
`packages/core/src/address.ts`. A wrong municipality is a rejected local event.

## How we'd know we were wrong

- Submissions from Stord, Bømlo or Fitjar sitting in `/kø` on a `coverage` verdict and expiring
  unrevised — the rule refusing the events it exists to protect. The place list is the first thing
  to grow; it is deliberately not a gazetteer.
- `coverage` becoming the commonest reason anything is declined. That would mean people outside the
  area are the main audience of the submission form, which is a fact about who found us, not a
  reason to publish their events.
- An imported source starting to carry events outside the area — then the filter belongs in the
  importers too, and this record is where to say so.
