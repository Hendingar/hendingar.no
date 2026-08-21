# 0004 — Importers are deterministic; no LLMs in the import path

**Status:** accepted (2026-08-21)

## Context

hendingar.no imports events from local calendars, and separately uses agentic verification on
submitted and imported events. It would be easy — and wrong — to let those blur together and use a
language model to "just read the page and extract the events".

## Decision

Importers are strictly `fetch → parse → validate → upsert`. Same input, same output, every time.
No model calls anywhere in `importers/`.

Language models operate at a **different** point in the pipeline: verifying already-structured
event records (deduplication, plausibility, categorisation, corroboration), where output is
constrained, confidence is scored, and anything uncertain goes to a human queue.

## Consequences

- Importer bugs are reproducible, so they are debuggable. A non-deterministic importer produces
  bug reports nobody can act on.
- Tests run against committed fixtures with no network, so CI is fast and honest.
- **Hallucinated event data is worse than missing event data.** A user who drives to a concert that
  was never scheduled does not forgive the platform, and the whole premise of this project is being
  more trustworthy than the scattered sources it aggregates.
- Cost stays near zero and scales with sources, not with traffic.
- Real cost accepted: sites without an API or feed need real parsing work, and break when markup
  changes. Mitigated by preferring JSON APIs (see `docs/event-sources.md`) and by validating every
  response against a schema so a site change fails loudly rather than importing garbage.

## How we'd know we were wrong

If a source is genuinely valuable and genuinely unparseable, the answer is still not a model in the
import path — it's a model in a **separate, offline, human-reviewed** extraction step that emits a
fixture a deterministic importer then consumes. The determinism boundary moves; it doesn't
disappear.
