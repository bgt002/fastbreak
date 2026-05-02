import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { NAV_CLEARANCE } from "../components/AppChrome";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getCurrentNbaSeason,
  getGameState,
  getPostseasonGames,
  getStandings,
  getUpcomingPlayoffGames,
  teamLogoUri,
  type NbaGame,
  type NbaStanding,
  type NbaTeam,
  type NbaUpcomingPlayoffGame
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";

type SeriesBucket = "East" | "West" | "Finals";

type PlayoffSeries = {
  id: string;
  teamA: NbaTeam;
  teamB: NbaTeam;
  scoreA: number;
  scoreB: number;
  winner?: "A" | "B";
  bucket: SeriesBucket;
  earliestDate: number;
};

// A slot in the bracket can be a real series (games being played or done),
// a preview where one or both teams are known but the series hasn't started
// yet, or null (full TBD).
type BracketSlot =
  | { type: "series"; series: PlayoffSeries }
  | { type: "preview"; teamA: NbaTeam | null; teamB: NbaTeam | null }
  | null;

type BracketColumnSpec = {
  id: string;
  title: string;
  spacing?: "tight" | "wide" | "wider";
  series: BracketSlot[];
};

type PlayoffData = {
  westR1: BracketSlot[];
  westSemis: BracketSlot[];
  westCf: BracketSlot[];
  eastR1: BracketSlot[];
  eastSemis: BracketSlot[];
  eastCf: BracketSlot[];
  finals: BracketSlot;
  // Lookups passed through to MatchupCard so it can show seed numbers and
  // next-game info without each card needing to fetch on its own.
  seedByTeamId: Map<number, number>;
  nextGameByPair: Map<string, NbaUpcomingPlayoffGame>;
};

const season = getCurrentNbaSeason();

