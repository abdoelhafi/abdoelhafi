# Cut-Out Studio

A small web app that turns a prompt into short vertical **paper cut-out animation videos** (1080×1920, 30 fps, about 55 s), the way uKeep's first video, *The Rolodex*, was made.

1. **Ideas**: type a theme. An LLM (Gemini or Claude) searches the web and returns fact-checked curiosity story ideas as cards: hook, 4 beats, visuals, brand moment, 2 sources, and a "check" note. Ideas it couldn't verify are greyed out.
2. **Script**: pick an idea. The LLM writes the 8-line narration with Eleven v4 audio tags, the on-screen hook, at most 2 punch words, a scene plan cut on spoken words, and the list of images needed.
3. **Images**: each character, object and background gets a copy-paste **Gemini prompt** (style block included, plus the "split into pieces" prompt for characters that need moving limbs). Paste them into one Gemini chat and drop the results back in. With `GEMINI_API_KEY` set, a **Generate** button makes them through the API instead. The app then:
   - cuts every upload into transparent pieces and shows them with editable names;
   - flags known Gemini defects, with a fix prompt to copy: background not flat, arms still attached to the torso, duplicate pieces (it tells left/right mirror pairs apart), brick-red skin (one-click repaint), pieces clipped at the border, and blurry backgrounds or ones with empty bands (the 9:16 failure);
   - offers **Label with AI**, which names split pieces using a vision model.
4. **Voice**: the whole script goes to ElevenLabs in **one request** (`/with-timestamps`, `eleven_v4`, `mp3_44100_128` for the free tier). You see the character count, and your remaining credits when the key has `user_read` permission, and confirm before anything is spent. Audio is cached by content, so the same script never costs credits twice.
5. **Video**: the LLM writes a **timeline JSON** (format in [`docs/TIMELINE.md`](docs/TIMELINE.md)) from the script, the word timestamps and your piece library. Times can be written as spoken words (`"@The Rolodex+0.2"`), so cuts land on the words. You can:
   - preview it live in the browser with the narration;
   - check 20 stills;
   - render the **MP4**: Playwright seeks the GSAP timeline frame by frame into ffmpeg, then synthesized sound effects (whoosh, pop, thump, ticks, chime, scan beep, wind) are mixed with the voice and loudness-normalized. There's no music; you add a trending sound on TikTok or Instagram.

Brand rules, the uKeep logo, the Gemini style block and the voice settings are editable under **Brand & style settings**. The defaults are uKeep's: no ads, the brand only in the last ~3 s, no invented facts, invented characters only.

## Run it

Requirements: Node 20+, Python 3.10+, ffmpeg.

```bash
cd cutout-studio
npm install
npx playwright install chromium           # once, for rendering
pip install -r requirements.txt           # opencv-python-headless, numpy, pillow
cp .env.example .env                      # add GEMINI_API_KEY and/or ANTHROPIC_API_KEY, ELEVENLABS_API_KEY
npm run demo                              # optional: creates the Rolodex demo project (no credits needed)
npm start                                 # http://localhost:3000
```

With no keys at all, the app runs on offline fixtures: the 18 researched story-bank ideas and the Rolodex script and timeline. You can click through every step and render the demo.

| Setting | What it does |
|---|---|
| `LLM_PROVIDER` | `auto` (Claude if its key is set, else Gemini, else mock), `gemini`, `claude` or `mock` |
| `GEMINI_API_KEY` | LLM steps (when Gemini is the provider) and in-app image generation |
| `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL` | defaults `gemini-pro-latest`, `gemini-3.1-flash-image`. Free-tier keys have no Pro or image quota: the app falls back to `gemini-flash-latest`, and fact-checks with `gemini-2.5-flash` (`GEMINI_SEARCH_MODEL`) |
| `APP_PASSWORD` | protects a deployed copy with a password (user `admin`) |
| `LOW_MEMORY=1` | small hosts: single-process Chromium with a small heap. Rendering still needs about 600 MB, so a 512 MB free instance can do every step except the MP4 render |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude for the LLM steps (default `claude-opus-5-5`, with web search for fact-checking) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | narration (default voice: George) |

Behind a corporate proxy, run Node with `NODE_USE_ENV_PROXY=1` so its built-in `fetch` uses `HTTPS_PROXY`.

## Deploy for free (Hugging Face Spaces)

No card needed. A free CPU Space has 2 vCPUs and 16 GB RAM; projects are lost when the Space restarts or rebuilds, so download your MP4s.

1. On https://huggingface.co/new-space choose **Docker → Blank**, hardware **CPU basic (free)**, visibility **Private**.
2. In the Space's **Files** tab, add the two files from `deploy/huggingface/` (`Dockerfile` and `README.md`, replacing the default README). The Dockerfile pulls this app from GitHub when it builds.
3. In **Settings → Variables and secrets**, add secrets `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` and, optionally, `APP_PASSWORD`.
4. Wait for the build (about 5–10 minutes), then open the app at `https://<your-username>-<space-name>.hf.space`.

To update after new commits, use **Settings → Factory rebuild**.

## Deploy (Render)

The repo has a Render Blueprint (`render.yaml` at the repo root) and a `Dockerfile` with Node, Chromium, Python/OpenCV and ffmpeg.

1. Open https://render.com/deploy?repo=https://github.com/abdoelhafi/abdoelhafi/tree/ccr-18ed63bb-3wocck and sign in with GitHub.
2. Fill in `APP_PASSWORD` (anything you like: the site asks for user `admin` and this password), `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` (optional: `ANTHROPIC_API_KEY`).
3. Deploy. The first build takes a few minutes; the Rolodex demo project is created on first start.

