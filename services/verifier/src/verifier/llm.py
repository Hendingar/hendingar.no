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

from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from openai import AsyncOpenAI

from .config import Config

_TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"

log = logging.getLogger(__name__)


def get_credential(client_id: str | None = None):
    """Pin the user-assigned managed identity in Azure; fall back to `az login` locally."""
    if client_id:
        return ManagedIdentityCredential(client_id=client_id)
    return DefaultAzureCredential()


class LlmClientFactory:
    """Builds a fresh client per call from one long-lived, self-refreshing credential."""

    def __init__(self, config: Config, credential=None) -> None:
        self._config = config
        self._credential = credential or get_credential(config.azure_client_id)

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
