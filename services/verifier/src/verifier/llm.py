"""Azure AI Foundry through Microsoft Agent Framework, with Entra auth.

Every model call this service makes is an `Agent` built here, so one file knows the endpoint, the
credential, the sampling policy and the deadline. A call site says what it wants read or judged;
it does not say how to reach a model.

`OpenAIChatCompletionClient` talks to `/openai/v1/` — the account's OpenAI-compatible surface —
and builds that URL from `azure_endpoint` itself. Chat completions rather than the newer Responses
client on purpose: the wire payload stays byte-for-byte what this service sent before the
framework arrived (`temperature`, `seed`, `max_completion_tokens`, a strict `json_schema`, and an
image as a `data:` URL), so nothing measured about extraction or judging had to be re-measured.

Token lifetime used to be the trap here: an Entra token was baked into an `AsyncOpenAI` client at
construction and lived about an hour, so a long-lived process that cached the client woke up one
morning with a stale one. That is why the old code rebuilt a client per call. It no longer has to:
the framework holds a *token provider* over the credential, and azure-identity caches and refreshes
behind it. One client, shared across concurrent calls on this event loop, which is what the client
documents as safe.
"""

import asyncio
import logging
from typing import TYPE_CHECKING

from agent_framework import Agent, AgentResponse
from agent_framework.openai import OpenAIChatCompletionClient
from azure.identity import AzureCliCredential, DefaultAzureCredential, ManagedIdentityCredential
from pydantic import BaseModel

from .config import Config

if TYPE_CHECKING:
    from agent_framework import Message

# Sampling policy, applied to every call this service makes.
#
# Both of our uses are transcription or adjudication, not writing: reading an event out of an image
# and judging whether a record is plausible. Neither benefits from variety, and both are stored and
# shown to people — a verdict that flips between identical runs is not a verdict. So sampling is
# pinned off. The seed value is arbitrary; that it does not change is the point.
TEMPERATURE = 0.0
SEED = 20260828

log = logging.getLogger(__name__)


def get_credential(client_id: str | None = None, tenant_id: str | None = None):
    """Pin the user-assigned managed identity in Azure; fall back to `az login` locally.

    `tenant_id` exists for local development only. `az login` has one active tenant, and anyone
    signed in to several will otherwise get a token for whichever subscription happens to be
    selected — which fails as a bare 401 with no hint that the tenant is the problem. Naming the
    tenant makes it work regardless of which subscription is active in the CLI.
    """
    if client_id:
        return ManagedIdentityCredential(client_id=client_id)
    if tenant_id:
        return AzureCliCredential(tenant_id=tenant_id)
    return DefaultAzureCredential()


class AgentFactory:
    """Builds the agents, and is the only thing that knows how to reach a model.

    `chat_client` is the test seam. Tests pass an `OpenAIChatCompletionClient` wrapped around a
    fake `AsyncOpenAI`, which means they exercise the real framework stack — prompt assembly,
    strict-schema generation, response parsing — while asserting on the exact payload that would
    have gone over the wire. Nothing reaches Azure and nothing is mocked that we rely on.
    """

    def __init__(self, config: Config, chat_client: OpenAIChatCompletionClient | None = None):
        self._config = config
        self._client = chat_client or OpenAIChatCompletionClient(
            model=config.openai_chat_model,
            azure_endpoint=config.openai_endpoint,
            credential=get_credential(config.azure_client_id, config.azure_tenant_id),
        )

    @property
    def model(self) -> str:
        """The Azure *deployment* name."""
        return self._config.openai_chat_model

    def agent(
        self,
        *,
        name: str,
        instructions: str,
        response_format: type[BaseModel],
        max_tokens: int,
    ) -> Agent:
        """One agent: a name, a brief, and the shape of the answer it must return.

        The sampling policy goes on the agent rather than on the call, because an agent handed to
        an orchestration is run by the orchestration and never by us — options passed to `run()`
        would simply not be there. Set here, they hold either way.
        """
        return Agent(
            self._client,
            instructions,
            name=name,
            default_options={
                "response_format": response_format,
                "temperature": TEMPERATURE,
                "seed": SEED,
                "max_tokens": max_tokens,
            },
        )

    async def run(self, agent: Agent, message: "str | Message") -> AgentResponse:
        """Run one agent under the configured deadline.

        The deadline is enforced here rather than on the HTTP client because the framework builds
        that client itself and passes no timeout through to it. `wait_for` is a stricter budget
        than the old per-request timeout — it bounds the whole call including the SDK's retries,
        rather than each attempt separately — which is the behaviour the callers already describe:
        a request that takes too long is abandoned, and the caller degrades rather than hangs.
        """
        return await asyncio.wait_for(
            agent.run(message), timeout=self._config.request_timeout_seconds
        )

    async def run_workflow(self, workflow, task: str):
        """Same deadline, for an orchestration that runs several agents for us."""
        return await asyncio.wait_for(
            workflow.run(task), timeout=self._config.request_timeout_seconds
        )
