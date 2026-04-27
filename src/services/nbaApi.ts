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
  date: string;
  season: number;
  status: string;
  period: number | null;
  time: string | null;
  datetime: string | null;
  tip_off: string | null;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: NbaTeam;
  visitor_team: NbaTeam;
};

export type NbaBoxScorePlayer = {
  player_id: number;
  name: string;
  starter: boolean;
  minutes: string | null;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
};

export type NbaBoxScoreTeam = {
  team: NbaTeam;
  score: number;
  players: NbaBoxScorePlayer[];
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
  season: number;
};

export type NbaListResponse<T> = {
  data: T[];
};

export type StatType = "pts" | "reb" | "ast" | "stl" | "blk" | "fg_pct";

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

export function buildDateOptions(anchor = new Date()) {
  return [-2, -1, 0, 1, 2, 3].map((offset) => {
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
  if (statType === "fg_pct") {
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

  return [game.status, game.time?.trim()].filter(Boolean).join(" - ");
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
    minute: "2-digit",
    timeZoneName: "short"
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
  const response = await request<NbaListResponse<NbaTeam>>("/teams");
  return response.data;
}

export async function getGamesByDate(date: string) {
  const response = await request<NbaListResponse<NbaGame>>("/games", { date });
  return response.data;
}

export async function getPostseasonGames(season: number) {
  const response = await request<NbaListResponse<NbaGame>>("/playoffs", { season });
  return response.data;
}

export async function getLeaders(
  statType: StatType,
  season: number,
  seasonType: "regular" | "playoffs" = "regular"
) {
  const response = await request<NbaListResponse<NbaLeader>>("/leaders", {
    season,
    stat: statType.toUpperCase(),
    season_type: seasonType === "playoffs" ? "Playoffs" : "Regular Season"
  });

  return response.data;
}

export async function getStandings(season: number) {
  const response = await request<NbaListResponse<NbaStanding>>("/standings", { season });
  return response.data;
}

export async function getBoxScore(gameId: string) {
  const response = await request<{ data: NbaBoxScore }>("/boxscore", { gameId });
  return response.data;
}

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
    response = await fetch(url, { headers: { Accept: "application/json" } });
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
