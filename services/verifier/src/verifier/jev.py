"""TypeSafe's Jev, reached over its one documented endpoint.

Jev is not a chat model and nothing here is an `Agent`: it takes a state and a map of typed
questions and answers each with a calibrated probability, in a few hundred milliseconds. So it
does not go through `llm.AgentFactory`, which exists to pin sampling and schema for models that
write. It gets this file instead, and this file is the only place in the repository that holds the
TypeSafe key or knows the URL — the same one-door rule, for a second kind of model. ADR 0022.

Plain `httpx` rather than TypeSafe's SDK: the whole surface we use is one POST, and owning it
keeps the deadline, the retry and the wire payload in one screen of code. Tests hand in an
`httpx.MockTransport`, so everything above the socket is real.

Only `noul` questions are spoken here, because that is all /haugen asks. A second caller that
wants a Choice or a Score should add it beside `nouls`, not around it.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Config

ENDPOINT = "https://api.typesafe.ai/v1/systemone"

# 429 is our rate limit, 529 is theirs. Both say "again, shortly"; anything else is an answer.
_RETRYABLE = frozenset({429, 529})
# Long enough to clear a burst, short enough to fit inside the deadline twice.
_RETRY_DELAY_SECONDS = 0.25

log = logging.getLogger(__name__)


class JevUnavailable(Exception):
    """Jev did not answer: no key, a timeout, an error status, or a reply we could not read."""


@dataclass(frozen=True)
class NoulAnswers:
    """Each question id mapped to the probability its answer is yes, and who answered."""

    nouls: dict[str, float]
    model: str
    input_tokens: int


class JevClient:
    def __init__(
        self,
        api_key: str,
        model: str = "jev-latest",
        timeout_seconds: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model = model
        self._timeout = timeout_seconds
        self._client = httpx.AsyncClient(
            headers={"authorization": f"Bearer {api_key}"},
            timeout=timeout_seconds,
            transport=transport,
        )

    @classmethod
    def from_config(cls, config: Config) -> "JevClient | None":
        """The client, or None when no key is configured — which is a supported state."""
        if not config.typesafe_api_key:
            return None
        return cls(
            config.typesafe_api_key,
            model=config.jev_model,
            timeout_seconds=config.jev_timeout_seconds,
        )

    async def nouls(self, state: Any, questions: dict[str, dict[str, Any]]) -> NoulAnswers:
        """Ask every question against one state, in one request.

        The deadline covers the retry too: a caller that set three seconds gets three seconds,
        not three seconds per attempt.
        """
        body = {
            "model": self.model,
            "state": state,
            "questions": {qid: {"type": "noul", **q} for qid, q in questions.items()},
        }
        try:
            payload = await asyncio.wait_for(self._post(body), timeout=self._timeout)
        except TimeoutError as exc:
            raise JevUnavailable("timed out") from exc
        try:
            answers = payload["answers"]
            nouls = {qid: float(answers[qid]["noul"]) for qid in questions}
            return NoulAnswers(
                nouls=nouls,
                model=str(payload.get("model", self.model)),
                input_tokens=int(payload.get("usage", {}).get("input_tokens", 0)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise JevUnavailable(f"unreadable reply: {exc!r}") from exc

    async def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        for attempt in (1, 2):
            try:
                response = await self._client.post(ENDPOINT, json=body)
            except httpx.HTTPError as exc:
                raise JevUnavailable(f"{type(exc).__name__}") from exc
            if response.status_code in _RETRYABLE and attempt == 1:
                log.info("jev answered %s; retrying once", response.status_code)
                await asyncio.sleep(_RETRY_DELAY_SECONDS)
                continue
            if response.status_code != 200:
                # The body can echo the request back, and the request carries what somebody
                # typed. The status is enough to act on.
                raise JevUnavailable(f"status {response.status_code}")
            return response.json()
        raise JevUnavailable("still rate limited after a retry")

    async def aclose(self) -> None:
        await self._client.aclose()
