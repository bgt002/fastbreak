import type { ComponentProps } from "react";

import Ionicons from "@expo/vector-icons/Ionicons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type StatLeader = {
  id: string;
  rank: number;
  name: string;
  team: string;
  value: string;
  imageUri: string;
};

export type StatCategory = {
  id: string;
  title: string;
  icon: IoniconName;
  leaders: StatLeader[];
};

export type CompactStat = {
  id: string;
  label: string;
  player: string;
  value: string;
  featured?: boolean;
};

export type StandingRow = {
  id: string;
  rank: number;
  team: string;
  note: string;
  icon: IoniconName;
  w: number;
  l: number;
  pct: string;
  gb: string;
  streak: string;
  l10: string;
  home: string;
  away: string;
  conf: string;
  div: string;
  ppg: string;
  opp: string;
  diff: string;
};

export type Conference = "east" | "west";

export type PlayoffTeam = {
  seed?: number;
  abbreviation: string;
  score: number;
  winner?: boolean;
};

export type PlayoffMatchup = {
  id: string;
  teams: [PlayoffTeam, PlayoffTeam];
};

export type PlayoffColumn = {
  id: string;
  title: string;
  spacing?: "tight" | "wide";
  matchups: PlayoffMatchup[];
};

const headshotBase = "https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full";

export const statCategories: StatCategory[] = [
  {
    id: "points",
    title: "Points per Game",
    icon: "trending-up-outline",
    leaders: [
      {
        id: "luka-points",
        rank: 1,
        name: "Luka Doncic",
        team: "Dallas Mavericks",
        value: "33.9",
        imageUri: `${headshotBase}/3945274.png&w=120&h=120`
      },
      {
        id: "sga-points",
        rank: 2,
        name: "S. Gilgeous-Alexander",
        team: "OKC",
        value: "30.1",
        imageUri: `${headshotBase}/4278073.png&w=120&h=120`
      },
      {
        id: "giannis-points",
        rank: 3,
        name: "Giannis Antetokounmpo",
        team: "MIL",
        value: "29.8",
        imageUri: `${headshotBase}/3032977.png&w=120&h=120`
      }
    ]
  },
  {
    id: "rebounds",
    title: "Rebounds per Game",
    icon: "radio-button-on-outline",
    leaders: [
      {
        id: "sabonis-rebounds",
        rank: 1,
        name: "Domantas Sabonis",
        team: "Sacramento Kings",
        value: "13.7",
        imageUri: `${headshotBase}/3155942.png&w=120&h=120`
      },
      {
        id: "gobert-rebounds",
        rank: 2,
        name: "Rudy Gobert",
        team: "MIN",
        value: "12.9",
        imageUri: `${headshotBase}/3032976.png&w=120&h=120`
      },
      {
        id: "jokic-rebounds",
        rank: 3,
        name: "Nikola Jokic",
        team: "DEN",
        value: "12.4",
        imageUri: `${headshotBase}/3112335.png&w=120&h=120`
      }
    ]
  },
  {
    id: "assists",
    title: "Assists per Game",
    icon: "share-social-outline",
    leaders: [
      {
        id: "haliburton-assists",
        rank: 1,
        name: "Tyrese Haliburton",
        team: "Indiana Pacers",
        value: "10.9",
        imageUri: `${headshotBase}/4396993.png&w=120&h=120`
      },
      {
        id: "trae-assists",
        rank: 2,
        name: "Trae Young",
        team: "ATL",
        value: "10.8",
        imageUri: `${headshotBase}/4277905.png&w=120&h=120`
      },
      {
        id: "luka-assists",
        rank: 3,
        name: "Luka Doncic",
        team: "DAL",
        value: "9.8",
        imageUri: `${headshotBase}/3945274.png&w=120&h=120`
      }
    ]
  }
];

export const compactStats: CompactStat[] = [
  { id: "steals", label: "Steals Leader", player: "S. Gilgeous-Alexander", value: "2.1", featured: true },
  { id: "blocks", label: "Blocks Leader", player: "V. Wembanyama", value: "3.4" },
  { id: "fg", label: "FG% Leader", player: "Daniel Gafford", value: "72.5%" }
];

