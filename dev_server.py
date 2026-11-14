#!/usr/bin/env python3
"""
Local dev server for "Fake it till you make it".

Serves public/ as static files and routes POST /api/judge to api/judge.py:
the exact same file Vercel runs as a serverless function.

    .venv/bin/python dev_server.py      (or ./start.sh)
    → http://localhost:3000
"""

import importlib.util
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"


def load_dotenv(path: Path) -> None:
    """Minimal .env reader: KEY=VALUE lines, # comments, optional quotes."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip().removeprefix("export ").strip(), value.strip()
        if value[:1] in ("'", '"'):
            value = value[1:].split(value[0], 1)[0]
        else:
            value = value.split(" #", 1)[0].strip()
        if value and not os.environ.get(key):
            os.environ[key] = value


load_dotenv(ROOT / ".env")

# Import api/judge.py by path (api/ is not a package, so Vercel treats each file as a function).
_spec = importlib.util.spec_from_file_location("judge", ROOT / "api" / "judge.py")
judge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(judge)


class DevHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_POST(self):
        if self.path.split("?", 1)[0] == "/api/judge":
            judge.handle_post(self)
        else:
            self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always serve fresh files while developing
        super().end_headers()

    def log_request(self, code="-", size="-"):
        # Quiet: only log API calls and errors, not every static file.
        if self.command == "POST" or str(getattr(code, "value", code)) not in ("200", "304"):
            super().log_request(code, size)


def main() -> None:
    port = int(os.environ.get("PORT", "3000"))
    if os.environ.get("MOCK_JUDGE") == "1":
        print("MOCK_JUDGE=1: using offline heuristic scores (no API calls).")
    elif not os.environ.get("ANTHROPIC_API_KEY"):
        print("⚠️  ANTHROPIC_API_KEY is not set (.env). The game still runs, but every line gets fallback scores.")
    print(f"Fake it till you make it → http://localhost:{port}")
    server = ThreadingHTTPServer(("127.0.0.1", port), DevHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")
        sys.exit(0)


if __name__ == "__main__":
    main()
