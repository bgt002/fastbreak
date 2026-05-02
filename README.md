# FastBreak

A mobile-first NBA app: live scores with full box scores, season leaders, conference standings, and the playoff bracket. Built with Expo/React Native on the client and a small FastAPI backend that wraps the [`nba_api`](https://github.com/swar/nba_api) Python library. Ships as a PWA installable on iOS / Android home screens.

## Architecture

```
┌──────────────────────────┐         ┌────────────────────────┐         ┌────────────────┐
│  Phone (PWA / Expo Go)   │ ──────▶ │  FastAPI backend       │ ──────▶ │  stats.nba.com │
│  React Native + RNW      │  HTTPS  │  uvicorn :8000 + Caddy │  HTTPS  │  cdn.nba.com   │
│  src/screens/*           │         │  backend/main.py       │         │  ESPN (fallback)│
└──────────────────────────┘         └────────────────────────┘         └────────────────┘
```

The backend exists because `stats.nba.com` blocks unauthenticated browser/RN clients via CORS and aggressive header checks. `nba_api` handles the headers and rate-limit dance; the FastAPI proxy normalizes its responses into JSON the client can consume directly. The backend additionally overlays live scoreboard data from `cdn.nba.com` and falls back to ESPN for date-range schedule lookups when nba_api lags behind on tip-off times.

## Stack

**Frontend** (Expo SDK 54 / React Native 0.81 / React 19, TypeScript)

| File / folder | Purpose |
| --- | --- |
| `App.tsx` | Tab state, font loading, root chrome, responsive layout switch (mobile vs desktop) |
| `index.ts` | Expo entry point |
| `src/components/AppChrome.tsx` | Mobile chrome — top bar (brand) + bottom tab nav with iOS PWA safe-area handling |
| `src/components/AppChromeDesktop.tsx` | Desktop chrome — sidebar nav for ≥1024px viewports |
| `src/components/BoxScoreModal.tsx` | Slide-up modal showing per-team player stats with sticky player-name column |
| `src/components/PlayerLeadersModal.tsx` | Full-screen sortable stat table with team/position filters and regular/playoffs toggle |
| `src/components/PlayerAvatar.tsx` | Player headshot with initials fallback |
| `src/components/DataState.tsx` | Shared `LoadingState` / `EmptyState` / `ErrorState` |
| `src/screens/ScoresScreen.tsx` | Mobile scores — paged week strip, game cards, tap-to-open box score |
| `src/screens/ScoresScreenDesktop.tsx` | Desktop scores — list/detail multi-pane layout |
| `src/screens/StatsScreen.tsx` | Season leaders 2-column grid, season picker, regular/playoffs toggle |
| `src/screens/StandingsScreen.tsx` | East/West conference standings table (PPG, Opp PPG, Diff, Strk, L10) |
| `src/screens/PlayoffsScreen.tsx` | Bracket reconstructed from postseason game log + post-play-in seeding |
| `src/services/nbaApi.ts` | All backend HTTP calls + two-tier (memory + localStorage) cache |
| `src/hooks/useAsyncData.ts` | Generic data-loading hook with reload + cancellation |
| `src/hooks/useResponsiveLayout.ts` | Window-width based mobile/desktop layout switcher |
| `src/theme.ts` | Color/font/spacing/radii/breakpoint tokens |
| `src/navigation.ts` | Tab definitions |
| `src/webStyles.ts` | Web-only side-effect import that styles browser scrollbars |

**Backend** (Python 3.10+, FastAPI, `nba_api`)

| File | Purpose |
| --- | --- |
| `backend/main.py` | All endpoints + nba_api adapters + cdn.nba.com / ESPN overlay |
| `backend/requirements.txt` | `fastapi`, `uvicorn[standard]`, `nba_api` |

**Web build / hosting**

| File | Purpose |
| --- | --- |
| `public/manifest.webmanifest` | PWA manifest (display: standalone, theme color, icon set) |
| `public/icons/` | App icons (192, 512, maskable, apple-touch) |
| `scripts/postbuild-pwa.js` | Postbuild step that injects iOS standalone meta tags + viewport-fit=cover + position-fixed root layout into `dist/index.html` |
| `wrangler.jsonc` | Cloudflare Workers + Static Assets config (SPA fallback) |
| `.env.production` | `EXPO_PUBLIC_NBA_API_BASE_URL` baked into the production web bundle |

### Backend endpoints

All return `{ "data": ... }` unless noted.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Sanity check — `{ ok: true, teams_loaded: 30 }` |
| `GET` | `/teams` | All 30 NBA teams (id, abbreviation, conference, division, etc.) |
| `GET` | `/games?date=YYYY-MM-DD` | Games on a date with status, scores, ISO tip-off, postseason metadata |
| `GET` | `/leaders?stat=PTS&season=2025&season_type=Regular Season` | Top-25 league leaders for one stat (qualified per NBA rules) |
| `GET` | `/players?season=2025&season_type=Regular Season` | Full player list with per-game stats (powers the Stats modal) |
| `GET` | `/standings?season=2025` | Per-team conference/division ranks and full record splits |
| `GET` | `/playoffs?season=2025` | All postseason games for a season |
| `GET` | `/upcoming-playoff-games?season=2025` | Next scheduled game per playoff series (for the matchup card footer) |
| `GET` | `/boxscore?gameId=0022500100` | Per-team player box scores for one game |

`season` is the starting year — `2025` means the 2025–26 season. Stats categories are `PTS`, `REB`, `AST`, `STL`, `BLK`, `FG_PCT`, `FG3M`, `FG3_PCT`, `FT_PCT`. nba_api upstream errors come back as a clean HTTP `502` rather than a stack trace.

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

**Allow port 8000 through Windows Firewall** (one-time). The first time uvicorn binds to `0.0.0.0:8000`, Windows pops a firewall dialog — allow it on Private networks. If you missed it:

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

Expo Go in the App Store ships a runtime locked to one Expo SDK version. This project is pinned to **SDK 54** to match the publicly available Expo Go (54.0.2 as of Apr 2026). If you want to upgrade later:

1. Check the Expo Go version installed on your phone (App Store → your account → Expo Go).
2. If it's newer than 54, run from the repo root:
   ```powershell
   npx expo install expo@^<newer-major>
   npx expo install --fix
   ```
3. If your project SDK is newer than what Expo Go supports, you'll need a [development build](https://docs.expo.dev/develop/development-builds/introduction/) instead — `npx expo run:ios` / `run:android` — which bundles your own runtime.

## Things to know

- **Cold-start latency.** `stats.nba.com` typically takes 1–3 seconds per call. The backend caches `LeagueDashPlayerStats` for 5 minutes per (season, season_type), so the Stats screen is fast after the first load. If it's slow or 502s, that's upstream throttling — wait a moment and pull-to-refresh.
- **Two-tier client cache.** `src/services/nbaApi.ts` keeps an in-memory cache plus persists to `localStorage` on web with per-endpoint TTLs (teams 1h, standings 10min, leaders 5min, playoffs 5min, games 30s, boxscore none). Most tab switches feel instant after first load.
- **Past-date games.** `ScoreboardV2` doesn't always update its `GAME_STATUS_TEXT` for past dates, so the backend treats any game on a date strictly before today's ET date as `Final` regardless of what status text says.
- **Tip-off times.** Stored as ISO 8601 with the `America/New_York` offset, then formatted with `toLocaleTimeString()` on the device — so the user sees their own local time and timezone abbreviation (e.g., `7:30 PM PDT`). When nba_api returns `TBD`, the backend overlays ESPN's date-range scoreboard to recover the actual tip-off.
- **Live overlay.** While a game is active, the backend merges nba_api's `ScoreboardV2` with the live `cdn.nba.com` feed (and ESPN as a tiebreaker) using a `_pick_fresher` strategy, so quarter/clock/score stay current.
- **Game IDs are strings.** NBA game IDs have leading zeros (`0022500100`) — keep them as strings end-to-end or `/boxscore` lookups will fail.
- **Stat-leader qualification.** The backend filters `LeaguePlayerStats` so percentage leaders satisfy NBA's qualification thresholds (300 FGM, 82 3PM, 125 FTM, plus 70% of GP). Without this, low-volume specialists at 100% would show ahead of legitimate league leaders.
- **Playoff seeding.** The standings API only exposes `conference_rank` (regular-season standing). The Playoffs screen derives true post-play-in seeds from R1 matchups: top-6 use their conference rank, and seeds 7/8 are inferred from the rule that NBA bracket pairings always sum to 9 (1v8, 2v7, 3v6, 4v5).
- **Bracket pairing.** R1 series are placed by seed-based bracket position (1v8 → slot 0 / upper, 4v5 → slot 1, 3v6 → slot 2, 2v7 → slot 3 / bottom) so projections route correctly: 1/4-side meets in semis A, 2/3-side in semis B, both meet in the conference finals.

## Deploying

The current production stack:
- **Backend:** Oracle Cloud Always Free VM (Ubuntu 22.04) + Caddy reverse proxy with auto-HTTPS via Let's Encrypt + DuckDNS hostname.
- **Frontend:** Cloudflare Pages (free, default `*.pages.dev` subdomain).

Both are free indefinitely. The Oracle VM is ~$0/mo within Always Free limits; Cloudflare Pages has a generous free tier.

### Backend → Oracle Cloud

Full first-time setup:

#### 1. Create the VM

OCI Console (`cloud.oracle.com`) → Compute → Instances → Create Instance:
- **Image:** Canonical Ubuntu 22.04
- **Shape:** VM.Standard.E2.1.Micro (1 OCPU, 1 GB) — Always Free. (A1.Flex ARM is a much beefier free option if you want headroom: up to 4 OCPU / 24 GB.)
- **AD-3 / FD-2** (or any combination)
- **Networking:** new VCN with internet connectivity, **check "Assign a public IPv4 address"**
- **SSH keys:** generate or paste your public key

After it boots, on the instance's Networking tab, edit the primary VNIC's IPv4 entry to convert the **Ephemeral** public IP to **Reserved** (so it doesn't change). Note the IP.

#### 2. Sign up for DuckDNS, point at the IP

[duckdns.org](https://www.duckdns.org/) → claim a subdomain (e.g. `fastbreak-api.duckdns.org`) → enter your Oracle reserved IP → update.

#### 3. Open ports 80 + 443 in OCI Security List

VCN → Default Security List → Add Ingress Rules:

| Source CIDR | Protocol | Destination Port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

#### 4. SSH in and prep the OS

```powershell
# Lock down the private key on Windows (one-time)
icacls "$HOME\Desktop\ssh keys\ssh-key-XXXX.key" /inheritance:r
icacls "$HOME\Desktop\ssh keys\ssh-key-XXXX.key" /grant:r "$($env:USERNAME):(R)"

ssh -i "$HOME\Desktop\ssh keys\ssh-key-XXXX.key" ubuntu@<your-public-ip>
```

Once on the VM, open ports in Ubuntu's iptables. **Important:** Oracle's Ubuntu image has a `REJECT` rule near the top — your ACCEPT rules must go *above* it (insert position 5, not 6):

```bash
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Verify with `sudo iptables -L INPUT -n --line-numbers` — both ACCEPT rules must appear *above* the REJECT row.

#### 5. Add 2 GB swap (essential on 1 GB RAM)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

#### 6. Install dependencies + Caddy

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip git curl

# Caddy (reverse proxy + auto-HTTPS via Let's Encrypt)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

#### 7. Clone, install Python deps, run as systemd

```bash
cd ~
git clone https://github.com/<your-username>/fastbreak.git fastbreak
cd ~/fastbreak/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# systemd unit
sudo tee /etc/systemd/system/fastbreak.service > /dev/null <<'EOF'
[Unit]
Description=FastBreak NBA backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/fastbreak/backend
ExecStart=/home/ubuntu/fastbreak/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now fastbreak
```

Confirm the backend is alive on localhost: `curl http://127.0.0.1:8000/health`.

#### 8. Caddyfile

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
fastbreak-api.duckdns.org {
    reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl reload caddy
```

Caddy obtains a Let's Encrypt cert on first request (~10s). Watch with `sudo journalctl -u caddy -f` until you see `certificate obtained successfully`.

Verify from your laptop: `curl https://fastbreak-api.duckdns.org/health` → `{"ok":true,"teams_loaded":30}`.

### Backend updates (after first deploy)

Code-only changes:
```bash
ssh -i "$HOME\Desktop\ssh keys\ssh-key-XXXX.key" ubuntu@<ip>
cd ~/fastbreak && git pull
sudo systemctl restart fastbreak
```

If `requirements.txt` changed:
```bash
cd ~/fastbreak/backend
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart fastbreak
```

Logs / debugging:
```bash
sudo journalctl -u fastbreak -f       # backend
sudo journalctl -u caddy -f           # reverse proxy
free -h                               # memory pressure check
```

### Frontend → Cloudflare Pages

1. Push the repo to GitHub if it isn't already.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** → pick the repo.
3. Configure the build:
   - **Framework preset**: None
   - **Build command**: `npm run build:web`
   - **Build output directory**: `dist`
4. (Build-time env via committed file.) `.env.production` at the repo root sets `EXPO_PUBLIC_NBA_API_BASE_URL=https://fastbreak-api.duckdns.org` — Cloudflare's build picks it up automatically. No need to set it as a Pages environment variable.
5. Click **Save and Deploy**.

The first build takes ~2 min. Cloudflare gives a permanent URL like `https://fastbreak.pages.dev`. Every push to `master` redeploys automatically.

[wrangler.jsonc](wrangler.jsonc) controls how the static bundle is served. The key setting is `assets.not_found_handling: "single-page-application"` — this is the Workers + Static Assets system's SPA fallback, which serves `index.html` for any unknown route so client-side routing works on hard reloads and deep links.

### After deploying

- **Tighten CORS** later. In [backend/main.py](backend/main.py) change `allow_origins=["*"]` to `allow_origins=["https://fastbreak.pages.dev"]` (your actual Pages URL) and redeploy. The wildcard is fine while iterating but unnecessary in production.
- **Local dev still works.** `.env` is gitignored, so your LAN-IP setting doesn't ship to Cloudflare. The DuckDNS URL is in `.env.production` (committed) and only applies to the production build.
- **Watching logs.** `sudo journalctl -u fastbreak -f` on the VM, Cloudflare's "Deployments" tab for the frontend.

### DuckDNS keep-alive (optional)

DuckDNS may drop inactive subdomains. Refresh every 5 minutes via cron:

```bash
echo '*/5 * * * * curl -s "https://www.duckdns.org/update?domains=fastbreak-api&token=YOUR_TOKEN&ip=" > /dev/null' | crontab -
```

(Use your DuckDNS token — find it on the duckdns.org dashboard.)

## PWA / Add to Home Screen

The web build is configured as a Progressive Web App, so when iOS or Android users tap "Add to Home Screen" they get a standalone app icon that opens without browser chrome (no Safari address bar / tab strip).

### How it works

- [public/manifest.webmanifest](public/manifest.webmanifest) declares the app's name, theme color (`#050B14`), display mode (`standalone`), and icon set.
- [scripts/postbuild-pwa.js](scripts/postbuild-pwa.js) runs after `expo export --platform web` and:
  - Injects `<meta name="apple-mobile-web-app-capable" content="yes">` and related iOS-only tags into `dist/index.html` (iOS Safari only honors them in initial HTML, so a postbuild step is required).
  - Replaces the viewport meta with `viewport-fit=cover` (lets content extend under the status bar / home indicator).
  - Anchors `#root` to the four corners of the actual viewport with `position: fixed; inset: 0; display: flex; flex-direction: column` (see iOS PWA notes below).
- `npm run build:web` chains both steps.

### Icons

Drop PNGs into `public/icons/` so they're copied into `dist/icons/`:

| File | Size | Purpose |
| --- | --- | --- |
| `web-app-manifest-192x192.png` | 192×192 | Manifest (Android home screen) |
| `web-app-manifest-512x512.png` | 512×512 | Manifest (Android splash + larger surfaces, also marked maskable) |
| `apple-touch-icon.png` | 180×180 | iOS home screen icon |
| `favicon.ico` / `favicon-96x96.png` | various | Browser tab icon |

Easiest way to generate them all from a single source: [realfavicongenerator.net](https://realfavicongenerator.net/) — upload one square PNG (1024×1024), download the bundle, drop the files into `public/icons/`. Free, no signup.

### How users install it

- **iOS Safari:** Share button → "Add to Home Screen". Tapping the new icon opens FastBreak full-screen, no browser chrome. Looks and feels like a native app.
- **Android Chrome:** banner appears at the bottom suggesting "Install Fastbreak", or via the ⋮ menu → "Install app".
- **Desktop Chrome / Edge:** install icon appears in the address bar.

### iOS PWA gotchas (and how this app handles them)

iOS PWA standalone has several non-obvious quirks; if you're touching the chrome layout, know these:

1. **`react-native-web`'s `SafeAreaView` is wrong for our chrome.** It applies `env(safe-area-inset-*)` to its *outer* container, which leaves a strip of page background visible above the topbar / below the bottom nav. Apply env() padding *inside* each chrome element instead so its background extends edge-to-edge under the translucent status bar / home indicator. See the `webTopBarSafeArea` and `webBottomNavSafeArea` constants in [src/components/AppChrome.tsx](src/components/AppChrome.tsx).

2. **Bottom nav uses flex flow, not `position: absolute` or `position: fixed`** on web. Both of those positioning modes anchor to viewports that iOS resizes between launches, causing the nav to "creep up" between sessions. Solution: `#root` is `position: fixed; inset: 0; display: flex; flex-direction: column`, and the nav is a normal flex child at the end of the column — its position is determined by layout, not by viewport-relative anchoring.

3. **Don't size `#root` with vh/dvh/lvh/svh** — iOS PWA reports all of those as the *safe* viewport (excluding the home-indicator strip even with `viewport-fit=cover`). `position: fixed; inset: 0` sidesteps the unit ambiguity by pinning to actual viewport edges.

4. **Modal headers must own the safe-area inset** on web. RN's `<Modal>` renders fullscreen on web without honoring `env()`, so absolute-positioned X buttons end up trapped under the status bar / dynamic island. Both [BoxScoreModal](src/components/BoxScoreModal.tsx) and [PlayerLeadersModal](src/components/PlayerLeadersModal.tsx) apply `paddingTop: calc(env(safe-area-inset-top) + 16px)` to their headers on web only. Native iOS uses `presentationStyle="pageSheet"` which already insets, so the same code is a no-op there.

## Type-checking

```powershell
npm run typecheck
```

(There is no test suite or linter wired up yet.)