export const standings: Record<Conference, StandingRow[]> = {
  east: [
    {
      id: "bos",
      rank: 1,
      team: "Boston Celtics",
      note: "x - clinched",
      icon: "shield-outline",
      w: 64,
      l: 18,
      pct: ".780",
      gb: "-",
      streak: "W2",
      l10: "7-3",
      home: "37-4",
      away: "27-14",
      conf: "41-11",
      div: "15-2",
      ppg: "120.6",
      opp: "109.2",
      diff: "+11.4"
    },
    {
      id: "nyk",
      rank: 2,
      team: "New York Knicks",
      note: "x - clinched",
      icon: "star-outline",
      w: 50,
      l: 32,
      pct: ".610",
      gb: "14.0",
      streak: "W5",
      l10: "6-4",
      home: "27-14",
      away: "23-18",
      conf: "35-17",
      div: "12-4",
      ppg: "112.8",
      opp: "108.2",
      diff: "+4.6"
    },
    {
      id: "mil",
      rank: 3,
      team: "Milwaukee Bucks",
      note: "x - clinched",
      icon: "flash-outline",
      w: 49,
      l: 33,
      pct: ".598",
      gb: "15.0",
      streak: "L2",
      l10: "3-7",
      home: "31-11",
      away: "18-22",
      conf: "34-18",
      div: "10-7",
      ppg: "119.0",
      opp: "116.4",
      diff: "+2.6"
    },
    {
      id: "phi",
      rank: 7,
      team: "Philly 76ers",
      note: "pi - play-in",
      icon: "flame-outline",
      w: 47,
      l: 35,
      pct: ".573",
      gb: "17.0",
      streak: "W8",
      l10: "8-2",
      home: "25-16",
      away: "22-19",
      conf: "31-21",
      div: "8-8",
      ppg: "114.6",
      opp: "111.5",
      diff: "+3.1"
    }
  ],
  west: [
    {
      id: "okc",
      rank: 1,
      team: "Oklahoma City Thunder",
      note: "x - clinched",
      icon: "thunderstorm-outline",
      w: 57,
      l: 25,
      pct: ".695",
      gb: "-",
      streak: "W5",
      l10: "8-2",
      home: "33-8",
      away: "24-17",
      conf: "36-16",
      div: "12-4",
      ppg: "120.1",
      opp: "112.7",
      diff: "+7.4"
    },
    {
      id: "den",
      rank: 2,
      team: "Denver Nuggets",
      note: "x - clinched",
      icon: "podium-outline",
      w: 57,
      l: 25,
      pct: ".695",
      gb: "-",
      streak: "W1",
      l10: "7-3",
      home: "33-8",
      away: "24-17",
      conf: "33-19",
      div: "10-6",
      ppg: "114.9",
      opp: "109.6",
      diff: "+5.3"
    },
    {
      id: "min",
      rank: 3,
      team: "Minnesota Timberwolves",
      note: "x - clinched",
      icon: "shield-checkmark-outline",
      w: 56,
      l: 26,
      pct: ".683",
      gb: "1.0",
      streak: "L1",
      l10: "6-4",
      home: "30-11",
      away: "26-15",
      conf: "37-15",
      div: "12-4",
      ppg: "113.0",
      opp: "106.5",
      diff: "+6.5"
    },
    {
      id: "lal",
      rank: 7,
      team: "Los Angeles Lakers",
      note: "pi - play-in",
      icon: "sparkles-outline",
      w: 47,
      l: 35,
      pct: ".573",
      gb: "10.0",
      streak: "W2",
      l10: "7-3",
      home: "28-14",
      away: "19-21",
      conf: "27-25",
      div: "8-8",
      ppg: "118.0",
      opp: "117.4",
      diff: "+0.6"
    }
  ]
};

export const standingsColumns = [
  { key: "w", label: "W", width: 44 },
  { key: "l", label: "L", width: 44 },
  { key: "pct", label: "PCT", width: 58 },
  { key: "gb", label: "GB", width: 56 },
  { key: "streak", label: "STRK", width: 62 },
  { key: "l10", label: "L10", width: 58 },
  { key: "home", label: "Home", width: 66 },
  { key: "away", label: "Away", width: 66 },
  { key: "conf", label: "Conf", width: 66 },
  { key: "div", label: "Div", width: 58 },
  { key: "ppg", label: "PPG", width: 68 },
  { key: "opp", label: "Opp PPG", width: 78 },
  { key: "diff", label: "Diff", width: 62 }
] as const;

export const playoffColumns: PlayoffColumn[] = [
  {
    id: "west-r1",
    title: "West Round 1",
    matchups: [
      { id: "okc-nop", teams: [{ seed: 1, abbreviation: "OKC", score: 4, winner: true }, { seed: 8, abbreviation: "NOP", score: 0 }] },
      { id: "lac-dal", teams: [{ seed: 4, abbreviation: "LAC", score: 2 }, { seed: 5, abbreviation: "DAL", score: 4, winner: true }] },
      { id: "min-phx", teams: [{ seed: 3, abbreviation: "MIN", score: 4, winner: true }, { seed: 6, abbreviation: "PHX", score: 0 }] },
      { id: "den-lal", teams: [{ seed: 2, abbreviation: "DEN", score: 4, winner: true }, { seed: 7, abbreviation: "LAL", score: 1 }] }
    ]
  },
  {
    id: "west-semis",
    title: "Semis",
    spacing: "wide",
    matchups: [
      { id: "okc-dal", teams: [{ abbreviation: "OKC", score: 2 }, { abbreviation: "DAL", score: 4, winner: true }] },
      { id: "min-den", teams: [{ abbreviation: "MIN", score: 4, winner: true }, { abbreviation: "DEN", score: 3 }] }
    ]
  },
  {
    id: "east-semis",
    title: "Semis",
    spacing: "wide",
    matchups: [
      { id: "bos-cle", teams: [{ abbreviation: "BOS", score: 4, winner: true }, { abbreviation: "CLE", score: 1 }] },
      { id: "nyk-ind", teams: [{ abbreviation: "NYK", score: 3 }, { abbreviation: "IND", score: 4, winner: true }] }
    ]
  },
  {
    id: "east-r1",
    title: "East Round 1",
    matchups: [
      { id: "bos-mia", teams: [{ seed: 1, abbreviation: "BOS", score: 4, winner: true }, { seed: 8, abbreviation: "MIA", score: 1 }] },
      { id: "cle-orl", teams: [{ seed: 4, abbreviation: "CLE", score: 4 }, { seed: 5, abbreviation: "ORL", score: 3, winner: true }] },
      { id: "mil-ind", teams: [{ seed: 3, abbreviation: "MIL", score: 2 }, { seed: 6, abbreviation: "IND", score: 4, winner: true }] },
      { id: "nyk-phi", teams: [{ seed: 2, abbreviation: "NYK", score: 4, winner: true }, { seed: 7, abbreviation: "PHI", score: 2 }] }
    ]
  }
];

export const playoffLeaders = [
  { id: "pts", label: "PTS: Doncic", value: "28.8" },
  { id: "reb", label: "REB: Jokic", value: "13.4" },
  { id: "ast", label: "AST: Haliburton", value: "8.2" }
];
