# 0008 — Verification runs in a separate service, on Azure with managed identity

**Status:** accepted (2026-08-28)

## Context

ADR 0004 settled that importers never call a model, and that verification happens later, on
already-structured records. It did not say **where** that code runs or **how** it authenticates.

The first implementation put an SDK call directly in the SvelteKit app with an API key in an
environment variable. That is the shape most examples use, and it is wrong here for three reasons:

- **A key is a liability.** It sits in an env var, in CI, in someone's `.env`, in a screenshot. It
  has to be rotated, and nothing tells you when it leaked. This is an open-source repo; the failure
  mode is a fork with a committed key.
- **The rest of our estate does not work that way.** `nnext-agents` authenticates to Azure AI
  Foundry with Entra managed identity and `disableLocalAuth: true` — there is no key to hold. A
  second, weaker pattern in a second repo is a pattern nobody maintains.
- **A model call is not a web-request concern.** Its dependencies (a vision-capable model, an
  Azure credential, a token cache) have nothing to do with rendering pages, and dragging them into
  the app's image and startup path makes both harder to reason about.

## Decision

Verification and poster extraction live in **`services/verifier`**, a small Python FastAPI service.

- It is the **only** place in the repo where a language model is called. `app/` and `importers/`
  hold no model SDK.
- It authenticates with a **user-assigned managed identity** to an Azure OpenAI account created
  with `disableLocalAuth: true` (`infra/ai.bicep`). There is no API key anywhere in the system.
- It runs on Container Apps with **internal-only ingress** (`infra/verifier.bicep`). The web app
  can reach it; the internet cannot. An unauthenticated `/extract` on a public URL would be a free
  vision-model proxy for whoever found it.
- The app's client (`app/src/lib/server/verifier.ts`) **never throws**. If the service is unset,
  slow or broken, the submission is stored and routed to a human. Verification failing must never
  mean submission failing.
- Checks are **deliberately mixed**: normalisation, duplicate shortlisting and corroboration are
  rules; plausibility and categorisation ask a model. Splitting them this way keeps the model to
  the questions that actually need judgement, and keeps most of the pipeline replayable.

`VERIFIER_URL` is optional in `app/src/env.ts`. Unset is a supported state, not a broken one: the
app runs with no AI credentials at all, and the photo shortcut is hidden rather than offered as a
button that cannot work.

## Consequences

- Two languages in one repo. `pnpm verify` cannot see the Python, so CI has a separate `verifier`
  job — meaning "green" now requires reading two job results, not one.
- The five check names exist in TypeScript (`packages/core/src/verification.ts`) and in Python. No
  compiler can enforce that; `services/verifier/tests/test_contract.py` reads the TypeScript file
  and asserts the lists agree, which is the closest available thing.
- A cold start on the first submission after idle, because the service scales to zero. Accepted:
  the alternative is paying for an idle replica on a project with no revenue.
- Local development cannot exercise the model path without an Azure login. That is the honest
  trade for having no keys, and the manual form covers the whole feature without it.

## Alternatives considered

- **Keep it in the app with an API key** — rejected above.
- **Azure Functions instead of Container Apps** — the Container Apps environment already exists,
  and internal ingress gives us private service-to-service networking for free.
- **A queue between the app and the verifier** — the right answer once volume justifies it, and it
  would remove the cold-start wait from the submission path. Not yet: a person is watching the
  page, and a synchronous verdict is a better experience than "we'll email you".
