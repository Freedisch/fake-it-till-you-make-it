# Fake it till you make it

You get a dream job ad and a hopelessly underqualified CV. Rewrite each CV line under time pressure so it sounds impressive, without the AI interviewer catching you lying.

- Frontend: `public/` (one `index.html`, vanilla JS and CSS, no build step)
- Backend: `api/judge.py`, one Python serverless function that holds the API key and calls Claude (`claude-haiku-5-5`)
- Scenarios: `public/scenarios.js` (hardcoded and easy to edit)
- Sound: `public/sound.js`, small WebAudio blips with no audio files (the speaker button top-right mutes them)

## Run it locally

You need Python 3.10+ (no Node required).

```bash
cp .env.example .env        # then paste your key after ANTHROPIC_API_KEY=
./start.sh                  # first run creates .venv and installs the anthropic SDK
```

Open http://localhost:3000.

`start.sh` is just a shortcut for:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python dev_server.py
```

`dev_server.py` serves `public/` and sends `POST /api/judge` to `api/judge.py`, the same file Vercel runs in production.

### Handy for testing

| What | How |
|---|---|
| Play without an API key or tokens | `MOCK_JUDGE=1 ./start.sh` (rough offline scores) |
| Get a follow-up question on every stage 2–3 line | `FOLLOW_UP_CHANCE=1 ./start.sh` (default `0.5`) |
| Force a scenario | `http://localhost:3000/?scenario=chef` (ids are in `scenarios.js`) |
| Inspect state in the console | add `?debug=1`, then `__fitymi.state()` |

Without a key (and without mock mode) the game still runs, but every line gets the fallback score (+3 hire, +5 suspicion).

## How the judge stays safe and robust

- The key is read from `ANTHROPIC_API_KEY` on the server only. Nothing in `public/` touches it.
- 8-second timeout, defensive JSON parsing, and a fallback result for every failure. The browser has its own 10-second backstop.
- Prompt injection ("ignore previous instructions…") is punished in character: 0 impressiveness, +30 suspicion.
- Rate limit: 30 judged lines per browser session (`MAX_CALLS_PER_SESSION`), plus a per-instance cap per minute (`MAX_CALLS_PER_MINUTE`). These counters live in memory, so treat them as best effort.

## Deploy to Vercel

No build step and no Node needed. Vercel serves `public/` as static files and runs `api/judge.py` as a Python function (`vercel.json` sets this up; `requirements.txt` installs the SDK).

1. **Put the code on GitHub.** Create an empty repo on github.com, then either:
   - push with git, or
   - on the repo page choose **uploading an existing file**, and drag in everything Finder shows in this folder (`api`, `public`, `README.md`, `requirements.txt`, `vercel.json`, and the rest). Finder hides `.env` and `.venv`, so neither gets uploaded. **Never upload `.env`.**
2. **Import it on Vercel.** Go to vercel.com → **Add New → Project** → import the repo. Leave Framework Preset as **Other** and the build settings empty.
3. **Add the key.** Under **Environment Variables**, add `ANTHROPIC_API_KEY` with your key (optionally `MAX_CALLS_PER_SESSION` and `FOLLOW_UP_CHANCE`).
4. **Deploy.** The first build takes a minute or two. Open the URL and play one line. A real interviewer reaction, not "Hmm, okay…", means the key works.

If every line says "Hmm, okay…", open the project's **Logs** on Vercel. Lines starting with `[judge]` give the reason (for example `no_api_key` or `auth_error`).

Changed the key? Redeploy, since environment variables are read at deploy time.
