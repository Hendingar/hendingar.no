"""Entry point: `verifier serve` (production) and `verifier dev` (reloading)."""

import os
import sys

import uvicorn

_USAGE = "usage: verifier [serve|dev]"


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if command not in ("serve", "dev"):
        print(f"unknown command: {command}\n{_USAGE}", file=sys.stderr)
        raise SystemExit(2)

    # `dev` reloads on save. Iterating on the extraction prompt is the main reason to run this
    # locally, and restarting by hand between every image read is the difference between trying
    # five prompt variants and trying one.
    reload = command == "dev"

    uvicorn.run(
        "verifier.app:create_app",
        factory=True,
        host="127.0.0.1" if reload else "0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        reload=reload,
        reload_dirs=["src"] if reload else None,
    )
