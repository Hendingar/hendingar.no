"""HTTP surface. Internal-only ingress in Azure — never exposed to the internet."""

import logging

from fastapi import FastAPI, HTTPException

from .appeal import JURORS, QUORUM, judge_appeal, juror_by_id
from .config import Config, load_config
from .extract import extract_page, extract_poster
from .llm import LlmClientFactory
from .models import (
    AppealRequest,
    ExtractedEvent,
    ExtractPageRequest,
    ExtractRequest,
    JurorVerdict,
    VerifyRequest,
    VerifyResponse,
)
from .verify import verify as run_verify

log = logging.getLogger(__name__)

# 8 MB of base64 ~= 6 MB of image. Phone photos are routinely larger, so the caller downscales
# before sending; this is the backstop against a memory-exhausting request.
MAX_IMAGE_BASE64_BYTES = 8 * 1024 * 1024

# The app already truncates page text before sending. This is the backstop, and it is generous:
# a long listing page is legitimately tens of thousands of characters once the markup is gone.
MAX_PAGE_TEXT_CHARS = 40_000


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

    @app.post("/extract-page", response_model=ExtractedEvent)
    async def extract_page_route(request: ExtractPageRequest) -> ExtractedEvent:
        """The fallback for a linked page that publishes no structured data.

        The app reads schema.org itself and only reaches here when a page carries none — so this
        endpoint sees the pages nobody marked up, which is most of the open web and none of the
        calendars we already import.
        """
        if len(request.text) > MAX_PAGE_TEXT_CHARS:
            raise HTTPException(
                status_code=413, detail="page text too long; truncate before sending"
            )
        try:
            return await extract_page(factory, request)
        except Exception as exc:
            log.exception("page extraction failed")
            raise HTTPException(status_code=502, detail=f"extraction failed: {exc}") from exc

    @app.post("/verify", response_model=VerifyResponse)
    async def verify(request: VerifyRequest) -> VerifyResponse:
        try:
            return await run_verify(factory, request)
        except Exception as exc:
            log.exception("verification failed")
            raise HTTPException(status_code=502, detail=f"verification failed: {exc}") from exc

    @app.get("/appeal/panel")
    async def panel() -> dict:
        """Who is on the panel, and how many have to agree.

        The caller needs the seats to know how many requests to make and what to label them with
        while it waits — and the quorum has to come from here rather than being duplicated in the
        app, or the two could disagree about what a majority is.
        """
        return {
            "jurors": [{"id": j.id, "name": j.name} for j in JURORS],
            "quorum": QUORUM,
        }

    @app.post("/appeal", response_model=JurorVerdict)
    async def appeal(request: AppealRequest) -> JurorVerdict:
        """One juror's vote on one appeal.

        One seat per request on purpose: the caller asks all three at once and shows each verdict
        the moment it lands, rather than leaving somebody watching a blank screen for three model
        round-trips. `judge_appeal` never raises — a juror that cannot answer votes no, with a
        reason — so a panel is never left hanging on one bad call.
        """
        juror = juror_by_id(request.juror)
        if juror is None:
            raise HTTPException(status_code=400, detail=f"unknown juror: {request.juror}")
        return await judge_appeal(factory, juror, request)

    return app
