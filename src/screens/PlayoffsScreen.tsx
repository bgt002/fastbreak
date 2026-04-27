import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  formatLeaderValue,
  getCurrentNbaSeason,
  getGameState,
  getLeaders,
  getPostseasonGames,
  playerName,
  type NbaGame,
  type NbaLeader,
  type NbaTeam,
  type StatType
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

type BracketColumnSpec = {
  id: string;
  title: string;
  spacing?: "tight" | "wide" | "wider";
  series: (PlayoffSeries | null)[];
};

type PlayoffData = {
  westR1: (PlayoffSeries | null)[];
  westSemis: (PlayoffSeries | null)[];
  westCf: (PlayoffSeries | null)[];
  eastR1: (PlayoffSeries | null)[];
  eastSemis: (PlayoffSeries | null)[];
  eastCf: (PlayoffSeries | null)[];
  finals: PlayoffSeries | null;
  leaders: { id: StatType; label: string; leader?: NbaLeader }[];
};

const playoffStatConfig: { id: StatType; shortLabel: string }[] = [
  { id: "pts", shortLabel: "PTS" },
  { id: "reb", shortLabel: "REB" },
  { id: "ast", shortLabel: "AST" }
];

const season = getCurrentNbaSeason();

export function PlayoffsScreen() {
  const { data, error, loading, reload } = useAsyncData(loadPlayoffData, []);

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
    <ScrollView bounces={false} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
              <BracketColumn column={column} key={column.id} />
            ))}

            <FinalsCard finals={data.finals} />

            {eastColumns.map((column) => (
              <BracketColumn column={column} key={column.id} />
            ))}
          </ScrollView>

          <View style={styles.bottomSection}>
            <View style={styles.leadersCard}>
              <Text style={styles.leadersTitle}>Playoff Stat Leaders</Text>
              {data.leaders.map(({ id, label, leader }) => (
                <View key={id} style={styles.playoffLeaderRow}>
                  <Text style={styles.playoffLeaderLabel}>{label}</Text>
                  <Text style={styles.playoffLeaderValue}>{leader ? formatLeaderValue(id, leader.value) : "—"}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

async function loadPlayoffData(): Promise<PlayoffData> {
  const [games, ...leaderSets] = await Promise.all([
    getPostseasonGames(season),
    ...playoffStatConfig.map((stat) => getLeaders(stat.id, season, "playoffs"))
  ]);

  const seriesList = aggregateSeries(games);
  const rounds = classifyRounds(seriesList);

  const westSeries = seriesList
    .filter((s) => s.bucket === "West")
    .sort((a, b) => a.earliestDate - b.earliestDate);
  const eastSeries = seriesList
    .filter((s) => s.bucket === "East")
    .sort((a, b) => a.earliestDate - b.earliestDate);
  const finals = seriesList.find((s) => s.bucket === "Finals") ?? null;

  const leaders = playoffStatConfig.map((stat, index) => {
    const top = leaderSets[index]?.[0];
    return {
      id: stat.id,
      label: top ? `${stat.shortLabel}: ${playerName(top.player)}` : `${stat.shortLabel}: —`,
      leader: top
    };
  });

  return {
    westR1: padRound(westSeries.filter((s) => rounds.get(s.id) === 1), 4),
    westSemis: padRound(westSeries.filter((s) => rounds.get(s.id) === 2), 2),
    westCf: padRound(westSeries.filter((s) => rounds.get(s.id) === 3), 1),
    eastR1: padRound(eastSeries.filter((s) => rounds.get(s.id) === 1), 4),
    eastSemis: padRound(eastSeries.filter((s) => rounds.get(s.id) === 2), 2),
    eastCf: padRound(eastSeries.filter((s) => rounds.get(s.id) === 3), 1),
    finals,
    leaders
  };
}

function padRound(series: PlayoffSeries[], targetSize: number): (PlayoffSeries | null)[] {
  const padded: (PlayoffSeries | null)[] = [...series];
  while (padded.length < targetSize) {
    padded.push(null);
  }
  return padded.slice(0, targetSize);
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
  const anyRoundFilled = buckets.some((bucket) => bucket.some((s) => s !== null));
  return !anyRoundFilled && data.finals === null;
}

function BracketColumn({ column }: { column: BracketColumnSpec }) {
  const stackStyle =
    column.spacing === "wider"
      ? styles.matchupStackWider
      : column.spacing === "wide"
        ? styles.matchupStackWide
        : styles.matchupStack;

  return (
    <View style={styles.bracketColumn}>
      <Text style={styles.columnTitle}>{column.title}</Text>
      <View style={stackStyle}>
        {column.series.map((series, index) => (
          <MatchupCard key={series?.id ?? `${column.id}-empty-${index}`} series={series} />
        ))}
      </View>
    </View>
  );
}

function MatchupCard({ series }: { series: PlayoffSeries | null }) {
  if (!series) {
    return (
      <View style={[styles.matchupCard, styles.matchupCardEmpty]}>
        <Text style={styles.matchupEmptyText}>TBD</Text>
      </View>
    );
  }

  return (
    <View style={styles.matchupCard}>
      <SeriesRow isFirst score={series.scoreA} team={series.teamA} winner={series.winner === "A"} />
      <SeriesRow score={series.scoreB} team={series.teamB} winner={series.winner === "B"} />
    </View>
  );
}

function SeriesRow({
  isFirst,
  score,
  team,
  winner
}: {
  isFirst?: boolean;
  score: number;
  team: NbaTeam;
  winner: boolean;
}) {
  return (
    <View style={[styles.seriesRow, winner && styles.seriesRowWinner, !isFirst && styles.seriesRowDivider]}>
      <Text style={[styles.teamAbbr, !winner && styles.teamAbbrDim]}>{team.abbreviation}</Text>
      <Text style={[styles.seriesScore, winner && styles.seriesScoreWinner]}>{score}</Text>
    </View>
  );
}

function FinalsCard({ finals }: { finals: PlayoffSeries | null }) {
  const teamA = finals?.teamA;
  const teamB = finals?.teamB;
  const scoreLabel = finals ? `${finals.scoreA}-${finals.scoreB}` : "TBD";

  return (
    <View style={styles.finalsColumn}>
      <Text style={styles.finalsLabel}>Finals</Text>
      <LinearGradient colors={["#0E1E36", "#050B14"]} style={styles.finalsCard}>
        <View style={styles.finalsTeams}>
          <FinalsTeam team={teamA} />
          <Text style={styles.finalsScore}>{scoreLabel}</Text>
          <FinalsTeam team={teamB} />
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.oddsButton, pressed && styles.pressed]}>
          <Text style={styles.oddsButtonText}>View Odds</Text>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function FinalsTeam({ team }: { team?: NbaTeam }) {
  return (
    <View style={styles.finalsTeam}>
      <View style={styles.finalsLogo}>
        <Text style={styles.finalsAbbr}>{team?.abbreviation ?? "—"}</Text>
      </View>
      <Text style={styles.finalsTeamLabel}>{team?.name ?? "TBD"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 92
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg
  },
  heroTitle: {
    color: colors.onSurface,
    fontFamily: fonts.display,
    fontSize: 32,
    letterSpacing: 0,
    lineHeight: 38,
    textAlign: "center",
    textTransform: "uppercase"
  },
  bracketScroller: {
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg
  },
  bracketColumn: {
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    width: 192
  },
  columnTitle: {
    color: "rgba(255, 219, 204, 0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 12,
    textAlign: "center",
    textTransform: "uppercase"
  },
  matchupStack: {
    gap: spacing.md
  },
  matchupStackWide: {
    gap: 112
  },
  matchupStackWider: {
    gap: 256
  },
  matchupCard: {
    backgroundColor: colors.card,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
    width: 192
  },
  matchupCardEmpty: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 72,
    opacity: 0.42
  },
  matchupEmptyText: {
    color: "rgba(224,227,229,0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  seriesRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 36,
    opacity: 0.62,
    paddingHorizontal: spacing.gutter
  },
  seriesRowWinner: {
    backgroundColor: colors.surfaceContainerHigh,
    borderLeftColor: colors.secondary,
    borderLeftWidth: 2,
    opacity: 1
  },
  seriesRowDivider: {
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1
  },
  teamAbbr: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fonts.heading,
    fontSize: 12,
    lineHeight: 16
  },
  teamAbbrDim: {
    color: colors.onSurface
  },
  seriesScore: {
    color: colors.onSurface,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14
  },
  seriesScoreWinner: {
    color: colors.secondary
  },
  finalsColumn: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    width: 264
  },
  finalsLabel: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 12,
    textTransform: "uppercase"
  },
  finalsCard: {
    borderColor: colors.secondary,
    borderRadius: radii.sm,
    borderWidth: 2,
    padding: spacing.md,
    width: 264
  },
  finalsTeams: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md
  },
  finalsTeam: {
    alignItems: "center",
    width: 62
  },
  finalsLogo: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    marginBottom: 4,
    width: 42
  },
  finalsAbbr: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 15
  },
  finalsTeamLabel: {
    color: "rgba(224,227,229,0.62)",
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.8,
    lineHeight: 10,
    textTransform: "uppercase"
  },
  finalsScore: {
    color: colors.secondary,
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27
  },
  oddsButton: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 34
  },
  oddsButtonText: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 12,
    textTransform: "uppercase"
  },
  bottomSection: {
    alignItems: "center",
    paddingHorizontal: spacing.md
  },
  leadersCard: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.md,
    width: "100%"
  },
  leadersTitle: {
    color: "rgba(224,227,229,0.54)",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.9,
    lineHeight: 12,
    marginBottom: spacing.gutter,
    textTransform: "uppercase"
  },
  playoffLeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3
  },
  playoffLeaderLabel: {
    color: "rgba(224,227,229,0.62)",
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 15
  },
  playoffLeaderValue: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 15
  },
  pressed: {
    opacity: 0.72
  }
});
