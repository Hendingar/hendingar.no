# 0001 — Fullstack monolith, not frontend + backend

**Status:** accepted (2026-08-21)

## Context

hendingar.no will be built largely with coding agents. The dominant constraint on that kind of
development is not typing speed but **how fast and how unambiguously the codebase tells you that
you are wrong**. Architecture choices should be judged on that.

The obvious alternative was a split: a SvelteKit (or other) frontend against a separate API
service.

## Decision

One repository, one fullstack SvelteKit application, one typecheck, one dev command.

The only separation is `importers/`, which are batch jobs rather than request/response work. They
live in the same repo as workspace packages sharing `packages/core`, not as separate services.

## Consequences

A split frontend/backend introduces an HTTP boundary that TypeScript does not cross. The options
there are all bad for our purposes:

- **Hand-written fetch client** — an untyped seam. This is the single worst case: an agent writes
  confident, plausible, wrong code because nothing fails at authoring time. It fails in production
  instead.
- **OpenAPI/tRPC codegen** — a generated artifact that is correct only until the next edit, and
  stale in exactly the window where someone is working.

A monolith also means one process to start, one command to verify, and no "did you regenerate the
client?" failure mode.

The cost is real: independent scaling and independent deploys are given up. For a low-traffic
community site with scale-to-zero hosting, neither is worth an untyped boundary.

## How we'd know we were wrong

If the importers grow into something that needs its own scaling and deploy cadence, or if a
non-web consumer (mobile app, third-party integration) needs a stable public API, that's a real
reason to extract a service. Build it with a generated, checked-in contract and a CI job that
fails when it drifts — don't hand-write a client.
