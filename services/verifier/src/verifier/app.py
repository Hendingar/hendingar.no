"""HTTP surface. Internal-only ingress in Azure — never exposed to the internet."""

import logging

from fastapi import FastAPI, HTTPException

from .config import Config, load_config
from .extract import extract_poster
from .llm import LlmClientFactory
from .models import ExtractedEvent, ExtractRequest, VerifyRequest, VerifyResponse
from .verify import verify as run_verify

log = logging.getLogger(__name__)

# 8 MB of base64 ~= 6 MB of image. Phone photos are routinely larger, so the caller downscales
# before sending; this is the backstop against a memory-exhausting request.
MAX_IMAGE_BASE64_BYTES = 8 * 1024 * 1024


def create_app(config: Config | None = None, factory: LlmClientFactory | None = None) -> FastAPI:
    """Factory so tests can inject a fake LLM factory and never touch Azure."""
    config = config or load_config()
    logging.basicConfig(level=config.log_level)
    factory = factory or LlmClientFactory(config)

    app = FastAPI(title="hendingar verifier", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        # Reports reachability only. It deliberately does NOT call the model: a health check that
        # spends tokens on every probe is its own outage.
        return {"status": "ok", "model": factory.model}

    @app.post("/extract", response_model=ExtractedEvent)
    async def extract(request: ExtractRequest) -> ExtractedEvent:
        if len(request.image_base64) > MAX_IMAGE_BASE64_BYTES:
            raise HTTPException(status_code=413, detail="image too large; downscale before sending")
        try:
            return await extract_poster(factory, request)
        except Exception as exc:
            log.exception("extraction failed")
            raise HTTPException(status_code=502, detail=f"extraction failed: {exc}") from exc

    @app.post("/verify", response_model=VerifyResponse)
    async def verify(request: VerifyRequest) -> VerifyResponse:
        try:
            return await run_verify(factory, request)
        except Exception as exc:
            log.exception("verification failed")
            raise HTTPException(status_code=502, detail=f"verification failed: {exc}") from exc

    return app
