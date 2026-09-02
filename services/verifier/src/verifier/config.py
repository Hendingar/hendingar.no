"""Environment-only configuration with fail-fast validation.

Mirrors the nnext-agents pattern: in Azure every value comes from the platform; locally a
gitignored `.env` supplies the same names. There is no `.env` in the container, so `load_dotenv()`
is a no-op there.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv(override=False)

_REQUIRED = ("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_CHAT_MODEL")


@dataclass(frozen=True)
class Config:
    """Resolved configuration.

    `openai_endpoint` is the Azure AI Foundry (or Azure OpenAI) *account* endpoint;
    `openai_chat_model` is the Azure **deployment** name, not a catalogue model id.
    """

    openai_endpoint: str
    openai_chat_model: str
    # Pins the user-assigned managed identity when running in Container Apps. Unset locally,
    # where DefaultAzureCredential picks up `az login`.
    azure_client_id: str | None
    # Which Entra tenant to get a token from. Only matters locally, and only for people signed in
    # to more than one: `az login` has a single active tenant, and a token from the wrong one is a
    # 401 that says nothing useful about the cause.
    azure_tenant_id: str | None
    log_level: str
    # Requests that take longer than this are abandoned; the caller degrades rather than hangs.
    request_timeout_seconds: float


def load_config() -> Config:
    missing = [name for name in _REQUIRED if not os.getenv(name)]
    if missing:
        raise SystemExit(
            "Missing required environment variable(s): "
            + ", ".join(missing)
            + ". See services/verifier/.env.example."
        )
    return Config(
        openai_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        openai_chat_model=os.environ["AZURE_OPENAI_CHAT_MODEL"],
        azure_client_id=os.getenv("AZURE_CLIENT_ID"),
        azure_tenant_id=os.getenv("AZURE_TENANT_ID"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "60")),
    )
