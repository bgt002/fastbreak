export type NbaTeam = {
  id: number;
  conference: "East" | "West" | string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
};

export type NbaGame = {
  id: string;
  espn_event_id?: string | null;
  date: string;
  season: number;
  status: string;
  period: number | null;
  time: string | null;
  datetime: string | null;
  tip_off: string | null;
  postseason: boolean;
  if_necessary?: boolean;
  series_game_number?: number | null;
  series_label?: string | null;
  home_team_score: number;
  visitor_team_score: number;
  home_team: NbaTeam;
  visitor_team: NbaTeam;
};

export type NbaBoxScorePlayer = {
  player_id: number;
  name: string;
  starter: boolean;
  on_court: boolean;
  minutes: string | null;
  points: number;
  rebounds: number;
  oreb: number;
  dreb: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  plus_minus: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
};

export type NbaBoxScorePeriod = {
  period: number;
  score: number;
};

export type NbaBoxScoreTeam = {
  team: NbaTeam;
  score: number;
  players: NbaBoxScorePlayer[];
  periods: NbaBoxScorePeriod[];
};

export type NbaBoxScore = {
  game_id: string;
  teams: NbaBoxScoreTeam[];
};

export type NbaPlayer = {
  id: number;
  first_name: string;
  last_name: string;
  position?: string;
  team_id?: number;
  team?: NbaTeam | null;
};

export type NbaLeader = {
  player: NbaPlayer;
  value: number;
  stat_type: string;
  rank: number;
  season: number;
  games_played: number;
};

export type NbaPlayerSeasonStats = {
  player: NbaPlayer;
  games_played: number;
  minutes: number;
  stats: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
    fgm: number;
    fga: number;
    fg_pct: number;
    fg3m: number;
    fg3a: number;
    fg3_pct: number;
    ftm: number;
    fta: number;
    ft_pct: number;
    dd2: number;
    td3: number;
  };
  season: number;
};

export type NbaStanding = {
  team: NbaTeam;
  conference_record: string;
  conference_rank: number;
  division_record: string;
  division_rank: number;
  wins: number;
  losses: number;
  home_record: string;
  road_record: string;
  last_ten?: string;
  streak?: string;
  points_pg?: number;
  opp_points_pg?: number;
  diff_points_pg?: number;
  season: number;
};

export type NbaListResponse<T> = {
  data: T[];
};

export type StatType =
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "fg_pct"
  | "fg3m"
  | "fg3_pct"
  | "ft_pct";

export class NbaApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "NbaApiError";
    this.status = status;
  }
}

const baseUrl = process.env.EXPO_PUBLIC_NBA_API_BASE_URL?.trim().replace(/\/$/, "");

export function hasNbaApiBaseUrl() {
  return Boolean(baseUrl);
}

export function getCurrentNbaSeason(date = new Date()) {
  return date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

export function formatSeasonLabel(season: number) {
  return `${season}-${String(season + 1).slice(-2)}`;
}

export function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDateOptions(
  options: { daysBack?: number; daysForward?: number; anchor?: Date } = {}
) {
  const { daysBack = 30, daysForward = 30, anchor = new Date() } = options;
  const offsets = Array.from({ length: daysBack + daysForward + 1 }, (_, i) => i - daysBack);
  return offsets.map((offset) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() + offset);
    const isToday = offset === 0;

    return {
      id: formatIsoDate(date),
      weekday: isToday
        ? "Today"
        : date.toLocaleDateString(undefined, {
            weekday: "short"
          }),
      day: String(date.getDate())
    };
  });
}

export function playerHeadshotUri(playerId: number | string) {
  return `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png`;
}