export function PlayoffsScreen() {
  const { data, error, loading, reload, silentReload } = useAsyncData(loadPlayoffData, []);
  const [refreshing, setRefreshing] = useState(false);

  const handlePullRefresh = useCallback(async () => {
    setRefreshing(true);
    await silentReload();
    setRefreshing(false);
  }, [silentReload]);

  const westColumns = useMemo<BracketColumnSpec[]>(
    () =>
      data
        ? [
            { id: "west-r1", title: "West Round 1", series: data.westR1 },
            { id: "west-semis", title: "West Semis", spacing: "wide", series: data.westSemis },
            { id: "west-cf", title: "West Finals", spacing: "wider", series: data.westCf }
          ]
        : [],
    [data]
  );
  const eastColumns = useMemo<BracketColumnSpec[]>(
    () =>
      data
        ? [
            { id: "east-cf", title: "East Finals", spacing: "wider", series: data.eastCf },
            { id: "east-semis", title: "East Semis", spacing: "wide", series: data.eastSemis },
            { id: "east-r1", title: "East Round 1", series: data.eastR1 }
          ]
        : [],
    [data]
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { paddingBottom: NAV_CLEARANCE as number }]}
      refreshControl={
        <RefreshControl onRefresh={handlePullRefresh} refreshing={refreshing} tintColor={colors.secondary} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{season + 1} Playoffs</Text>
      </View>

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {!loading && !error && data && isBracketEmpty(data) ? (
        <EmptyState message="No postseason games available for this season yet." title="No Playoffs" />
      ) : null}

      {!loading && !error && data && !isBracketEmpty(data) ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.bracketScroller}>
            {westColumns.map((column) => (
              <BracketColumn
                column={column}
                key={column.id}
                seedByTeamId={data.seedByTeamId}
                nextGameByPair={data.nextGameByPair}
              />
            ))}

            <FinalsCard finals={data.finals} />

            {eastColumns.map((column) => (
              <BracketColumn
                column={column}
                key={column.id}
                seedByTeamId={data.seedByTeamId}
                nextGameByPair={data.nextGameByPair}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
}

async function loadPlayoffData(): Promise<PlayoffData> {
  // Fire all three calls in parallel; gracefully degrade if standings or
  // upcoming games are unavailable (the bracket is still useful without seeds
  // or next-game footer).
  const [games, standings, upcoming] = await Promise.all([
    getPostseasonGames(season),
    getStandings(season).catch((): NbaStanding[] => []),
    getUpcomingPlayoffGames(season).catch((): NbaUpcomingPlayoffGame[] => [])
  ]);

  const confRankByTeamId = new Map<number, number>();
  standings.forEach((s) => confRankByTeamId.set(s.team.id, s.conference_rank));

  const nextGameByPair = buildNextGameMap(upcoming);

  const seriesList = aggregateSeries(games);
  const rounds = classifyRounds(seriesList);

  const westSeries = seriesList
    .filter((s) => s.bucket === "West")
    .sort((a, b) => a.earliestDate - b.earliestDate);
  const eastSeries = seriesList
    .filter((s) => s.bucket === "East")
    .sort((a, b) => a.earliestDate - b.earliestDate);
  const finalsSeries = seriesList.find((s) => s.bucket === "Finals") ?? null;

  // Derive actual playoff seeds rather than using regular-season conference
  // rank directly — conference_rank doesn't reflect play-in results, where
  // the 7/8 seeds get reshuffled (e.g. POR finishing reg-season #8 but
  // becoming the #7 playoff seed by winning the play-in). The top 6 are
  // never affected by play-in, and the bracket pairings always sum to 9
  // (1v8, 2v7, 3v6, 4v5), so we can infer seeds 7/8 from R1 matchups.
  const r1ForSeedDerivation = [
    ...westSeries.filter((s) => rounds.get(s.id) === 1),
    ...eastSeries.filter((s) => rounds.get(s.id) === 1)
  ];
  const seedByTeamId = derivePlayoffSeeds(r1ForSeedDerivation, confRankByTeamId);

  const westR1 = orderR1BySeed(westSeries.filter((s) => rounds.get(s.id) === 1), seedByTeamId);
  const westSemisRaw = orderSemisBySeed(westSeries.filter((s) => rounds.get(s.id) === 2), seedByTeamId);
  const westCfRaw = padRound(westSeries.filter((s) => rounds.get(s.id) === 3), 1);
  const eastR1 = orderR1BySeed(eastSeries.filter((s) => rounds.get(s.id) === 1), seedByTeamId);
  const eastSemisRaw = orderSemisBySeed(eastSeries.filter((s) => rounds.get(s.id) === 2), seedByTeamId);
  const eastCfRaw = padRound(eastSeries.filter((s) => rounds.get(s.id) === 3), 1);

  // Standard NBA bracket: R1 ordering [1v8, 4v5, 3v6, 2v7] feeds semis as
  // (1v8 winner) vs (4v5 winner) and (2v7 winner) vs (3v6 winner). Semis
  // ordering matches: westSemis[0] is the 1/4-side, westSemis[1] is the 2/3-side.
  // Seed-based ordering above keeps these pairings correct so e.g. OKC (1)
  // can never get projected against SAS (a 2/3-side team) until the
  // conference finals.
  const westSemis = [
    project(westR1[0], westR1[1], westSemisRaw[0]),
    project(westR1[2], westR1[3], westSemisRaw[1])
  ];
  const eastSemis = [
    project(eastR1[0], eastR1[1], eastSemisRaw[0]),
    project(eastR1[2], eastR1[3], eastSemisRaw[1])
  ];
  const westCf = [project(westSemisRaw[0], westSemisRaw[1], westCfRaw[0])];
  const eastCf = [project(eastSemisRaw[0], eastSemisRaw[1], eastCfRaw[0])];
  const finals = project(westCfRaw[0], eastCfRaw[0], finalsSeries);

  return {
    westR1: westR1.map(toSeriesSlot),
    westSemis,
    westCf,
    eastR1: eastR1.map(toSeriesSlot),
    eastSemis,
    eastCf,
    finals,
    seedByTeamId,
    nextGameByPair
  };
}

function buildNextGameMap(
  upcoming: NbaUpcomingPlayoffGame[]
): Map<string, NbaUpcomingPlayoffGame> {
  const map = new Map<string, NbaUpcomingPlayoffGame>();
  for (const game of upcoming) {
    const key = abbrPairKey(game.visitor_abbr, game.home_abbr);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, game);
      continue;
    }
    // Prefer a definite game over an if-necessary one; if both are the same
    // status, take the earlier date (next chronological game in the series).
    const replace =
      (!game.if_necessary && existing.if_necessary) ||
      (game.if_necessary === existing.if_necessary && (game.date ?? "") < (existing.date ?? ""));
    if (replace) {
      map.set(key, game);
    }
  }
  return map;
}

function abbrPairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

function padRound(series: PlayoffSeries[], targetSize: number): (PlayoffSeries | null)[] {
  const padded: (PlayoffSeries | null)[] = [...series];
  while (padded.length < targetSize) {
    padded.push(null);
  }
  return padded.slice(0, targetSize);
}

// Build a map of teamId → playoff seed (1-8). The NBA's regular-season
// conference rank doesn't always match the playoff seed because of the
// play-in tournament: the team that finished #7 in the regular season can
// drop to playoff seed 8 (or out entirely) if they lose the 7v8 play-in.
//
// We use two facts to derive the post-play-in seeds:
//   1. Seeds 1-6 are guaranteed playoff teams whose playoff seed equals
//      their conference rank (play-in only affects 7-10).
//   2. R1 matchups always sum to 9: 1v8, 2v7, 3v6, 4v5. So once we know
//      one team in a series has playoff seed N (because we anchored from
//      conf_rank 1-6), the opponent must have playoff seed 9-N — even if
//      their conf_rank says otherwise.
function derivePlayoffSeeds(
  r1Series: PlayoffSeries[],
  confRankByTeamId: Map<number, number>
): Map<number, number> {
  const seeds = new Map<number, number>();
  for (const [teamId, rank] of confRankByTeamId) {
    if (rank >= 1 && rank <= 6) seeds.set(teamId, rank);
  }
  for (const s of r1Series) {
    const aRank = confRankByTeamId.get(s.teamA.id);
    const bRank = confRankByTeamId.get(s.teamB.id);
    let anchor: number | null = null;
    let opponentId: number | null = null;
    if (aRank != null && aRank >= 1 && aRank <= 6) {
      anchor = aRank;
      opponentId = s.teamB.id;
    } else if (bRank != null && bRank >= 1 && bRank <= 6) {
      anchor = bRank;
      opponentId = s.teamA.id;
    }
    if (anchor != null && opponentId != null) {
      seeds.set(opponentId, 9 - anchor);
    }
  }
  return seeds;
}

// Real NBA bracket structure (per conference):
//   side A (top half):    seeds {1, 4, 5, 8}  →  R1 slots 0 (1v8) and 1 (4v5)
//   side B (bottom half): seeds {2, 3, 6, 7}  →  R1 slots 2 (3v6) and 3 (2v7)
// (Play-in shuffles 7/8 vs 9/10 but the resulting playoff seed still falls
// into the right side, and we use conference_rank as a stand-in for seed.)
const R1_SLOT_BY_SEED: Record<number, number> = {
  1: 0, 8: 0,
  4: 1, 5: 1,
  3: 2, 6: 2,
  2: 3, 7: 3
};
const SEMIS_SIDE_BY_SEED: Record<number, 0 | 1> = {
  1: 0, 4: 0, 5: 0, 8: 0,
  2: 1, 3: 1, 6: 1, 7: 1
};

function r1Slot(s: PlayoffSeries, seeds: Map<number, number>): number | null {
  for (const id of [s.teamA.id, s.teamB.id]) {
    const seed = seeds.get(id);
    if (seed != null && R1_SLOT_BY_SEED[seed] != null) return R1_SLOT_BY_SEED[seed];
  }
  return null;
}

function semisSide(s: PlayoffSeries, seeds: Map<number, number>): 0 | 1 | null {
  for (const id of [s.teamA.id, s.teamB.id]) {
    const seed = seeds.get(id);
    if (seed != null && SEMIS_SIDE_BY_SEED[seed] != null) return SEMIS_SIDE_BY_SEED[seed];
  }
  return null;
}

// Place each R1 series into its bracket slot (0=1v8, 1=4v5, 2=3v6, 3=2v7).
// Series with unknown seeds (e.g., when the standings call failed) fill any
// remaining slots in chronological order so the UI still has something to
// show.
function orderR1BySeed(series: PlayoffSeries[], seeds: Map<number, number>): (PlayoffSeries | null)[] {
  const slots: (PlayoffSeries | null)[] = [null, null, null, null];
  const leftovers: PlayoffSeries[] = [];
  for (const s of series) {
    const slot = r1Slot(s, seeds);
    if (slot != null && slots[slot] == null) {
      slots[slot] = s;
    } else {
      leftovers.push(s);
    }
  }
  leftovers.sort((a, b) => a.earliestDate - b.earliestDate);
  for (const s of leftovers) {
    const idx = slots.indexOf(null);
    if (idx >= 0) slots[idx] = s;
  }
  return slots;
}

// Place each semis series into its bracket side (0=top half / 1v4, 1=bottom
// half / 2v3) by looking at the seeds of the participating teams.
function orderSemisBySeed(series: PlayoffSeries[], seeds: Map<number, number>): (PlayoffSeries | null)[] {
  const slots: (PlayoffSeries | null)[] = [null, null];
  const leftovers: PlayoffSeries[] = [];
  for (const s of series) {
    const side = semisSide(s, seeds);
    if (side != null && slots[side] == null) {
      slots[side] = s;
    } else {
      leftovers.push(s);
    }
  }
  leftovers.sort((a, b) => a.earliestDate - b.earliestDate);
  for (const s of leftovers) {
    const idx = slots.indexOf(null);
    if (idx >= 0) slots[idx] = s;
  }
  return slots;
}

function toSeriesSlot(series: PlayoffSeries | null): BracketSlot {
  return series ? { type: "series", series } : null;
}

function seriesWinner(series: PlayoffSeries | null | undefined): NbaTeam | null {
  if (!series?.winner) return null;
  return series.winner === "A" ? series.teamA : series.teamB;
}

function project(
  feederA: PlayoffSeries | null | undefined,
  feederB: PlayoffSeries | null | undefined,
  existing: PlayoffSeries | null | undefined
): BracketSlot {
  if (existing) return { type: "series", series: existing };
  const teamA = seriesWinner(feederA);
  const teamB = seriesWinner(feederB);
  if (!teamA && !teamB) return null;
  return { type: "preview", teamA, teamB };
}

function aggregateSeries(games: NbaGame[]): PlayoffSeries[] {
  const seriesMap = new Map<string, PlayoffSeries>();

  for (const game of games) {
    const home = game.home_team;
    const visitor = game.visitor_team;
    const sortedIds = [home.id, visitor.id].sort((a, b) => a - b);
    const key = `${sortedIds[0]}-${sortedIds[1]}`;

    let series = seriesMap.get(key);
    if (!series) {
      const teamA = sortedIds[0] === home.id ? home : visitor;
      const teamB = sortedIds[0] === home.id ? visitor : home;
      const bucket: SeriesBucket =
        home.conference === visitor.conference
          ? (home.conference as "East" | "West")
          : "Finals";
      series = {
        id: key,
        teamA,
        teamB,
        scoreA: 0,
        scoreB: 0,
        bucket,
        earliestDate: Number.POSITIVE_INFINITY
      };
      seriesMap.set(key, series);
    }

    const dateValue = game.datetime
      ? new Date(game.datetime).getTime()
      : new Date(game.date).getTime();
    if (!Number.isNaN(dateValue)) {
      series.earliestDate = Math.min(series.earliestDate, dateValue);
    }

    if (getGameState(game) === "final") {
      // Defense in depth: a real completed playoff game cannot end tied or
      // 0-0. Identical scores almost always mean an upstream feed labeled an
      // unplayed/in-progress game as "Final" — counting it would push a
      // leading team over the 4-win threshold prematurely.
      if (game.home_team_score === game.visitor_team_score) continue;

      const homeWon = game.home_team_score > game.visitor_team_score;
      const winningTeamId = homeWon ? home.id : visitor.id;
      if (winningTeamId === series.teamA.id) {
        series.scoreA += 1;
      } else {
        series.scoreB += 1;
      }
    }
  }

  for (const series of seriesMap.values()) {
    if (series.scoreA >= 4) {
      series.winner = "A";
    } else if (series.scoreB >= 4) {
      series.winner = "B";
    }
  }

  return Array.from(seriesMap.values());
}

function classifyRounds(series: PlayoffSeries[]): Map<string, number> {
  const byTeam = new Map<number, PlayoffSeries[]>();
  for (const s of series) {
    for (const teamId of [s.teamA.id, s.teamB.id]) {
      const list = byTeam.get(teamId) ?? [];
      list.push(s);
      byTeam.set(teamId, list);
    }
  }

  const rounds = new Map<string, number>();
  for (const teamSeriesList of byTeam.values()) {
    const sorted = [...teamSeriesList].sort((a, b) => a.earliestDate - b.earliestDate);
    sorted.forEach((s, index) => {
      const roundForTeam = index + 1;
      const existing = rounds.get(s.id) ?? 0;
      rounds.set(s.id, Math.max(existing, roundForTeam));
    });
  }

  return rounds;
}

function isBracketEmpty(data: PlayoffData) {
  const buckets = [data.westR1, data.westSemis, data.westCf, data.eastR1, data.eastSemis, data.eastCf];
  const anyRoundFilled = buckets.some((bucket) => bucket.some((slot) => slot !== null));
  return !anyRoundFilled && data.finals === null;
}

function BracketColumn({
  column,
  seedByTeamId,
  nextGameByPair
}: {
  column: BracketColumnSpec;
  seedByTeamId: Map<number, number>;
  nextGameByPair: Map<string, NbaUpcomingPlayoffGame>;
}) {
  return (
    <View style={styles.bracketColumn}>
      <Text style={styles.columnTitle}>{column.title}</Text>
      <View style={styles.matchupStack}>
        {column.series.map((slot, index) => (
          <MatchupCard
            key={slot?.type === "series" ? slot.series.id : `${column.id}-slot-${index}`}
            slot={slot}
            seedByTeamId={seedByTeamId}
            nextGameByPair={nextGameByPair}
          />
        ))}
      </View>
    </View>
  );
}

function MatchupCard({
  slot,
  seedByTeamId,
  nextGameByPair
}: {
  slot: BracketSlot;
  seedByTeamId: Map<number, number>;
  nextGameByPair: Map<string, NbaUpcomingPlayoffGame>;
}) {
  if (!slot) {
    return (
      <View style={[styles.matchupCard, styles.matchupCardEmpty]}>
        <Text style={styles.matchupEmptyText}>TBD</Text>
      </View>
    );
  }

  if (slot.type === "series") {
    const { series } = slot;
    const status = getSeriesStatusLabel(series);
    const { top, bottom } = orderedSeriesTeams(series, seedByTeamId);
    const nextGame = !series.winner
      ? nextGameByPair.get(abbrPairKey(series.teamA.abbreviation, series.teamB.abbreviation)) ?? null
      : null;
    return (
      <View style={styles.matchupCard}>
        {status ? <Text style={styles.matchupStatus}>{status}</Text> : null}
        <SeriesRow
          isFirst
          score={top.score}
          team={top.team}
          winner={top.won}
          seed={top.seed}
        />
        <SeriesRow
          score={bottom.score}
          team={bottom.team}
          winner={bottom.won}
          seed={bottom.seed}
        />
        {nextGame ? <NextGameFooter game={nextGame} /> : null}
      </View>
    );
  }

  const [top, bottom] = orderedPreviewTeams(slot, seedByTeamId);
  return (
    <View style={styles.matchupCard}>
      <PreviewRow isFirst team={top.team} seed={top.seed} />
      <PreviewRow team={bottom.team} seed={bottom.seed} />
    </View>
  );
}

// Order the two teams in a matchup so the higher seed (lower numeric value)
// renders on top — both for live series and for projected previews. Falls
// back to the original A/B order when neither team has a known seed.
function orderedSeriesTeams(series: PlayoffSeries, seeds: Map<number, number>) {
  const seedA = seeds.get(series.teamA.id) ?? null;
  const seedB = seeds.get(series.teamB.id) ?? null;
  const aFirst = (seedA ?? Infinity) <= (seedB ?? Infinity);
  const teamARecord = {
    team: series.teamA,
    score: series.scoreA,
    won: series.winner === "A",
    seed: seedA
  };
  const teamBRecord = {
    team: series.teamB,
    score: series.scoreB,
    won: series.winner === "B",
    seed: seedB
  };
  return aFirst
    ? { top: teamARecord, bottom: teamBRecord }
    : { top: teamBRecord, bottom: teamARecord };
}

function orderedPreviewTeams(
  slot: { teamA: NbaTeam | null; teamB: NbaTeam | null },
  seeds: Map<number, number>
): [
  { team: NbaTeam | null; seed: number | null },
  { team: NbaTeam | null; seed: number | null }
] {
  const seedA = slot.teamA ? seeds.get(slot.teamA.id) ?? null : null;
  const seedB = slot.teamB ? seeds.get(slot.teamB.id) ?? null : null;
  const aFirst = (seedA ?? Infinity) <= (seedB ?? Infinity);
  const a = { team: slot.teamA, seed: seedA };
  const b = { team: slot.teamB, seed: seedB };
  return aFirst ? [a, b] : [b, a];
}

function SeriesRow({
  isFirst,
  score,
  team,
  winner,
  seed
}: {
  isFirst?: boolean;
  score: number;
  team: NbaTeam;
  winner: boolean;
  seed: number | null;
}) {
  return (
    <View style={[styles.seriesRow, winner && styles.seriesRowWinner, !isFirst && styles.seriesRowDivider]}>
      <SeedCell seed={seed} />
      <Image source={{ uri: teamLogoUri(team) }} style={styles.matchupLogo} />
      <Text style={[styles.teamAbbr, !winner && styles.teamAbbrDim]}>{team.abbreviation}</Text>
      <Text style={[styles.seriesScore, winner && styles.seriesScoreWinner]}>{score}</Text>
    </View>
  );
}

function PreviewRow({
  isFirst,
  team,
  seed
}: {
  isFirst?: boolean;
  team: NbaTeam | null;
  seed: number | null;
}) {
  return (
    <View style={[styles.seriesRow, styles.seriesRowPreview, !isFirst && styles.seriesRowDivider]}>
      <SeedCell seed={team ? seed : null} />
      {team ? (
        <Image source={{ uri: teamLogoUri(team) }} style={styles.matchupLogo} />
      ) : (
        <View style={styles.matchupLogoPlaceholder} />
      )}
      <Text style={[styles.teamAbbr, !team && styles.teamAbbrTbd]}>{team?.abbreviation ?? "TBD"}</Text>
    </View>
  );
}

function SeedCell({ seed }: { seed: number | null }) {
  return (
    <Text style={[styles.seedText, seed === null && styles.seedTextEmpty]}>{seed ?? ""}</Text>
  );
}

function NextGameFooter({ game }: { game: NbaUpcomingPlayoffGame }) {
  if (!game.date) {
    return <Text style={styles.matchupFooter}>Next: TBD</Text>;
  }
  const dateStr = new Date(game.date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
  const timeStr = game.tip_off
    ? new Date(game.tip_off).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "TBD";
  const prefix = game.if_necessary ? "If nec. " : "";
  return <Text style={styles.matchupFooter}>{`${prefix}${dateStr} - ${timeStr}`}</Text>;
}

function getSeriesStatusLabel(series: PlayoffSeries): string {
  if (series.winner) {
    const winnerTeam = series.winner === "A" ? series.teamA : series.teamB;
    const winScore = Math.max(series.scoreA, series.scoreB);
    const loseScore = Math.min(series.scoreA, series.scoreB);
    return `${winnerTeam.abbreviation} wins ${winScore}-${loseScore}`;
  }
  const total = series.scoreA + series.scoreB;
  if (total === 0) return "";
  const gameNum = total + 1;
  if (series.scoreA === series.scoreB) {
    return `Game ${gameNum}, tied ${series.scoreA}-${series.scoreB}`;
  }
  const leader = series.scoreA > series.scoreB ? series.teamA : series.teamB;
  const leadScore = Math.max(series.scoreA, series.scoreB);
  const trailScore = Math.min(series.scoreA, series.scoreB);
  return `Game ${gameNum}, ${leader.abbreviation} lead ${leadScore}-${trailScore}`;
}

function FinalsCard({ finals }: { finals: BracketSlot }) {
  let teamA: NbaTeam | null = null;
  let teamB: NbaTeam | null = null;
  let scoreLabel = "TBD";
  if (finals?.type === "series") {
    teamA = finals.series.teamA;
    teamB = finals.series.teamB;
    scoreLabel = `${finals.series.scoreA}-${finals.series.scoreB}`;
  } else if (finals?.type === "preview") {
    teamA = finals.teamA;
    teamB = finals.teamB;
  }

  return (
    <View style={styles.finalsColumn}>
      <Text style={styles.finalsLabel}>Finals</Text>
      <LinearGradient colors={["#0E1E36", "#050B14"]} style={styles.finalsCard}>
        <View style={styles.finalsTeams}>
          <FinalsTeam team={teamA} />
          <Text style={styles.finalsScore}>{scoreLabel}</Text>
          <FinalsTeam team={teamB} />
        </View>
      </LinearGradient>
    </View>
  );
}

function FinalsTeam({ team }: { team: NbaTeam | null }) {
  return (
    <View style={styles.finalsTeam}>
      <View style={styles.finalsLogo}>
        {team ? (
          <Image source={{ uri: teamLogoUri(team) }} style={styles.finalsLogoImage} />
        ) : (
          <Text style={styles.finalsAbbr}>—</Text>
        )}
      </View>
      <Text style={styles.finalsTeamLabel}>{team?.name ?? "TBD"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center"
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg
  },
  heroTitle: {
    color: colors.onSurface,
    fontFamily: fonts.display,
    fontSize: 34,
    letterSpacing: 0,
    lineHeight: 40,
    textAlign: "center",
    textTransform: "uppercase"
  },
  bracketScroller: {
    alignItems: "stretch",
    flexGrow: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 480,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md
  },
  bracketColumn: {
    flexDirection: "column",
    paddingVertical: spacing.xs,
    width: 200
  },
  columnTitle: {
    color: "rgba(255, 219, 204, 0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    lineHeight: 13,
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase"
  },
  // Each round's matchups distribute evenly with space-around: 4 R1 cards land
  // at 12.5/37.5/62.5/87.5%, 2 semis at 25/75%, and a single CF/Finals card at
  // 50% of the column height — that's exactly how a real bracket lines up.
  matchupStack: {
    flex: 1,
    justifyContent: "space-around"
  },
  matchupCard: {
    backgroundColor: colors.card,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
    width: 200
  },
  matchupCardEmpty: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
    opacity: 0.42
  },
  matchupEmptyText: {
    color: "rgba(224,227,229,0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  seriesRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 40,
    opacity: 0.62,
    paddingHorizontal: spacing.gutter
  },
  seriesRowWinner: {
    backgroundColor: colors.surfaceContainerHigh,
    borderLeftColor: colors.secondary,
    borderLeftWidth: 2,
    opacity: 1
  },
  seriesRowPreview: {
    opacity: 0.85
  },
  seriesRowDivider: {
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1
  },
  matchupStatus: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    color: "#CDD3DD",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textAlign: "center"
  },
  matchupFooter: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1,
    color: "#A5ACB8",
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 0.2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textAlign: "center"
  },
  seedText: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.2,
    textAlign: "center",
    width: 14
  },
  seedTextEmpty: {
    color: "transparent"
  },
  matchupLogo: {
    height: 20,
    resizeMode: "contain",
    width: 20
  },
  matchupLogoPlaceholder: {
    height: 20,
    width: 20
  },
  teamAbbr: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fonts.heading,
    fontSize: 13,
    lineHeight: 17
  },
  teamAbbrDim: {
    color: colors.onSurface
  },
  teamAbbrTbd: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    letterSpacing: 0.6
  },
  seriesScore: {
    color: colors.onSurface,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    lineHeight: 15
  },
  seriesScoreWinner: {
    color: colors.secondary
  },
  finalsColumn: {
    alignItems: "center",
    flexDirection: "column",
    gap: spacing.xs,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    width: 248
  },
  finalsLabel: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    lineHeight: 13,
    textTransform: "uppercase"
  },
  finalsCard: {
    borderColor: colors.secondary,
    borderRadius: radii.sm,
    borderWidth: 2,
    padding: spacing.sm,
    width: 248
  },
  finalsTeams: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  finalsTeam: {
    alignItems: "center",
    width: 64
  },
  finalsLogo: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    marginBottom: 4,
    overflow: "hidden",
    width: 44
  },
  finalsLogoImage: {
    height: 34,
    resizeMode: "contain",
    width: 34
  },
  finalsAbbr: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 16
  },
  finalsTeamLabel: {
    color: "rgba(224,227,229,0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.8,
    lineHeight: 11,
    textTransform: "uppercase"
  },
  finalsScore: {
    color: colors.secondary,
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26
  },
  pressed: {
    opacity: 0.72
  }
});
