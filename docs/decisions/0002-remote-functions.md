# 0002 — SvelteKit remote functions for all client↔server calls

**Status:** accepted, with known risk (2026-08-21)

## Context

Given a fullstack monolith (0001), the client↔server boundary is still the highest-risk seam in
the codebase. Conventional SvelteKit form actions receive `FormData`: untyped, stringly-typed, and
validated by hand. That is precisely the shape of code an agent gets subtly wrong — the types say
nothing, so nothing fails until runtime.

SvelteKit remote functions (`query`, `form`, `command`, `prerender` in `*.remote.ts`) close that
seam. The argument crosses an HTTP boundary, so SvelteKit requires a Standard Schema validator
(we use Zod) — and in exchange the client call site is fully typed with zero hand-written types.
**The validator is the wire type.** There is one artifact, so it cannot drift.

## Decision

All client↔server communication goes through remote functions. No hand-written `fetch` to our own
endpoints. `+server.ts` is reserved for genuinely external consumers (webhooks, RSS/iCal output).

Enabled in `app/vite.config.ts`. Note there is **no `svelte.config.js`** — this scaffold is on
SvelteKit `3.0.0-next`, where configuration moved into the `sveltekit()` Vite plugin:

```ts
sveltekit({
	compilerOptions: { experimental: { async: true } },
	experimental: { remoteFunctions: true }
});
```

## Consequences

Remote functions have been available since SvelteKit 2.27 and are maturing steadily, but as of
August 2026 they remain **behind an experimental flag** and the API may change.

We accept that because: this is a greenfield app with no users to break, and the alternative means
permanently keeping the worst seam in the codebase untyped. The flag is a known, bounded,
reversible risk; an untyped boundary is an unbounded one.

Secondary cost: less training data than conventional load/actions, so agents may reach for the old
patterns by reflex. Mitigated by this ADR, the rule in `CLAUDE.md`, and the Svelte MCP server
serving current docs.

## Exit path

If the API churns disruptively, migration is mechanical rather than architectural — remote
functions are `+server.ts`-equivalent underneath:

- each `query` collapses to a `load` function in `+page.server.ts`
- each `form` collapses to a form action
- **the Zod schemas are reused unchanged** — they were always the source of truth

Budget roughly a day. Do not pre-emptively avoid remote functions to dodge this; the type safety
in the meantime is worth more than the migration costs.

## How we'd know we were wrong

Two triggers. First, if `svelte-check` produces noisy or spurious errors around async templates
badly enough to muddy `pnpm verify` — the verify signal is the thing we are protecting, and
anything that degrades it loses to it. Second, if a breaking change lands that we cannot absorb in
a day.