export function teamLogoUri(team: Pick<NbaTeam, "abbreviation">) {
  const codeMap: Record<string, string> = {
    ATL: "atl",
    BOS: "bos",
    BKN: "bkn",
    CHA: "cha",
    CHI: "chi",
    CLE: "cle",
    DAL: "dal",
    DEN: "den",
    DET: "det",
    GSW: "gs",
    HOU: "hou",
    IND: "ind",
    LAC: "lac",
    LAL: "lal",
    MEM: "mem",
    MIA: "mia",
    MIL: "mil",
    MIN: "min",
    NOP: "no",
    NYK: "ny",
    OKC: "okc",
    ORL: "orl",
    PHI: "phi",
    PHX: "phx",
    POR: "por",
    SAC: "sac",
    SAS: "sa",
    TOR: "tor",
    UTA: "utah",
    WAS: "wsh"
  };

  return `https://a.espncdn.com/i/teamlogos/nba/500/${codeMap[team.abbreviation] ?? team.abbreviation.toLowerCase()}.png`;
}

export function playerName(player: Pick<NbaPlayer, "first_name" | "last_name">) {
  return `${player.first_name} ${player.last_name}`.trim();
}

export function playerInitials(player: Pick<NbaPlayer, "first_name" | "last_name">) {
  return `${player.first_name[0] ?? ""}${player.last_name[0] ?? ""}`.toUpperCase();
}

export function formatLeaderValue(statType: StatType, value: number) {
  if (statType === "fg_pct" || statType === "fg3_pct" || statType === "ft_pct") {
    const pct = value > 1 ? value : value * 100;
    return `${pct.toFixed(1)}%`;
  }

  return value.toFixed(1);
}

export function getGameState(game: NbaGame): "live" | "upcoming" | "final" {
  const status = game.status.toLowerCase();
  if (status.includes("final")) {
    return "final";
  }

  if ((game.period ?? 0) > 0 || Boolean(game.time?.trim())) {
    return "live";
  }

  return "upcoming";
}

export function getGameClockLabel(game: NbaGame) {
  const state = getGameState(game);
  if (state === "final") {
    return "Final";
  }

  if (state === "upcoming") {
    return formatTipOff(game) ?? game.status ?? "Scheduled";
  }

  const status = game.status?.trim() ?? "";
  const time = game.time?.trim() ?? "";
  if (!time) return status;
  // Live status like "Q3 5:32", "Q3 :03.3", or "Q4 39.8" already contains the
  // clock. Skip appending `time` if the status either has a clock pattern,
  // already includes the time string, or starts with a period prefix.
  if (/:\d{2}/.test(status)) return status;
  if (status.includes(time)) return status;
  if (/^(Q\d|OT\d)/i.test(status)) return status;
  return `${status} - ${time}`;
}

