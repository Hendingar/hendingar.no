"""HTTP surface. Internal-only ingress in Azure — never exposed to the internet."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .appeal import JURORS, QUORUM, judge_appeal, juror_by_id
from .config import Config, load_config
from .crop import suggest_crop
from .extract import extract_page, extract_poster
from .improve import improve as run_improve
from .improve import improve_stream as run_improve_stream
from .kurator import curate as run_curate
from .llm import AgentFactory
from .models import (
    AppealRequest,
    CropRequest,
    CropSuggestion,
    CuratorRequest,
    CuratorSelection,
    ExtractedEvent,
    ExtractPageRequest,
    ExtractRequest,
    ImproveRequest,
    ImproveSuggestion,
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


def create_app(config: Config | None = None, factory: AgentFactory | None = None) -> FastAPI:
    """Factory so tests can inject an `AgentFactory` over a fake client and never touch Azure."""
    config = config or load_config()
    logging.basicConfig(level=config.log_level)
    factory = factory or AgentFactory(config)

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

    @app.post("/crop", response_model=CropSuggestion)
    async def crop(request: CropRequest) -> CropSuggestion:
        """Where to cut a thumbnail out of an image nobody read.

        The photo path never calls this — `/extract` already returns a box with the fields. This is
        for a picture attached to a form somebody filled in themselves, and it is asked only after
        that event has been approved.

        A failure here is a 502 and the caller shrugs: it keeps the whole image and the card still
        gets a real picture. That is why this endpoint is allowed to be the thin thing it is.
        """
        if len(request.image_base64) > MAX_IMAGE_BASE64_BYTES:
            raise HTTPException(status_code=413, detail="image too large; downscale before sending")
        try:
            return await suggest_crop(factory, request)
        except Exception as exc:
            log.exception("crop suggestion failed")
            raise HTTPException(status_code=502, detail=f"crop failed: {exc}") from exc

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

    @app.post("/improve", response_model=ImproveSuggestion)
    async def improve(request: ImproveRequest) -> ImproveSuggestion:
        """A better description for a submission, or — usually — an honest nothing.

        The only endpoint here that writes prose rather than reading it, and the only one that is
        a group chat: a writer drafts, a fact-checker strikes every claim the submission does not
        contain, and an unapproved draft is discarded rather than shown. See `improve.py`.

        A 502 costs nothing. Nobody is blocked on this — the person is looking at a form they
        filled in themselves, and the worst outcome is that they keep their own words.
        """
        try:
            return await run_improve(factory, request)
        except Exception as exc:
            log.exception("improvement failed")
            raise HTTPException(status_code=502, detail=f"improve failed: {exc}") from exc

    @app.post("/improve/stream")
    async def improve_streaming(request: ImproveRequest) -> StreamingResponse:
        """The same two agents, reported as they take their turns.

        `/improve` above answers in one piece and is what the CLI, the evals and any caller that
        cannot hold a socket open still use. This is for the person in front of the form, because
        that is where the wait is: up to four sequential model calls whose usual answer is *no
        text*, which as a single response is fifteen seconds of nothing ending in a refusal. The
        turns are the argument for that refusal, and they exist either way — this endpoint is
        the difference between showing them and throwing them away.

        Both routes run the same `improve_stream`, so the verdict cannot depend on which one asked.

        Errors are frames, not statuses. By the time anything can fail the headers are long gone,
        so a failure is an `error` event and the caller degrades exactly as it does for a 502: the
        person keeps the words they wrote, which is what this feature protects anyway.
        """

        async def frames():
            try:
                async for kind, payload in run_improve_stream(factory, request):
                    yield f"event: {kind}\ndata: {payload.model_dump_json()}\n\n"
            except Exception as exc:
                log.exception("streamed improvement failed")
                yield f'event: error\ndata: {{"detail": "{type(exc).__name__}"}}\n\n'

        return StreamingResponse(
            frames(),
            media_type="text/event-stream",
            headers={
                "cache-control": "no-store",
                # A proxy that buffers holds the whole stream and delivers it at once, which is
                # precisely the experience this endpoint exists to avoid.
                "x-accel-buffering": "no",
            },
        )

    @app.post("/kurator", response_model=CuratorSelection)
    async def kurator(request: CuratorRequest) -> CuratorSelection:
        """This weekend's picks: a judgement, made once a night and stored by the caller.

        The second endpoint that is a group chat, and the first that is asked for an opinion rather
        than a fact. `kurator.py` carries the reasoning, including why the candidates arrive with
        no heart or view counts on them.

        A 502 costs a section on a page, and nothing else: the app renders the weekend listing it
        would have rendered anyway.
        """
        try:
            return await run_curate(factory, request)
        except Exception as exc:
            log.exception("curation failed")
            raise HTTPException(status_code=502, detail=f"curation failed: {exc}") from exc

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
