import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

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
      contentContainerStyle={styles.scrollContent}
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

  const seedByTeamId = new Map<number, number>();
  standings.forEach((s) => seedByTeamId.set(s.team.id, s.conference_rank));

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

  const westR1 = padRound(westSeries.filter((s) => rounds.get(s.id) === 1), 4);
  const westSemisRaw = padRound(westSeries.filter((s) => rounds.get(s.id) === 2), 2);
  const westCfRaw = padRound(westSeries.filter((s) => rounds.get(s.id) === 3), 1);
  const eastR1 = padRound(eastSeries.filter((s) => rounds.get(s.id) === 1), 4);
  const eastSemisRaw = padRound(eastSeries.filter((s) => rounds.get(s.id) === 2), 2);
  const eastCfRaw = padRound(eastSeries.filter((s) => rounds.get(s.id) === 3), 1);

  // Pair up feeder series so a winner from R1 can be projected into the
  // corresponding Semis slot, etc. Pairing uses chronological order, which
  // doesn't always match NBA's seeding bracket but produces a sensible
  // visualization with the data we have.
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
    const seedA = seedByTeamId.get(series.teamA.id) ?? null;
    const seedB = seedByTeamId.get(series.teamB.id) ?? null;
    const nextGame = !series.winner
      ? nextGameByPair.get(abbrPairKey(series.teamA.abbreviation, series.teamB.abbreviation)) ?? null
      : null;
    return (
      <View style={styles.matchupCard}>
        {status ? <Text style={styles.matchupStatus}>{status}</Text> : null}
        <SeriesRow
          isFirst
          score={series.scoreA}
          team={series.teamA}
          winner={series.winner === "A"}
          seed={seedA}
        />
        <SeriesRow
          score={series.scoreB}
          team={series.teamB}
          winner={series.winner === "B"}
          seed={seedB}
        />
        {nextGame ? <NextGameFooter game={nextGame} /> : null}
      </View>
    );
  }

  const seedA = slot.teamA ? seedByTeamId.get(slot.teamA.id) ?? null : null;
  const seedB = slot.teamB ? seedByTeamId.get(slot.teamB.id) ?? null : null;
  return (
    <View style={styles.matchupCard}>
      <PreviewRow isFirst team={slot.teamA} seed={seedA} />
      <PreviewRow team={slot.teamB} seed={seedB} />
    </View>
  );
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
    justifyContent: "center",
    paddingBottom: 92
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