export function formatTipOff(game: NbaGame): string | null {
  if (!game.tip_off) {
    return null;
  }
  const date = new Date(game.tip_off);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function calculatePct(wins: number, losses: number) {
  const total = wins + losses;
  if (total === 0) {
    return ".000";
  }

  return (wins / total).toFixed(3).replace(/^0/, "");
}

export function calculateGamesBack(team: NbaStanding, leader?: NbaStanding) {
  if (!leader || team.team.id === leader.team.id) {
    return "-";
  }

  const gamesBack = (leader.wins - team.wins + team.losses - leader.losses) / 2;
  return gamesBack.toFixed(gamesBack % 1 === 0 ? 0 : 1);
}

export async function getTeams() {
  return withCache(
    "teams",
    ONE_HOUR,
    async () => {
      const response = await request<NbaListResponse<NbaTeam>>("/teams");
      return response.data;
    },
    { persist: true }
  );
}

// Per-date game cache with date-aware TTL:
//   - today: 30s — short so live score polling stays current
//   - past:  1 hour — already-final games rarely change; persist so revisiting
//            a previously-viewed date is instant across navigation/sessions
//   - future: 5 min — schedule could shift but rarely intra-day
// withCache also falls back to last-known data when the network fetch fails,
// so flipping back to a previously-loaded date during an upstream blip still
// shows scores instead of an error state.
function gamesTtl(date: string): number {
  const today = formatIsoDate(new Date());
  if (date === today) return ONE_MIN / 2;
  if (date < today) return ONE_HOUR;
  return FIVE_MIN;
}

export async function getGamesByDate(date: string) {
  return withCache(
    `games:${date}`,
    gamesTtl(date),
    async () => {
      const response = await request<NbaListResponse<NbaGame>>("/games", { date });
      return response.data;
    },
    { persist: true }
  );
}

// Fire-and-forget prefetch. Used to warm neighbor dates in the background so
// scrolling between days feels instant. Failures are swallowed silently —
// prefetching is best-effort.
export function prefetchGamesByDate(date: string): void {
  void getGamesByDate(date).catch(() => {
    // Network blip on a prefetch is no big deal; the user's actual fetch
    // (when they navigate to that date) will retry on its own.
  });
}

export async function getPostseasonGames(season: number) {
  return withCache(
    `playoffs:${season}`,
    FIVE_MIN,
    async () => {
      const response = await request<NbaListResponse<NbaGame>>("/playoffs", { season });
      return response.data;
    },
    { persist: true }
  );
}

export async function getLeaders(
  statType: StatType,
  season: number,
  seasonType: "regular" | "playoffs" = "regular"
) {
  return withCache(`leaders:${season}:${seasonType}:${statType}`, FIVE_MIN, async () => {
    const response = await request<NbaListResponse<NbaLeader>>("/leaders", {
      season,
      stat: statType.toUpperCase(),
      season_type: seasonType === "playoffs" ? "Playoffs" : "Regular Season"
    });
    return response.data;
  });
}

export async function getStandings(season: number) {
  return withCache(
    `standings:${season}`,
    TEN_MIN,
    async () => {
      const response = await request<NbaListResponse<NbaStanding>>("/standings", { season });
      return response.data;
    },
    { persist: true }
  );
}

export async function getPlayerSeasonStats(season: number, seasonType: "regular" | "playoffs" = "regular") {
  return withCache(
    `players:${season}:${seasonType}`,
    FIVE_MIN,
    async () => {
      const response = await request<NbaListResponse<NbaPlayerSeasonStats>>("/players", {
        season,
        season_type: seasonType === "playoffs" ? "Playoffs" : "Regular Season"
      });
      return response.data;
    },
    { persist: true }
  );
}

// Final games are immutable — cache hard so revisiting a previously-viewed
// box score (today's earlier games, yesterday's, last week's) is instant. For
// live games we deliberately skip the cache: the modal's 5s polling keeps the
// table current and the manual refresh button always hits fresh data, which
// would feel broken if the cache returned stale rows.
export async function getBoxScore(
  game: Pick<NbaGame, "id" | "espn_event_id">,
  gameState?: "live" | "upcoming" | "final"
) {
  const params = { gameId: game.id, espnEventId: game.espn_event_id ?? undefined };
  if (gameState === "final") {
    return withCache(
      `boxscore:${game.id}:${game.espn_event_id ?? ""}`,
      ONE_HOUR,
      async () => {
        const response = await request<{ data: NbaBoxScore }>("/boxscore", params);
        return response.data;
      },
      { persist: true }
    );
  }
  const response = await request<{ data: NbaBoxScore }>("/boxscore", params);
  return response.data;
}

export async function getUpcomingPlayoffGames(season: number, days = 14) {
  return withCache(`upcoming:${season}:${days}`, FIVE_MIN, async () => {
    const response = await request<NbaListResponse<NbaUpcomingPlayoffGame>>(
      "/upcoming-playoff-games",
      { season, days }
    );
    return response.data;
  });
}

export type NbaUpcomingPlayoffGame = {
  visitor_abbr: string;
  home_abbr: string;
  date: string | null;
  tip_off: string | null;
  if_necessary: boolean;
  series_game_number: number | null;
  season: number;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
// Two-tier cache:
//   1. In-memory Map keyed by request signature; clears on app reload.
//   2. localStorage write-through for endpoints flagged with `persist: true`,
//      so a fresh tab/PWA session boots with last-known data immediately.
// Live endpoints (/games, /boxscore) skip the cache entirely so polling stays
// responsive — only the static-ish stuff (teams, standings, season stats) is
// cached. Bumping STORAGE_VERSION invalidates persisted data after a shape
// change.

type CacheEntry<T> = { data: T; expiresAt: number };

const memCache = new Map<string, CacheEntry<unknown>>();
const MEM_CACHE_MAX = 100;
// Bump this whenever the JSON shape of any persist:true endpoint changes —
// or when cached *values* could be wrong (e.g., the playoff-series miscount
// fix). Old `v1:` entries become orphans; browsers GC them eventually.
const STORAGE_PREFIX = "fb:cache:v3:";

function readPersistedEntry<T>(key: string): CacheEntry<T> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writePersistedEntry<T>(key: string, entry: CacheEntry<T>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // QuotaExceededError or private-mode lockout — silently fall through, the
    // in-memory cache is still doing its job for the rest of the session.
  }
}

// Map iteration order is insertion order, so the oldest entries are first.
// We use that to do FIFO eviction once the cache crosses MEM_CACHE_MAX.
// Heavy session use (visiting many distinct dates) won't grow unbounded.
function setMemEntry<T>(key: string, entry: CacheEntry<T>): void {
  memCache.set(key, entry);
  if (memCache.size > MEM_CACHE_MAX) {
    const overflow = memCache.size - MEM_CACHE_MAX;
    const it = memCache.keys();
    for (let i = 0; i < overflow; i++) {
      const next = it.next();
      if (next.done) break;
      memCache.delete(next.value);
    }
  }
}

async function withCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options: { persist?: boolean } = {}
): Promise<T> {
  const now = Date.now();

  // Read both cache layers up front so we can fall back to either on failure.
  const memHit = memCache.get(key) as CacheEntry<T> | undefined;
  const persisted = options.persist ? readPersistedEntry<T>(key) : null;

  if (memHit && memHit.expiresAt > now) {
    return memHit.data;
  }

  if (persisted && persisted.expiresAt > now) {
    setMemEntry(key, persisted);
    return persisted.data;
  }

  // Cache is stale or empty — try a fresh fetch. If that fails AND we have
  // any cached copy (even expired), return it instead of erroring. Keeps the
  // app showing last-known data through transient upstream blips.
  try {
    const data = await fetcher();
    const entry: CacheEntry<T> = { data, expiresAt: now + ttlMs };
    setMemEntry(key, entry);
    if (options.persist) writePersistedEntry(key, entry);
    return data;
  } catch (err) {
    if (memHit) return memHit.data;
    if (persisted) {
      setMemEntry(key, persisted);
      return persisted.data;
    }
    throw err;
  }
}

