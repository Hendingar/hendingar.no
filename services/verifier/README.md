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

| Method | Path       | Purpose                                               |
| ------ | ---------- | ----------------------------------------------------- |
| `GET`  | `/health`  | Reachability. Deliberately does not call the model    |
| `POST` | `/extract` | Photographed poster → structured draft event          |
| `POST` | `/verify`  | Submitted event → per-check verdicts + recommendation |

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

## Token lifetime

An Entra token is baked into the OpenAI client at construction and lives about an hour. A
long-lived process that caches the client wakes up one morning with a stale token — so the client
is rebuilt per call and the _credential_ is reused, since it caches and refreshes.
