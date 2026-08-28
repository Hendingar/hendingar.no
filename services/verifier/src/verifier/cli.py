"""Entry point: `verifier serve`."""

import sys

import uvicorn


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] != "serve":
        print(f"unknown command: {sys.argv[1]}\nusage: verifier serve", file=sys.stderr)
        raise SystemExit(2)
    import os

    uvicorn.run(
        "verifier.app:create_app",
        factory=True,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
