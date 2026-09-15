# 0018 — A kurator picks three events a weekend, and the app is what calls it

**Status:** accepted (2026-09-15)
**Builds on:** [ADR 0016](0016-agent-framework.md) (the group chat), [ADR 0017](0017-written-suggestions.md) (a second agent audits the first)
**Bounded by:** [ADR 0008](0008-verification-service.md) — the verifier is the only place a model runs, and it is not on the internet

## Context

The listing answers "what is on". It answers it well and in several orderings: soonest first,
by day, by category, by weekend, and — on `/poppis` — by what people are hearting and opening. Every
one of those is arithmetic over something countable.

None of them answers the question people actually ask each other on a Thursday: **is anything worth
going out for this weekend?** That is a judgement, and the site has never made one. The nearest
thing is `/poppis`, which is a different question wearing similar clothes — what others are looking
at is evidence about a listing's readers, not about an evening.

Two things make this worth doing with a model rather than by hand. A weekend in three
municipalities is five to forty events, which is too many to read and too few to rank statistically.
And nobody is going to hand-curate it every week; a feature that depends on somebody remembering is
a feature that works for a month.

## Decision

**A kurator chooses up to three of the weekend's events, states why in one sentence each, and the
picks are stored for the day.** `services/verifier/src/verifier/kurator.py`.

It is a group chat, and the second seat is the point:

- **Kuratoren** makes the call and is told to have an opinion — pick broadly, pick the small thing,
  pick what is legible as an actual event rather than a standing offer.
- **Motlesaren** has no opinion about the taste and one job: every claim in a reason must appear in
  that event's own record. It objects to invented prices, audiences, line-ups, and to status words
  — "populær", "årviss", "utseld" — that sound like facts.

Two model calls a night, total. An objected pick is dropped, not rewritten.

### Popularity is not an input, structurally

`CuratorCandidate` has no heart count, no view count, no field for one, and a contract test asserts
it never gains one. This repo has written the same rule down four times — `EventGrid.svelte`,
`EventTile.svelte`, `schema.ts` on hearts, the `/poppis` lede — and the way to make it true rather
than aspirational is for the numbers to be unable to reach the model. `/poppis` keeps answering
"what are people looking at", honestly and separately.

### Three rules that are rules

A model decides taste. Code decides the rest: a pick must be an event that was actually offered
(the one hallucination that would put a stranger's event on our own page), an event cannot be
picked twice, and **at most one pick per category** — three concerts is a genre, not a selection,
and asking for breadth in a prompt is not the same as getting it. Nothing is back-filled to reach
three: a replacement chosen by a rule is not a judgement.

### The app makes the call, and the workflow asks the app

The verifier has internal-only ingress (`infra/verifier.bicep`, `external: false`) because an
unauthenticated `/extract` on a public URL would be a free vision-model proxy for whoever found it.
The nightly job is a GitHub runner that reaches Postgres through a firewall rule it opens and closes
around itself; it has no route into the Container Apps environment. Something inside that
environment has to place the call, and the app already is that something.

So the app exposes `POST /api/kurator` and the nightly workflow curls it, as its last step — after
`consolidate`, or the kurator could offer two rows that are one event reported by two sources.

**Why that endpoint can be open.** It takes no input and is idempotent per day: a second POST finds
the stored rows and returns them without asking a model anything. The ceiling is one curation a
night regardless of who finds the URL. And because the selection depends on the date rather than on
the caller, a stranger who triggers it gets the picks the cron would have produced anyway, only
earlier — there is nothing to steal and nothing to steer. That is a different animal from the proxy
ADR 0008 refused.

## Consequences

**The picks are stored, not computed.** A page that curated itself per request would cost a model
call per visitor and, worse, could show two readers two different selections of one weekend.
Somebody sending a friend "look what the kurator picked" has to find the same three events there.

**Empty is ordinary.** No verifier, fewer than four events, nothing the kurator would stand behind,
or tonight's run has not happened yet — all render the weekend listing exactly as before. The
section is an addition and never a replacement, so a reader who disagrees with all three picks has
lost a scroll.

**A pick can outlive its event.** An event unpublished after being picked is filtered on read
rather than deleted: the row is a true record of what was chosen from what was shown, and a weekend
can honestly end up with two picks on screen.

**It is one voice.** Ten weekends curated by one model in one house style is a real risk, and the
one this decision is least sure about. It is why every pick carries reasoning a reader can argue
with, and why there is no score anywhere.

## How we'd know we were wrong

- The picks read the same every week — the same adjectives, the same kind of event. Then it is a
  template, not a judgement, and a template does not need two model calls.
- A reason survives both passes carrying something nobody submitted. That is Motlesaren's whole
  job; a second occurrence means the audit does not work at this altitude.
- The section changes what people open in a way that empties the rest of the listing. Then we have
  built a recommender with a taste, which is a bigger thing than this argued for, and it should be
  argued for separately or removed.
- Nobody notices it. Then it is two model calls a night for decoration, and deleting it costs one
  migration and a component.