const ONE_MIN = 60 * 1000;
const FIVE_MIN = 5 * ONE_MIN;
const TEN_MIN = 10 * ONE_MIN;
const ONE_HOUR = 60 * ONE_MIN;

type QueryValue = boolean | number | string | undefined;

async function request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  if (!baseUrl) {
    throw new NbaApiError(
      "Missing NBA API base URL. Add EXPO_PUBLIC_NBA_API_BASE_URL to your local .env file (e.g., http://192.168.1.50:8000)."
    );
  }

  const query = buildQuery(params);
  const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;

  let response: Response;
  try {
    // cache: "no-store" so live endpoints (/games, /boxscore) always hit the
    // backend and aren't served stale from the browser HTTP cache. We have
    // our own withCache layer for endpoints that benefit from caching.
    response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    throw new NbaApiError(
      `Could not reach the NBA API backend at ${baseUrl}. Is the FastAPI server running and reachable from this device?`
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new NbaApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

function buildQuery(params: Record<string, QueryValue>) {
  const pairs: string[] = [];

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  });

  return pairs.join("&");
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string; error?: string; message?: string };
    const detail = body.detail ?? body.error ?? body.message;
    if (detail) {
      return `NBA API ${response.status}: ${detail}`;
    }
  } catch {
    // Fall through.
  }

  return `NBA API request failed with status ${response.status}.`;
}
