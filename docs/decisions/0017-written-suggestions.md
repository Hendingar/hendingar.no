# 0017 — A suggested description, written by one agent and audited by another

**Status:** accepted (2026-09-15)
**Builds on:** [ADR 0016](0016-agent-framework.md) — the group chat this uses
**Constrained by:** [ADR 0004](0004-deterministic-importers.md) — we index what exists, we do not author it

## Context

Everything a model has done here until now has been **reading**: a poster into fields, a page into
fields, a record into a verdict. Nothing in the repo has written a sentence that then appears on
the site, and the README's non-goals are the reason — we are an index of what other people are
putting on, and an index that embellishes its entries is not one.

The thing that made the question worth reopening is what the submission form actually receives.
People send in real events with three words of description: "film på laurdag". The event is fine,
the checks mostly pass, and what goes on the card tells a reader nothing. The sender is not a
copywriter and did not sign up to be one — they walked past a poster and did us a favour.

The naive fix is one "tidy this up" call, and it is the wrong one in a way that is worth stating
precisely. A model asked to improve three words will produce three sentences, and the extra two
have to come from somewhere: free admission, a family audience, a support act, "the village's
much-loved autumn tradition". All plausible. None submitted. The output is not merely wrong — it is
_more persuasive_ exactly where it has least behind it, on a page a reader uses to decide whether
to leave the house. One prompt cannot fix that, because fluency is what a language model is good at
and grounding is what it is asked to volunteer.

## Decision

**A description may be suggested, never applied, and only when a second agent has confirmed every
claim in it is already in the submission.**

`POST /improve` runs an Agent Framework group chat — `GroupChatBuilder`, the one place in this repo
where agents take turns and see each other's work:

- **Skribenten** drafts from the submission and is told, at length, that it may reorganise and
  rewrite but never add. It also reports `missing`: what a reader would want that the submission
  does not say.
- **Faktasjekkaren** audits the draft claim by claim and objects to anything it cannot trace back
  to the record. It is explicitly told not to object to style — a round spent on grammar is a round
  wasted.

They alternate for at most four turns, stopping as soon as the checker approves.

**An unapproved draft is discarded.** No suggestion is the ordinary outcome, not a failure path.

Three things are rules rather than judgement, because a rule can decide them:

1. no text is offered unless the last review said `approved`;
2. **every number in the draft must already appear in the submission** — compared as numbers, so
   reformatting `2026-09-05` into "5. september" is not an invention while `250 kroner` is;
3. only the description is ever rewritten. Not the title, which is what the event _is_ and what the
   duplicate check matches on; not the date, place or category, which are facts with their own
   fields and their own checks.

**In the browser, nothing is written until the person presses the button that writes it.** The
draft is shown as text to read, beside what the fact-checker struck out of it and what the
submission is still missing. Those last two are shown whether or not a draft survived — "we could
not do this safely, and here is what you could add yourself" is a useful answer.

## Consequences

**The failure mode we care about now degrades to silence.** A draft carrying an invented price is
dropped by the number rule even if the checker waved it through; a checker that never approves
costs the sender nothing but the wait. What survives is text whose every claim was already theirs.

**Refusal is the common case, so the UI is built around it** rather than treating it as an error.
That is the opposite of how a "make this better" button usually works, and it is the point.

**It costs up to four model calls, on a public endpoint, for something optional.** That is the same
exposure `extractFromPhoto` and `extractFromUrl` already have, and it is a `command` for the same
reason: a person has to ask, and a crawler following a link cannot trigger it.

**It is invisible without a verifier** (CLAUDE.md rule 8) — hidden, never shown as a button that
cannot work. CI has no verifier, so `app/e2e/submit.e2e.ts` can only assert that absence; what the
two agents do is tested in `services/verifier/tests/test_improve.py`, where a fake socket can make
a fact-checker object on demand.

**This does not open the door to generated event text generally.** It is scoped to a description
its own author is looking at, before anything is submitted, with a human accept in the middle. An
importer must still never do this (ADR 0004), and nothing here writes to a published row.

## How we'd know we were wrong

- Suggestions get accepted at a high rate and read the same as each other. Then we have replaced
  ten people's voices with one house style, which is a worse index even if every fact is true.
- The fact-checker approves something it should not have, and the number rule does not catch it —
  a fabricated performer, say. That is the failure this design is a bet against; a second one would
  mean the bet was wrong and the feature should go, not that the prompt needs another paragraph.
- Nobody presses the button. Then it is four model calls of machinery for an audience of nobody,
  and the honest response is to delete it.
