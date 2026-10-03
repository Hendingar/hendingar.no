"""Score the /haugen question against real events and real Jev.

Run on demand, never in CI: this calls TypeSafe with the key in `.env`. See evals/README.md.

`haugen/events.json` is a fixed snapshot of 150 upcoming events as the public event pages
described them on 2026-10-03, so a change in score is a change in the question or the model, not
in what happened to be on that week. `haugen/cases.json` says, per search, which titles must float
(score at or above FLOAT) and which must stay down (below SINK).

    pnpm verifier:eval:haugen            # every case, and the top of each pile
    pnpm verifier:eval:haugen ungdom     # cases whose search contains "ungdom"
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

from verifier.config import load_config
from verifier.haugen import rank
from verifier.jev import JevClient
from verifier.models import HaugenEvent, HaugenRequest

HERE = Path(__file__).parent / "haugen"

# The app's thresholds (app/src/lib/haugen.ts). Duplicated here because this is a script that
# reports, not a contract; if they move, move these and re-run.
FLOAT = 0.5
SINK = 0.35


async def main(needle: str) -> int:
    config = load_config()
    client = JevClient.from_config(config)
    if client is None:
        print("TYPESAFE_API_KEY is not set in services/verifier/.env")
        return 2

    events = [HaugenEvent(**e) for e in json.loads((HERE / "events.json").read_text("utf-8"))]
    titles = {e.id: e.title for e in events}
    cases = json.loads((HERE / "cases.json").read_text("utf-8"))
    failures = 0

    for case in cases:
        if needle not in case["search"]:
            continue
        started = time.perf_counter()
        ranking = await rank(client, HaugenRequest(query=case["search"], events=events))
        ms = (time.perf_counter() - started) * 1000
        scored = sorted(ranking.scores, key=lambda s: -s.score)
        floated = [s for s in scored if s.score >= FLOAT]
        print(f"\n{case['search']!r}  {ms:.0f} ms  {len(floated)} float")
        for s in scored[:8]:
            print(f"  {s.score:.2f}  {titles[s.event_id]}")

        def best(fragment: str, scored: list = scored) -> float:
            hits = [s.score for s in scored if fragment.lower() in titles[s.event_id].lower()]
            return max(hits) if hits else -1

        for fragment in case.get("float", []):
            score = best(fragment)
            if score < FLOAT:
                failures += 1
                print(f"  FAIL should float: {fragment} ({score:.2f})")
        for fragment in case.get("sink", []):
            score = best(fragment)
            if score >= SINK:
                failures += 1
                print(f"  FAIL should sink: {fragment} ({score:.2f})")

    await client.aclose()
    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "")))
