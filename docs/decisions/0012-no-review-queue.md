# 0012 — There is no review queue; submissions are decided on arrival and expire in 48 hours

**Status:** accepted (2026-09-04)
**Supersedes:** the human-review half of [ADR 0008](0008-verification-service.md)

## Context

[ADR 0008](0008-verification-service.md) designed the verifier to "fail towards a human": anything
the checks could not settle became `review`, and the event waited in a queue for a person.

Nobody was ever in that queue. The project has one maintainer and no moderators, so `review` was
not a slower yes — it was a **no that nobody was told about**, and the submission sat in the
database indefinitely with nothing to distinguish it from spam we had rejected on purpose.

Two things made it visible. A real submission — a fishing festival, photographed off a
noticeboard — passed four checks at 90–100 % and was held back because it had no source URL, which
is a thing a photographed poster can never have. And the copy around it said "eit menneske ser på
henne først" on four different pages, which was a promise the software could not keep.

## Decision

**Every submission is decided when it arrives**, with one of four outcomes:

| outcome     | meaning                                          | status      |
| ----------- | ------------------------------------------------ | ----------- |
| `approved`  | all blocking checks passed                       | `published` |
| `duplicate` | we already have it; `duplicate_of_id` says which | `rejected`  |
| `shady`     | failed plausibility — spam, an advert, nonsense  | `rejected`  |
| `declined`  | real-looking, but a check it must pass did not   | `rejected`  |

**The sender is the reviewer.** `/kø` shows them their own submissions, which check stopped each
one, in that check's own words, and what would fix it. They correct it and send it again; the row
is replaced rather than added to, so a second attempt is not flagged as a duplicate of the first.

**An unapproved submission is deleted after 48 hours**, measured from the last time it changed —
so revising one starts the clock over. The number lives in
[`@hendingar/core/submissions`](../../packages/core/src/submissions.ts) and is read by both the
reader-facing filter and the sweep that does the deleting, so the copy and the behaviour cannot
drift.

**Corroboration can no longer block.** It asks whether an event can be confirmed _somewhere else_,
and for a photographed poster the honest answer is no — the poster is the source. That absence is
not doubt about the event, and it is reported without deciding anything.

## Consequences

- **Nothing waits on a person, so nothing rots.** The failure mode this replaces was silent; the
  one it introduces is loud, because the sender is told immediately and holds the only route
  forward.
- **We delete other people's drafts.** That is a real loss and worth naming: somebody who sends
  something in on a Friday and comes back on Monday finds it gone. The alternative is keeping an
  indefinite archive of abandoned drafts and rejected spam, which is worse — for them and for us.
  The window is stated everywhere the outcome is.
- **A wrong `shady` has a two-day appeal window and no appeal mechanism.** The sender can revise
  and resubmit, which is enough for a mistyped field and not enough for a judgement call about
  whether their event is real. This is the sharpest edge of the decision.
- **`pending` still exists** in the status enum, for imported events from sources not marked
  trusted. It no longer means "a person will look at this".
- **`/kø` is per-browser and needs no account**, scoped by the same opaque id the hearts use. That
  id is a bearer token for revising an unpublished row — see the column comment in `schema.ts`.

## How we'd know we were wrong

If people routinely send the same event three or four times without getting it out, the checks are
too strict and the queue is not the problem the refinement loop assumed. If `shady` starts catching
real local events, the two-day window becomes a way of losing them quietly, and an appeal path — a
sender arguing their case, judged on its merits — is the answer rather than a longer timer.

If a moderator ever does exist, this decision is worth reopening: a queue with somebody in it is a
different thing from a queue with nobody in it.
