export type GameStatus = "live" | "upcoming" | "final";

export type Team = {
  abbreviation: string;
  logoUri: string;
};

export type Game = {
  id: string;
  status: GameStatus;
  away: Team;
  home: Team;
  awayScore?: number;
  homeScore?: number;
  clockLabel: string;
  possession?: string;
  broadcast?: string;
  leaders?: [string, string];
};

export type NewsItem = {
  id: string;
  category: string;
  title: string;
  imageUri?: string;
  featured?: boolean;
};

export const dateOptions = [
  { id: "mon", weekday: "Mon", day: "12" },
  { id: "tue", weekday: "Tue", day: "13" },
  { id: "today", weekday: "Today", day: "14" },
  { id: "thu", weekday: "Thu", day: "15" },
  { id: "fri", weekday: "Fri", day: "16" },
  { id: "sat", weekday: "Sat", day: "17" }
];

const logoBase = "https://a.espncdn.com/i/teamlogos/nba/500";

export const games: Game[] = [
  {
    id: "lal-gsw",
    status: "live",
    away: { abbreviation: "LAL", logoUri: `${logoBase}/lal.png` },
    home: { abbreviation: "GSW", logoUri: `${logoBase}/gs.png` },
    awayScore: 108,
    homeScore: 112,
    clockLabel: "4Q - 2:45",
    possession: "GSW",
    leaders: ["Curry: 32 PTS", "Davis: 24 PTS, 14 REB"]
  },
  {
    id: "bos-mia",
    status: "upcoming",
    away: { abbreviation: "BOS", logoUri: `${logoBase}/bos.png` },
    home: { abbreviation: "MIA", logoUri: `${logoBase}/mia.png` },
    clockLabel: "07:30",
    broadcast: "TNT"
  },
  {
    id: "phx-den",
    status: "final",
    away: { abbreviation: "PHX", logoUri: `${logoBase}/phx.png` },
    home: { abbreviation: "DEN", logoUri: `${logoBase}/den.png` },
    awayScore: 124,
    homeScore: 129,
    clockLabel: "FINAL"
  },
  {
    id: "dal-mil",
    status: "upcoming",
    away: { abbreviation: "DAL", logoUri: `${logoBase}/dal.png` },
    home: { abbreviation: "MIL", logoUri: `${logoBase}/mil.png` },
    clockLabel: "08:00",
    broadcast: "ESPN"
  }
];

export const news: NewsItem[] = [
  {
    id: "deadline",
    category: "Breaking",
    title: "Trade Deadline Rumors: 5 Moves to Watch",
    imageUri: "https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=1200&q=80",
    featured: true
  },
  {
    id: "rookies",
    category: "Analysis",
    title: "Rookie Power Rankings"
  },
  {
    id: "injury",
    category: "Injury Report",
    title: "Embiid expected to return"
  }
];
