# 0014 — A submission that matches an existing event improves it, filling gaps only

**Status:** accepted (2026-09-07)
**Extends:** [ADR 0012](0012-no-review-queue.md) — the sender is the reviewer

## Context

The duplicate check was a dead end, and it was the wrong kind of dead end: it turned away the
contributions we most want.

A real submission made it visible. Someone photographed a poster for `Rolfsnes Marknaden` off
Facebook and sent it in with the source URL. The verifier's duplicate check scored it against an
event we already had, returned **uncertain** at 70 %, and — because `duplicate` is in
`BLOCKING_CHECKS` and `uncertain` is not a pass — the submission came back `declined`. Note what it
was _not_: the server's own `comparePair` said the two were **not** the same event, so
`duplicate_of_id` was null and the outcome was not even `duplicate`.

The sender was left with two routes:

1. Edit the title until it stopped resembling the existing event — which would publish a second row
   for one event, and is a lie.
2. Let it expire after 48 hours, taking the poster and the Facebook link with it.

What they were holding is exactly what the existing row was missing. Norwegian event calendars
publish thin, and our importers copy what is published rather than inventing what is not:
`importers/mec` files **every** event as `anna` on purpose, roughly half the imported rows carry no
poster at all, and a row from a venue's own programme has exactly one citation — that venue. A
person who walked past the poster and pasted the Facebook event is holding a picture, a second
independent source, and often a description. All of it was being thrown away, politely.

The plain `duplicate` outcome was no better. It kept the submission, and `VerdictPanel` told the
sender it had been "kreditert kjelda under" — a promise the event page could not keep, because
`reportedBy` builds its credit list with an INNER JOIN on `sources` and a human submission has no
source row. Nobody was ever credited, and the photograph was never uploaded: `/ko/[id]/bilete`
requires `submission_outcome = 'approved'`.

## Decision

**A submission the sender confirms is an event we already have becomes a contribution to that
event.** New outcome `contributed`, and a new table `event_contributions` recording it field by
field.

**Gaps only. Nothing existing is ever replaced.** `packages/core/src/contribution.ts` is the rule,
and it is pure and tested. Six fields may be filled — `poster_url`, `source_url`, `cta_url`,
`description`, `ends_at`, `organizer_id` — and only where the canonical row holds nothing. Four are
identity and may never be touched: `title`, `starts_at`, `category`, `venue`. Those are what
`comparePair` compares and what a reader followed a link to find.

**The contribution creates no listing.** It is stored as `rejected` with `duplicate_of_id` pointing
at the canonical row — which is exactly what an imported duplicate looks like — so every listing
query, the day grouping, the search and the iCal feed are untouched. The canonical row simply has
fewer nulls.

**Only plausibility can stop it.** The duplicate check has been answered, by a person, in the
affirmative; normalisation is about a date and a place a contribution does not set. All five checks
still run and all five are still stored, because the reasoning is the product.

**The offer is derived, not stored.** `contributionCandidates` recomputes the near-matches when
asked, from the ±24h window the duplicate shortlist already uses and a title-similarity floor of
0.5 — below `DUPLICATE_TITLE_THRESHOLD`, because this decides what somebody is _asked about_ rather
than what a reader sees. No column, and it works for every submission already sitting in a queue
from before this existed, including the one that prompted it.

**Contributors are credited on the event, as a count and a list of fields — never as a name.** A
`client_id` is a random value a browser keeps in localStorage and is deliberately not an identity;
turning it into a byline would be inventing one.

### Why gap-filling is what makes this safe

A contribution is authorised by `submitter_client_id`, which `schema.ts` is explicit about: "not a
credential and must never gate anything that matters more than this" — where _this_ was somebody's
own unpublished draft. A live listing matters more, so the capability has to be bounded rather than
trusted.

Two things bound it, and the second is the load-bearing one:

- **Gap-filling is monotone.** A field holding something keeps it. The worst outcome is a wrong
  poster on an event that had none — visible on the page, attributed in `event_contributions`, and
  undone by setting one column back to null. An overwrite rule would let the same actor change text
  a reader is relying on, and would need every previous value stored to be reversible at all.
- **It grants strictly less capability than the front door already grants.** Anyone, with no
  account, can already publish a brand-new event carrying any poster and any text. Filling a null
  column on an existing row is a subset of that. If open submission is ever gated, this is gated by
  the same thing.

## Consequences

- **An imported row can now gain a photograph.** This is the largest visible effect: a card that
  rendered a generated tile gets the picture somebody actually took, and
  `poster_rights_verified` is true for it in the only sense that means anything — the photographer
  chose to send it for this purpose, which is a stronger claim than any hotlink.
- **A hotlinked poster is not treated as a gap**, even though a contributor's own photograph is the
  better claim. Swapping it is an overwrite, so it is out of scope here and is the obvious next
  decision to make.
- **Redundant offers are recorded with `applied = false`.** Somebody independently giving us the
  same Facebook link is corroboration — the one signal of that kind nothing else in the system
  writes down — and it is also how we will know whether the feature is working.
- **Contribution and revision compose.** `?rett=<id>&bidra=<canonical>` loads the declined draft,
  consumes it, and stores the contribution in its place, so the queue does not show a refusal
  counting down beside the contribution that replaced it.
- **A contributed poster arrives in a second request**, after the verdict, exactly as an approved
  submission's does — so a contribution that is refused still never has its picture leave the
  browser. The claim is taken in the `UPDATE … WHERE poster_url IS NULL`, so two contributors
  racing on one gap cannot both win, and the loser's blob is deleted rather than orphaned.
- **Comments and multiple attachments are deliberately not here.** A discussion thread runs at the
  README's "not a social network" non-goal and deserves its own decision rather than arriving as
  part of this one.

## How we'd know we were wrong

If contributions are mostly `applied = false`, the offer is being made about rows that already have
everything and the similarity floor is too loose.

If wrong posters or bad links start appearing on real events, the bearer-token argument above is
too generous in practice and a contribution needs to be held rather than applied — which, with no
review queue (ADR 0012), means it needs a reviewer first. That is the same condition under which
ADR 0012 itself is worth reopening.

If people take the offer and then find the event unchanged because a field was already filled, the
gap-only rule is too conservative for the field in question — `description` is the likeliest — and
a "replace a demonstrably weaker value" rule becomes worth its cost in stored previous values.
