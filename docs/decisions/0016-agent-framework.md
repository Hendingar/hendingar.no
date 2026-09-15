# 0016 — The verifier runs on Microsoft Agent Framework

**Status:** accepted (2026-09-15)

## Context

[ADR 0008](0008-verification-service.md) settled that a model is called in exactly one place and
that it authenticates with a managed identity. It did not say what that call is made _with_, and
what grew there was a hand-rolled layer: an Entra token minted per call and baked into an
`AsyncOpenAI` client, JSON schemas hardened for strict mode by a function we wrote, `json.loads` on
the way back, and the sampling policy repeated at four call sites.

None of it was wrong. All of it was ours to maintain, and three things had already started to cost:

- **The token workaround.** A token baked into a client at construction lives about an hour, so the
  client was rebuilt on every call to avoid waking up stale. That is a lifecycle problem solved by
  a comment rather than by the code.
- **Hand-hardened schemas.** Strict mode requires `additionalProperties: false` and every property
  in `required`, on nested objects too, and Pydantic emits neither. `extract._harden` walked the
  schema doing that; `crop.py` and `verify.py` gave up and wrote their schemas out by hand, which
  is a second definition of a shape `packages/core` is supposed to own.
- **Nothing to build a second opinion with.** The appeal panel is three differently-framed jurors
  and a quorum, assembled by hand in the SvelteKit route. Any further multi-agent work — checks
  that fan out, a writer and a reviewer iterating on a draft — meant writing that machinery too.

Microsoft Agent Framework is the supported answer to all three, it is what the rest of the estate
(`nnext-agents`) already uses for Foundry access, and its Azure client speaks the same
OpenAI-compatible `/openai/v1/` surface with the same Entra credential we already hold.

## Decision

`services/verifier` uses Agent Framework as its model layer. Every model call is an `Agent` built
by `llm.AgentFactory`, which is the only thing in the service that knows how to reach Azure.

- **`OpenAIChatCompletionClient`, not the Responses client.** Chat completions keeps the wire
  payload identical to what this service sent before — `temperature`, `seed`,
  `max_completion_tokens`, a strict `json_schema`, and an image as a `data:` URL — so nothing
  measured about extraction or judging had to be re-measured. The Responses API is a later,
  separate decision.
- **`response_format=<Pydantic model>` replaces every hand-written schema.** The OpenAI SDK's own
  converter hardens the schema, nested `$defs` included. `_harden` and two schema dicts are gone.
- **The sampling policy lives on the agent, not the call.** An agent handed to an orchestration is
  run _by_ the orchestration, so options passed to `run()` would not be there.
- **`/verify`'s two model checks are a `ConcurrentBuilder` fan-out.** They were two sequential
  awaits for two independent questions about one record, spending a round-trip of somebody's time
  on the submit button for no better verdict. Both agents now read one rendering of the
  submission, and each is told in its own brief what to weigh.
- **The appeal panel deliberately stays three separate calls.** See below.

## Consequences

**The token workaround is gone.** The framework holds a token provider over the credential and
azure-identity refreshes behind it, so one client is shared rather than rebuilt per call.

**Two things the framework does not do for us**, both found by testing rather than by reading the
documentation, and both now compensated for explicitly:

- _A participant that raises kills the whole workflow._ This is why the appeal panel is not a
  `ConcurrentBuilder`. Rule 8 says a juror that cannot answer votes no; inside an orchestration,
  one rate-limited juror would take the other two votes down with it. The panel stays three calls
  fanned out by `app/src/routes/ko/[id]/appell/+server.ts`, which also keeps each verdict
  streaming to the reader as it lands.
- _`client_kwargs` does not carry a timeout to the underlying client._ The request budget is now an
  explicit `asyncio.wait_for` in `AgentFactory`. It is stricter than the old per-request timeout —
  it bounds the whole call including the SDK's retries rather than each attempt separately — which
  is what every caller already described.

**Group chat is available and unused.** `GroupChatBuilder` is the reason this was worth doing: a
writer and a fact-checker iterating on a submitted description is a real possibility now rather
than a project. It is deliberately not built here. Generating text about somebody else's event is
a product decision, not a refactor, and it needs its own record.

**Tests got stronger rather than weaker.** They build a real framework client over a fake
`AsyncOpenAI`, so instruction assembly, schema generation and response parsing are all under test
and only the socket is gone. What they assert is the payload that would have gone over the wire.

**The dependency is real.** Three packages (`core`, `openai`, `orchestrations`) and their tree,
against roughly 150 lines of our own code deleted. The floor is what the estate already runs.

## How we'd know we were wrong

- A framework upgrade changes the wire payload — the pinned `temperature`/`seed`/strict-schema
  assertions in `tests/test_verify.py` and `tests/test_crop.py` are there to fail loudly if it
  does, rather than to drift quietly into two people getting different drafts of one poster.
- The abstraction starts costing more than it saves: if reaching a plain completion means fighting
  `Agent`, or if a needed Azure feature is unreachable through the client, the honest response is
  to take `AgentFactory` back to `AsyncOpenAI`. It is one file, and the call sites do not know.
- Nothing multi-agent gets built in a year. Then this bought a token provider and a schema
  converter, which is a fair trade but a much smaller one than the argument above claims.