Render asks for a card for Blueprints. It uses the Standard plan (2 GB, about $25/month) with a 5 GB disk, because rendering needs more than the 512 MB of the Free and Starter plans. On a 512 MB instance set `LOW_MEMORY=1`: every step works except the MP4 render, and without a disk projects vanish on every restart. Any Docker host works the same way: build `cutout-studio/`, mount a volume on `/data`, set the env vars.

## Render on GitHub Actions (free, full quality)

Rendering needs about 600 MB to 1 GB of memory, more than a free 512 MB host has. In the Video step, **Render on: GitHub Actions** sends the job to GitHub instead. The public repository gets free runners with 16 GB of memory, so the MP4 is rendered at full 1080×1920 quality and sent back into the app (about 10 minutes). **This server** keeps rendering on the app's own machine, so you can switch back at any time.

How it works: the app packs the project (timeline, pieces, voice) and starts the `render-video` workflow with only its URL and a job id. The runner downloads the pack, renders, reports progress (shown in the app with a link to the GitHub run) and uploads the MP4. Every call carries a shared secret, so the public Actions logs reveal nothing usable. If the upload fails (e.g. the app restarted), the MP4 is kept on the GitHub run as an artifact for 3 days.

One-time setup:

1. **Workflow on the default branch.** GitHub only runs manual workflows that exist on the default branch (`main`). Merge `.github/workflows/render-video.yml` into `main` (it renders the app code from the `ccr-18ed63bb-3wocck` branch; change `GITHUB_APP_REF` if the app moves).
2. **A shared secret.** Make up a long random string. In GitHub: repository **Settings → Secrets and variables → Actions → New repository secret**, name `RENDER_SHARED_SECRET`.
3. **A GitHub token.** https://github.com/settings/personal-access-tokens/new → *Only select repositories*: `abdoelhafi/abdoelhafi` → *Repository permissions*: **Actions: Read and write**.
4. **On the app's host** (e.g. Render → Environment), add `GITHUB_TOKEN` (the token) and `RENDER_SHARED_SECRET` (the same string). On Render the app's public URL is detected automatically; elsewhere set `PUBLIC_URL`.
5. In the app, Video step → **Render on: GitHub Actions**.

| Setting | Default |
|---|---|
| `GITHUB_REPO` | `abdoelhafi/abdoelhafi` |
| `GITHUB_WORKFLOW` | `render-video.yml` |
| `GITHUB_REF` | the repository's default branch (where the workflow file lives) |
| `GITHUB_APP_REF` | `ccr-18ed63bb-3wocck` (the app code the runner uses) |

## Save projects in Supabase (survives restarts)

Free hosts wipe their disk on every restart. With Supabase set up, the app saves every change to a private Supabase Storage bucket a few seconds after it happens, and restores all projects when it starts on an empty disk. No SQL setup: the bucket is created automatically.

1. Create a free project at https://supabase.com.
2. Under **Project Settings → API Keys**, copy the **secret key** (`sb_secret_…`; the legacy `service_role` key also works). The project URL is `https://<project-id>.supabase.co`.
3. On the app's host, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

What is saved: each project's data, uploads, cut pieces and voice, plus the newest render of each project (older renders stay only on the server, to fit the free 1 GB). Deleting a project deletes it from Supabase too. A free Supabase project pauses after a week without use; restore it from the Supabase dashboard and nothing is lost. The sidebar shows "Saved to Supabase" when it is on.

## Export and import

Free hosts wipe their disk on every restart (Render's free plan: after about 15 minutes without visitors, and on every deploy); Supabase saving (above) handles that automatically. As a manual backup, **Export** (next to the project title) downloads the whole project as one `.cutout.tgz` file: ideas, script, uploads and pieces, voice, timeline, and your brand settings. Renders are left out to keep the file small, so download MP4s separately; add `?renders=1` to the export link to include them. **Import a video…** in the sidebar brings it back, on the same server after a restart or on another one. Brand settings are restored only if the server has none yet.

## How it fits together

```
public/            the wizard UI (vanilla JS, no build step)
server/index.js    JSON API (Express); projects are folders in data/projects/<id>/
server/llm.js      one generateJSON() over Claude, Gemini and an offline mock
server/prompts.js  every LLM prompt + the Gemini image prompts and fix prompts
server/timeline.js "@spoken words" -> seconds from ElevenLabs character timestamps
server/render.js   stills + MP4 render (Playwright -> ffmpeg), SFX + mix
server/eleven.js   ElevenLabs with-timestamps, cached; gemini-image.js: optional image API
engine/            the animation engine (GSAP) and the player page used by preview and render
py/cutout.py       background removal, piece splitting and defect checks
py/repaint.py      fixes brick-red skin; py/sfx.py synthesizes the sound effects; py/sheet.py contact sheets
examples/rolodex/  the Rolodex script, timeline, cut pieces and narration (the demo, and the LLM's worked example)
docs/TIMELINE.md   the timeline format (also given to the LLM as its instructions)
```

`npm test` checks the time resolver and JSON parsing against the Rolodex narration.

## Tips that made the first video work

- The first 3 seconds decide everything: motion, conflict and a mystery object on frame 1, with narration from frame 1.
- Only necessary text on screen: the hook and 1–2 punch words.
- Keep every Gemini prompt in one chat. If a face drifts, re-upload the first image and say "Keep this exact character".
- Never ask Gemini for 9:16 backgrounds; ask for wide 16:9 or use the drawn presets, which looked good in the first video.
- Always check the stills before the full render.
