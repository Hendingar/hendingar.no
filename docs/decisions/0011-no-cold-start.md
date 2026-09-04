# 0011 — The app keeps one replica warm

**Status:** accepted (2026-09-04)

## Context

`ca-hendingar-dev` ran with `minReplicas: 0`. Container Apps therefore removed the only replica
after a few minutes of no traffic, and the next visitor paid for a container image pull, a Node
boot, a SvelteKit start and a fresh Postgres connection before a single byte came back.

Warm, the site answers in about 150ms. Cold is a different order of magnitude, and it is not paid
by "a user" in the abstract — it is paid by _the first_ one. On a site whose entire job is answering
"what is on tonight", that person almost always arrives from a shared link, once, on a phone, and a
tab that sits blank is indistinguishable from a site that is broken. They do not retry.

Scale-to-zero is the right default for the **verifier**, and that stays at zero: it is called only
when somebody submits a photo, the call already has a generous timeout for exactly this reason, and
[ADR 0008](0008-verification-service.md)'s rule means a slow or absent verifier degrades to
`recommendation: 'review'` rather than to a failure. Nobody is ever staring at a blank screen
waiting for it.

The app is not that. Every visit is the app.

## Decision

**`minReplicas: 1`** on the app, and `maxReplicas` raised from 2 to 3.

Also a **readiness probe** on `/health`, which was missing entirely. Without one, Container Apps
shifts traffic to a new revision as soon as its container is running, which during a deploy can
mean serving from a replica that has not yet reached the database.

Deliberately **not** a liveness probe on the same endpoint. `/health` runs `select 1`, so a database
blip would restart the container — which cannot fix a database, and buys another cold start on top
of the outage.

## Consequences

- **The app becomes a standing cost, like the database already is.** One replica at 0.25 vCPU and
  0.5 GiB, running continuously, is 657,000 vCPU-seconds and 1,314,000 GiB-seconds a month. The
  monthly free grant covers 180,000 and 360,000 of those, so roughly 477,000 vCPU-seconds and
  954,000 GiB-seconds are billable — most of it at the reduced idle rate, because a replica that is
  provisioned and not serving requests is billed as idle.
- **This is a small addition to an existing bill, not a new one.** [ADR 0007](0007-database-hosting.md)
  already accepted a continuously provisioned B1ms Postgres because "the whole point of this
  environment is that it's reachable" and "a site that's down outside office hours isn't a
  deployment". Scaling the app to zero was the same bet in miniature, made by default rather than
  decided, and it loses for the same reason.
- **Deploys no longer show a cold start either.** With one replica always up and readiness gating
  the traffic shift, a new revision warms before it receives anyone.
- **A traffic spike still scales up**, now to three replicas rather than two. The B1ms database is
  the real ceiling, not the app tier.

## How we'd know we were wrong

If the credit draw becomes a problem — the same trigger ADR 0007 names. The cheap lever then is not
going back to zero but shrinking the replica: 0.25 vCPU is already the smallest useful size, so the
next move would be Neon or a bought database, exactly as ADR 0007 anticipates.

If traffic ever justifies it, the better answer than more replicas is caching the listing, which
this codebase does not do at all yet.
