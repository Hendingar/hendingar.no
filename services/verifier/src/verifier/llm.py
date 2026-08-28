"""Azure AI Foundry client over the account's OpenAI-compatible surface, with Entra auth.

Same shape as `nnext_core.llm`: talk to `/openai/v1/` with an Entra token, never an API key. The
difference is that this service needs **structured JSON output and vision**, so it holds the raw
`AsyncOpenAI` client rather than wrapping it in an Agent Framework chat client — there is no agent
chaining here, just two well-specified single calls.

Token lifetime is the trap: an Entra token is baked into the client at construction and lives about
an hour. A long-lived process that caches the client wakes up one morning with a stale token, so
build a fresh client per call and reuse the *credential*, which caches and refreshes for us.
"""

import logging

from azure.identity import AzureCliCredential, DefaultAzureCredential, ManagedIdentityCredential
from openai import AsyncOpenAI

from .config import Config

_TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"

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


class LlmClientFactory:
    """Builds a fresh client per call from one long-lived, self-refreshing credential."""

    def __init__(self, config: Config, credential=None) -> None:
        self._config = config
        self._credential = credential or get_credential(
            config.azure_client_id, config.azure_tenant_id
        )

    @property
    def model(self) -> str:
        """The Azure *deployment* name."""
        return self._config.openai_chat_model

    def client(self) -> AsyncOpenAI:
        token = self._credential.get_token(_TOKEN_SCOPE).token
        base_url = self._config.openai_endpoint.rstrip("/") + "/openai/v1/"
        return AsyncOpenAI(
            base_url=base_url,
            api_key=token,
            timeout=self._config.request_timeout_seconds,
            max_retries=2,
        )
