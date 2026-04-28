# FastBreak

A mobile-first NBA app: scores (with box scores), season leaders, conference standings, and the playoff bracket. Built with Expo/React Native on the client and a small FastAPI backend that wraps the [`nba_api`](https://github.com/swar/nba_api) Python library.

## Architecture

```
┌──────────────────────┐         ┌────────────────────────┐         ┌────────────────┐
│  Expo Go (iPhone)    │ ──────▶ │  FastAPI backend       │ ──────▶ │  stats.nba.com │
│  React Native app    │  HTTP   │  uvicorn :8000         │  HTTPS  │  (via nba_api) │
│  src/screens/*       │         │  backend/main.py       │         │                │
└──────────────────────┘         └────────────────────────┘         └────────────────┘
```

The backend exists because `stats.nba.com` blocks unauthenticated browser/RN clients via CORS and aggressive header checks. `nba_api` handles the headers and rate-limit dance; the FastAPI proxy normalizes its responses into JSON the client can consume directly.

## Stack

**Frontend** (Expo SDK 54 / React Native 0.81 / React 19, TypeScript)

| File / folder | Purpose |
| --- | --- |
| `App.tsx` | Tab state, font loading, root chrome |
| `src/components/AppChrome.tsx` | Top bar (brand) + bottom tab nav |
| `src/components/BoxScoreModal.tsx` | Slide-up modal showing per-team player stats |
| `src/components/DataState.tsx` | Shared `LoadingState` / `EmptyState` / `ErrorState` |
| `src/hooks/useAsyncData.ts` | Generic data-loading hook with reload + cancellation |
| `src/screens/ScoresScreen.tsx` | Date scroller, game cards, tap-to-open box score |
| `src/screens/StatsScreen.tsx` | Season leaders for PTS/REB/AST/STL/BLK/FG% |
| `src/screens/StandingsScreen.tsx` | East/West conference standings table |
| `src/screens/PlayoffsScreen.tsx` | Bracket reconstructed from postseason game log |
| `src/services/nbaApi.ts` | All backend HTTP calls + shared helpers/types |
| `src/theme.ts` | Color/font/spacing/radii tokens |
| `src/navigation.ts` | Tab definitions |

**Backend** (Python 3.10+, FastAPI, `nba_api`)

| File | Purpose |
| --- | --- |
| `backend/main.py` | All endpoints + nba_api adapters |
| `backend/requirements.txt` | `fastapi`, `uvicorn[standard]`, `nba_api` |

### Backend endpoints

All return `{ "data": ... }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Sanity check — `{ ok: true, teams_loaded: 30 }` |
| `GET` | `/teams` | All 30 NBA teams (id, abbreviation, conference, division, etc.) |
| `GET` | `/games?date=YYYY-MM-DD` | Games on a date with status, scores, ISO tip-off |
| `GET` | `/leaders?season=2025&stat=PTS&season_type=Regular Season` | Top-25 league leaders for one stat |
| `GET` | `/standings?season=2025` | Per-team conference/division ranks and records |
| `GET` | `/playoffs?season=2025` | All postseason games for a season |
| `GET` | `/boxscore?gameId=0022500100` | Per-team player box scores for one game |

`season` is the starting year — `2025` means the 2025–26 season. Stats categories are `PTS`, `REB`, `AST`, `STL`, `BLK`, `FG_PCT`. nba_api upstream errors come back as a clean HTTP `502` rather than a stack trace.

## Running locally

You need both processes running in parallel: the Python backend on `:8000`, and the Expo dev server. Your phone (Expo Go) must be on the same Wi-Fi as your PC so it can reach the backend.

### One-time setup

**Python backend** (run from `backend/`):

```powershell
cd backend
py -3.14 -m venv .venv             # any Python 3.10+ works
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Frontend** (run from repo root):

```powershell
npm install
```

**Configure backend URL.** Find your machine's LAN IP (`ipconfig` on Windows — look for the IPv4 address on your active adapter, typically `192.168.x.x`). Then in `.env` at the repo root:

```
EXPO_PUBLIC_NBA_API_BASE_URL=http://192.168.0.252:8000
```

(Replace with your actual IP. The port must match what uvicorn binds to.)

**Allow port 8000 through Windows Firewall** (one-time). The first time uvicorn binds to `0.0.0.0:8000`, Windows will pop up a firewall dialog — allow it on Private networks. If you missed it:

```powershell
New-NetFirewallRule -DisplayName "FastBreak NBA API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
```

(Run from an elevated PowerShell.)

### Each dev session

Open two terminals.

**Terminal 1 — backend:**

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

`--host 0.0.0.0` is what makes it reachable from the phone. `--reload` auto-restarts on file changes. Verify by opening `http://<your-LAN-IP>:8000/health` in a browser — you should see `{"ok": true, "teams_loaded": 30}`.

**Terminal 2 — Expo:**

```powershell
npx expo start -c
```

`-c` clears the Metro cache (often necessary after env or service changes). Scan the QR code with Expo Go on your phone.

### Expo Go SDK compatibility

Expo Go in the App Store ships a runtime locked to one Expo SDK version. This project is pinned to **SDK 54** to match the latest publicly available Expo Go (54.0.2 as of Apr 2026). If you want to upgrade later:

1. Check the Expo Go version installed on your phone (App Store → your account → Expo Go).
2. If it's newer than 54, run from the repo root:
   ```powershell
   npx expo install expo@^<newer-major>
   npx expo install --fix
   ```
3. If your project SDK is newer than what Expo Go supports, you'll need a [development build](https://docs.expo.dev/develop/development-builds/introduction/) instead — `npx expo run:ios` / `run:android` — which bundles your own runtime.

## Things to know

- **Cold-start latency.** `stats.nba.com` typically takes 1–3 seconds per call. The Stats screen fires six leaders calls in parallel; if it goes slow or 502s, that's upstream throttling. Wait a moment and pull-to-refresh.
- **Past-date games.** `ScoreboardV2` doesn't always update its `GAME_STATUS_TEXT` for past dates, so the backend treats any game on a date strictly before today's ET date as `Final` regardless of what status text says.
- **Tip-off times.** Stored as ISO 8601 with the `America/New_York` offset, then formatted with `toLocaleTimeString()` on the device — so the user sees their own local time and timezone abbreviation (e.g., `7:30 PM PDT`).
- **Game IDs are strings.** NBA game IDs have leading zeros (`0022500100`) — keep them as strings end-to-end or `/boxscore` lookups will fail.
## Deploying

Two free services: **Fly.io** for the backend (always-on, no cold starts), **Cloudflare Pages** for the web frontend. Default subdomains only — no custom domain needed.

### Backend → Fly.io

One-time setup (~5 min):
1. Sign up at [fly.io/app/sign-up](https://fly.io/app/sign-up). A payment card is required for verification but the free allowance covers our usage.
2. Install the `flyctl` CLI:
   ```powershell
   # Windows PowerShell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
   On macOS/Linux: `curl -L https://fly.io/install.sh | sh`. Restart your terminal so `flyctl` is on `PATH`.
3. Sign in:
   ```powershell
   fly auth login
   ```

Deploy from `backend/`:
```powershell
cd backend
fly launch
```

`fly launch` is interactive. Recommended answers:
- **App name**: `fastbreak-backend` (or any globally unique name; Fly will append a suffix if taken)
- **Region**: pick the one closest to you (`sjc` = San Jose, `lax` = Los Angeles, `iad` = Virginia, etc.)
- **Postgres / Redis**: No to both — we don't need them
- **Deploy now**: Yes

It auto-generates a `fly.toml` from the [Dockerfile](backend/Dockerfile), builds remotely, and deploys. Takes ~3-5 min on first run.

When it finishes, the URL is printed — something like `https://fastbreak-backend.fly.dev`. That's your backend.

Verify:
```powershell
curl https://fastbreak-backend.fly.dev/health
# {"ok":true,"teams_loaded":30}
```

Subsequent deploys (after editing `backend/`) are just:
```powershell
fly deploy
```

To keep the machine always-on (no cold starts) and pin to one VM, edit the generated `fly.toml`:
```toml
[http_service]
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

Then `fly deploy` again to apply. One always-on `shared-cpu-1x@256MB` VM fits comfortably inside the free allowance.

### Frontend → Cloudflare Pages

1. Push the repo to GitHub if it isn't already.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** → pick the repo.
3. Configure the build:
   - **Framework preset**: None
   - **Build command**: `npm run build:web`
   - **Build output directory**: `dist`
4. Under **Environment variables**, add:
   - `EXPO_PUBLIC_NBA_API_BASE_URL` = your Fly.io URL from above (no trailing slash)
5. Click **Save and Deploy**.

The first build takes ~2 min. Cloudflare gives you a permanent URL like `https://fastbreak.pages.dev`. Every push to `master` redeploys automatically.

The [public/_redirects](public/_redirects) file in the repo tells Pages to serve `index.html` for unknown routes (so deep links and refreshes don't 404).

### After deploying

- **Tighten CORS.** In [backend/main.py](backend/main.py) change `allow_origins=["*"]` to `allow_origins=["https://fastbreak.pages.dev"]` (your actual Pages URL) and `fly deploy` again. The wildcard is fine for development but unnecessary in production.
- **Local dev still works.** `.env` is gitignored, so your LAN-IP setting doesn't ship to Cloudflare. The Fly URL is set in Cloudflare's environment variables and only applies to the deployed build.
- **Watching logs.** `fly logs` for the backend, Cloudflare's "Deployments" tab for the frontend.

## PWA / Add to Home Screen

The web build is configured as a Progressive Web App, so when iOS or Android users tap "Add to Home Screen" they get a standalone app icon that opens without browser chrome (no Safari address bar / tab strip).

How it works:
- [public/manifest.webmanifest](public/manifest.webmanifest) declares the app's name, theme colors, display mode (`standalone`), and icon set.
- [scripts/postbuild-pwa.js](scripts/postbuild-pwa.js) runs after `expo export --platform web` and injects the iOS-specific `<meta>` tags into `dist/index.html`. iOS Safari only honors the standalone-mode flag if it's in the initial HTML, so a postbuild step is required.
- `npm run build:web` chains both steps.

### Icons

Put PNGs in `public/icons/` so they get copied into `dist/icons/`:

| File | Size | Purpose |
| --- | --- | --- |
| `icon-192.png` | 192×192 | Manifest (Android home screen) |
| `icon-512.png` | 512×512 | Manifest (Android splash + larger surfaces) |
| `icon-512-maskable.png` | 512×512 | Android adaptive icon (with safe-zone padding) |
| `apple-touch-icon.png` | 180×180 | iOS home screen icon |

Easiest way to generate all four from a single source image: use [realfavicongenerator.net](https://realfavicongenerator.net/) — upload one square PNG (1024×1024 ideal), download the bundle, and drop the four files above into `public/icons/`. Free, no signup.

If you skip this step the PWA still installs, but iOS will use a screenshot of the page as the home-screen icon (works, just ugly).

### How users install it

- **iOS Safari**: Share button → "Add to Home Screen". Tapping the new icon opens FastBreak full-screen, no browser chrome. Looks and feels like a native app.
- **Android Chrome**: a banner appears at the bottom suggesting "Install Fastbreak", or via the ⋮ menu → "Install app".
- **Desktop Chrome / Edge**: install icon appears in the address bar.

The same standalone behavior happens automatically once the manifest is in place.

## Type-checking

```powershell
npm run typecheck
```

(There is no test suite or linter wired up yet.)
