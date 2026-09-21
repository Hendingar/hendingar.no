"""A model that never leaves the machine.

Every test here builds a *real* Agent Framework chat client over a fake `AsyncOpenAI`. That keeps
the whole stack under test — instruction assembly, strict-schema generation from a Pydantic model,
response parsing — while what gets asserted is the request that would have gone over the wire. A
stub at the `Agent` level would test our call sites against a mock of the thing most likely to
change; this tests them against the thing itself, with only the socket removed.

`FakeOpenAI.calls` holds the keyword arguments of each `chat.completions.create`, in order.
"""

from __future__ import annotations

from typing import Any

from agent_framework.openai import OpenAIChatCompletionClient
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from verifier.config import Config
from verifier.llm import AgentFactory

MODEL = "stub-deployment"


def config(**overrides: Any) -> Config:
    base = {
        "openai_endpoint": "https://example.invalid/",
        "openai_chat_model": MODEL,
        "azure_client_id": None,
        "azure_tenant_id": None,
        "log_level": "WARNING",
        "request_timeout_seconds": 5.0,
    }
    return Config(**{**base, **overrides})


class FakeOpenAI:
    """Answers each completion with a canned payload, and records what it was asked.

    `payloads` are answered in order and the last one repeats, so a test that fans out to several
    agents can hand over one payload and get it from all of them.
    """

    base_url = "https://example.invalid/openai/v1/"
    api_key = "fake"

    def __init__(
        self,
        *payloads: str | None,
        finish_reason: str = "stop",
        error: Exception | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self._payloads = list(payloads) or [None]
        self._finish_reason = finish_reason
        self._error = error
        self.chat = type("_Chat", (), {"completions": _Completions(self)})()

    def _respond(self, kwargs: dict[str, Any]) -> Any:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        index = min(len(self.calls) - 1, len(self._payloads) - 1)
        if kwargs.get("stream"):
            # An orchestration run with `stream=True` puts every participant's client into
            # streaming mode, so the socket is asked for chunks rather than a completion. Same
            # payload, delivered in pieces — which is what the caller under test has to reassemble.
            return self._chunks(self._payloads[index])
        return ChatCompletion.model_validate(
            {
                "id": "fake",
                "created": 0,
                "model": MODEL,
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": self._finish_reason,
                        "logprobs": None,
                        "message": {"role": "assistant", "content": self._payloads[index]},
                    }
                ],
            }
        )

    async def _chunks(self, payload: str | None) -> Any:
        """The same answer as a chat-completion stream, cut into pieces.

        Cut deliberately small, and never on a token boundary that means anything: the point is
        that whatever reassembles this has to reassemble it, rather than happening to work because
        each chunk was valid JSON on its own.
        """
        text = payload or ""
        for start in range(0, max(len(text), 1), 17):
            yield ChatCompletionChunk.model_validate(
                {
                    "id": "fake",
                    "created": 0,
                    "model": MODEL,
                    "object": "chat.completion.chunk",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": text[start : start + 17]},
                            "finish_reason": None,
                            "logprobs": None,
                        }
                    ],
                }
            )
        yield ChatCompletionChunk.model_validate(
            {
                "id": "fake",
                "created": 0,
                "model": MODEL,
                "object": "chat.completion.chunk",
                "choices": [
                    {
                        "index": 0,
                        "delta": {},
                        "finish_reason": self._finish_reason,
                        "logprobs": None,
                    }
                ],
            }
        )

    @property
    def last(self) -> dict[str, Any]:
        return self.calls[-1]

    def call_instructing(self, needle: str) -> dict[str, Any]:
        """The call whose system message contains `needle`.

        Concurrent checks finish in whatever order they finish, so a test that wants one of them
        cannot index by position without becoming order-dependent (CLAUDE.md rule 6). What tells
        them apart on the wire is the brief each agent was given.
        """
        for call in self.calls:
            system = next((m for m in call["messages"] if m["role"] == "system"), None)
            if system and needle in str(system["content"]):
                return call
        raise AssertionError(f"no call instructed with {needle!r}; got {len(self.calls)} calls")


class _Completions:
    def __init__(self, owner: FakeOpenAI) -> None:
        self._owner = owner

    async def create(self, **kwargs: Any) -> Any:
        return self._owner._respond(kwargs)


def factory_for(fake: FakeOpenAI, **config_overrides: Any) -> AgentFactory:
    """An `AgentFactory` wired to a fake socket. Everything above the socket is real."""
    resolved = config(**config_overrides)
    return AgentFactory(
        resolved,
        chat_client=OpenAIChatCompletionClient(model=MODEL, async_client=fake),
    )
