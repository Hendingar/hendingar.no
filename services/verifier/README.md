# hendingar verifier

Poster extraction and agentic verification for hendingar.no, on **Azure AI Foundry** with Entra
authentication — no API keys. Same pattern as
[`nnext-agents`](https://github.com/…/nnext-agents): the account's OpenAI-compatible
`/openai/v1/` surface, a user-assigned managed identity, and a Container App.

## Why this is a separate service

Two reasons, and the second is the load-bearing one.

1. **The app must run without it.** `VERIFIER_URL` is optional; without it, photo extraction and
   agentic verification are off, the site says so, and the submission form still works. A
   contributor can run the whole of hendingar.no with no AI credentials at all.
2. **Model access is an Azure identity, not a secret.** Entra tokens are minted by a managed
   identity at runtime. Keeping that inside a service with one job — rather than in the web app —
   means the web app never holds a credential that can spend money.

This is also the only place in the repo where a language model runs. `CLAUDE.md` rule 3 bans
models from importer code paths and that still stands: importers must be replayable. Here the
input is a photograph someone chose to take, output is schema-constrained, confidence is recorded,
and anything uncertain is reported to the person who sent it in so they can correct it.

## Endpoints

| Method | Path       | Purpose                                                    |
| ------ | ---------- | ---------------------------------------------------------- |
| `GET`  | `/health`  | Reachability. Deliberately does not call the model         |
| `POST` | `/extract` | Photographed poster → structured draft event               |
| `POST` | `/verify`  | Submitted event → per-check verdicts + recommendation      |
| `POST` | `/crop`    | Image → where to cut a card thumbnail, or nothing          |
| `POST` | `/improve` | Submission → a suggested description, or (usually) nothing |

`/crop` is the small one, and it is small on purpose: an image that reached us with a form somebody
typed in themselves has never been looked at, so there is no crop box beside its fields the way
there is for a read poster. It is asked once, after the event is approved, and answering "I cannot
tell" is a valid outcome — the browser then keeps the whole picture.

## The mix of rules and judgement

Not every check needs a model, and using one where a rule suffices makes a cheap, explainable
check expensive and unpredictable:

| Check          | Decided by | Why                                                             |
| -------------- | ---------- | --------------------------------------------------------------- |
| Normalisation  | **Rule**   | A date either parses and is in a sane range, or it doesn't      |
| Duplicate      | **Rule**   | The database shortlists by time window; token overlap scores it |
| Corroboration  | **Rule**   | A source URL was given or it wasn't                             |
| Plausibility   | Model      | "Is this spam or a real village concert" is genuine judgement   |
| Categorisation | Model      | Same                                                            |

Every check returns its reasoning in Nynorsk, because it is shown to people rather than logged.

`/improve` is the exception to everything above: it is the one endpoint that _writes_ rather than
reads. A writer drafts a description and a fact-checker strikes any claim the submission does not
contain, as a group chat, and an unapproved draft is discarded — so answering "no text, but here is
what you could add yourself" is the ordinary outcome. Two further rules decide without a model: no
number may appear that is not already in the submission, and only the description is ever
rewritten. See [ADR 0017](../../docs/decisions/0017-written-suggestions.md).

**It fails away from publication, never towards it.** No model configured, a content filter, a
timeout — all produce `uncertain`, which means the event does not go out. What happens next is the
sender's: they are told which check could not be completed and can send it again. Nothing waits on
a person here, because there is nobody waiting (ADR 0012).

## Configuration

Environment only, fail-fast. See `.env.example`.

| Variable                  | Required | Notes                                                     |
| ------------------------- | -------- | --------------------------------------------------------- |
| `AZURE_OPENAI_ENDPOINT`   | ✅       | Foundry/OpenAI **account** endpoint                       |
| `AZURE_OPENAI_CHAT_MODEL` | ✅       | The Azure **deployment** name                             |
| `AZURE_CLIENT_ID`         | —        | Pins the user-assigned managed identity in Container Apps |

**The deployment must be vision-capable** — extraction sends an image. `gpt-4.1-mini` works;
`Mistral-Large-3` is text-only and will fail on `/extract` while working fine for `/verify`.

## Running locally

```bash
cd services/verifier
pip install -e ".[dev]"
az login                 # DefaultAzureCredential picks this up
cp .env.example .env     # then fill in the endpoint and deployment
verifier serve           # http://localhost:8080
pytest                   # no Azure, no network
```

## How a model is reached

Through **Microsoft Agent Framework** ([ADR 0016](../../docs/decisions/0016-agent-framework.md)).
`llm.AgentFactory` is the only thing here that knows the endpoint, the credential, the sampling
policy and the request deadline; everything else asks it for an agent and says what it wants read
or judged.

Token lifetime used to be the trap: an Entra token baked into a client at construction lives about
an hour, so the old code rebuilt the client on every call to avoid waking up stale. The framework
holds a token _provider_ over the credential instead, and azure-identity caches and refreshes
behind it — so there is one client, shared.

The two judging checks are asked at the same time through a `ConcurrentBuilder` fan-out. The
appeal panel is not: a participant that raises takes a whole workflow down with it, and a juror
that cannot answer must cost only its own vote (`CLAUDE.md` rule 8). The three seats are asked
separately by the app, which streams each verdict as it lands.
