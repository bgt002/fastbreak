import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAsyncData } from "../hooks/useAsyncData";
import {
  getBoxScore,
  getGameClockLabel,
  getGameState,
  teamLogoUri,
  type NbaBoxScorePlayer,
  type NbaBoxScoreTeam,
  type NbaGame
} from "../services/nbaApi";
import { colors, fonts, spacing } from "../theme";
import { EmptyState, ErrorState, LoadingState } from "./DataState";

type Props = {
  game: NbaGame | null;
  onClose: () => void;
};

type TeamTotals = {
  points: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
};

type StatColumn = {
  label: string;
  width: number;
  player: (player: NbaBoxScorePlayer) => string;
  total: (totals: TeamTotals) => string;
};

function pct(made: number, attempted: number): string {
  return attempted === 0 ? "—" : ((made / attempted) * 100).toFixed(1);
}

function formatPlusMinus(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function playerMinutes(player: NbaBoxScorePlayer): string {
  const dnp = !player.minutes || player.minutes === "0:00";
  return dnp ? "—" : player.minutes ?? "—";
}

function computeTotals(players: NbaBoxScorePlayer[]): TeamTotals {
  return players.reduce<TeamTotals>(
    (acc, p) => ({
      points: acc.points + p.points,
      fgm: acc.fgm + p.fgm,
      fga: acc.fga + p.fga,
      fg3m: acc.fg3m + p.fg3m,
      fg3a: acc.fg3a + p.fg3a,
      ftm: acc.ftm + p.ftm,
      fta: acc.fta + p.fta,
      oreb: acc.oreb + p.oreb,
      dreb: acc.dreb + p.dreb,
      rebounds: acc.rebounds + p.rebounds,
      assists: acc.assists + p.assists,
      steals: acc.steals + p.steals,
      blocks: acc.blocks + p.blocks,
      turnovers: acc.turnovers + p.turnovers,
      fouls: acc.fouls + p.fouls
    }),
    { points: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0 }
  );
}

const statColumns: StatColumn[] = [
  { label: "MIN", width: 44, player: playerMinutes, total: () => "" },
  { label: "PTS", width: 36, player: (p) => String(p.points), total: (t) => String(t.points) },
  { label: "FGM", width: 36, player: (p) => String(p.fgm), total: (t) => String(t.fgm) },
  { label: "FGA", width: 36, player: (p) => String(p.fga), total: (t) => String(t.fga) },
  { label: "FG%", width: 48, player: (p) => pct(p.fgm, p.fga), total: (t) => pct(t.fgm, t.fga) },
  { label: "3PM", width: 36, player: (p) => String(p.fg3m), total: (t) => String(t.fg3m) },
  { label: "3PA", width: 36, player: (p) => String(p.fg3a), total: (t) => String(t.fg3a) },
  { label: "3P%", width: 48, player: (p) => pct(p.fg3m, p.fg3a), total: (t) => pct(t.fg3m, t.fg3a) },
  { label: "FTM", width: 36, player: (p) => String(p.ftm), total: (t) => String(t.ftm) },
  { label: "FTA", width: 36, player: (p) => String(p.fta), total: (t) => String(t.fta) },
  { label: "FT%", width: 48, player: (p) => pct(p.ftm, p.fta), total: (t) => pct(t.ftm, t.fta) },
  { label: "OREB", width: 44, player: (p) => String(p.oreb), total: (t) => String(t.oreb) },
  { label: "DREB", width: 44, player: (p) => String(p.dreb), total: (t) => String(t.dreb) },
  { label: "REB", width: 36, player: (p) => String(p.rebounds), total: (t) => String(t.rebounds) },
  { label: "AST", width: 36, player: (p) => String(p.assists), total: (t) => String(t.assists) },
  { label: "STL", width: 36, player: (p) => String(p.steals), total: (t) => String(t.steals) },
  { label: "BLK", width: 36, player: (p) => String(p.blocks), total: (t) => String(t.blocks) },
  { label: "TOV", width: 36, player: (p) => String(p.turnovers), total: (t) => String(t.turnovers) },
  { label: "PF", width: 32, player: (p) => String(p.fouls), total: (t) => String(t.fouls) },
  { label: "+/-", width: 40, player: (p) => formatPlusMinus(p.plus_minus), total: () => "" }
];

const tableWidth = 180 + statColumns.reduce((total, column) => total + column.width, 0);

export function BoxScoreModal({ game, onClose }: Props) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={game !== null}>
      {game ? <BoxScoreContent key={game.id} game={game} /> : null}
    </Modal>
  );
}

export function BoxScoreContent({ game }: { game: NbaGame }) {
  const state = getGameState(game);
  const isUpcoming = state === "upcoming";
  const isLive = state === "live";
  const { data, error, loading, reload, silentReload } = useAsyncData(
    () => (isUpcoming ? Promise.resolve(null) : getBoxScore(game.id)),
    [game.id, isUpcoming]
  );

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(silentReload, 5000);
    return () => clearInterval(interval);
  }, [isLive, silentReload]);

  const [refreshing, setRefreshing] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) {
      spin.stopAnimation();
      return;
    }
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await silentReload();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, silentReload]);
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const orderedTeams = useMemo(() => orderTeams(data?.teams ?? [], game), [data, game]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const activeTeamId = selectedTeamId ?? orderedTeams[0]?.team.id ?? null;
  const activeTeam = orderedTeams.find((t) => t.team.id === activeTeamId) ?? orderedTeams[0];

  // Mirror the body's horizontal scroll onto the sticky stat header so the
  // pinned column labels stay aligned with the columns scrolled below them.
  const horizontalScrollX = useRef(new Animated.Value(0)).current;
  const stickyHeaderScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const id = horizontalScrollX.addListener(({ value }) => {
      stickyHeaderScrollRef.current?.scrollTo({ x: value, animated: false });
    });
    return () => horizontalScrollX.removeListener(id);
  }, [horizontalScrollX]);
  // Reset to 0 when switching teams so the sticky header doesn't keep an
  // off-screen scroll position from the previous team's table.
  useEffect(() => {
    horizontalScrollX.setValue(0);
    stickyHeaderScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [activeTeamId, horizontalScrollX]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.headerStatus, isLive && styles.headerStatusLive]}>{getGameClockLabel(game)}</Text>
        <View style={styles.headerTeams}>
          <HeaderTeam abbreviation={game.visitor_team.abbreviation} score={game.visitor_team_score} />
          <Text style={styles.headerSeparator}>@</Text>
          <HeaderTeam abbreviation={game.home_team.abbreviation} score={game.home_team_score} />
        </View>
        <Pressable
          accessibilityLabel="Refresh box score"
          disabled={refreshing}
          hitSlop={12}
          onPress={handleRefresh}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
        >
          <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
            <Ionicons color={colors.white} name="refresh-outline" size={20} />
          </Animated.View>
        </Pressable>
      </View>

      {isUpcoming ? (
        <EmptyState message="Game has not started yet" title="No Box Score" />
      ) : (
        <>
          {loading ? <LoadingState label="Loading box score" /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}

          {data ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              stickyHeaderIndices={activeTeam ? [1] : []}
            >
              <LineScoreTable teams={orderedTeams} game={game} />
              <View style={styles.stickyBlock}>
                <TeamToggle
                  teams={orderedTeams}
                  selectedTeamId={activeTeam?.team.id ?? null}
                  onSelect={setSelectedTeamId}
                />
                {activeTeam ? <TableStickyHeader scrollRef={stickyHeaderScrollRef} /> : null}
              </View>
              {activeTeam ? <TableBody team={activeTeam} scrollX={horizontalScrollX} showOnCourt={isLive} /> : null}
            </ScrollView>
          ) : null}
        </>
      )}
    </View>
  );
}

function orderTeams(teams: NbaBoxScoreTeam[], game: NbaGame): NbaBoxScoreTeam[] {
  const visitor = teams.find((t) => t.team.id === game.visitor_team.id);
  const home = teams.find((t) => t.team.id === game.home_team.id);
  return [visitor, home].filter((t): t is NbaBoxScoreTeam => Boolean(t));
}

const CONTENT_MAX_WIDTH = 1080;

function LineScoreTable({ teams, game }: { teams: NbaBoxScoreTeam[]; game: NbaGame }) {
  if (teams.length === 0) return null;
  const isFinal = getGameState(game) === "final";
  const currentPeriod = game.period ?? 0;
  const maxPeriod = Math.max(4, currentPeriod, ...teams.flatMap((t) => t.periods.map((p) => p.period)));
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  return (
    <View style={styles.lineScore}>
      <View style={styles.lineScoreRow}>
        <View style={styles.lineScoreLogoCell} />
        {periods.map((p) => (
          <Text key={p} style={styles.lineScoreHeader}>
            {p <= 4 ? `Q${p}` : `OT${p - 4}`}
          </Text>
        ))}
        <Text style={[styles.lineScoreHeader, styles.lineScoreTotalHeader]}>T</Text>
      </View>
      {teams.map((team) => (
        <View key={team.team.id} style={[styles.lineScoreRow, styles.lineScoreTeamRow]}>
          <View style={styles.lineScoreLogoCell}>
            <Image source={{ uri: teamLogoUri(team.team) }} style={styles.lineScoreLogo} />
          </View>
          {periods.map((p) => {
            const period = team.periods.find((per) => per.period === p);
            const played = isFinal || p <= currentPeriod;
            return (
              <Text key={p} style={styles.lineScoreCell}>
                {played && period ? period.score : "—"}
              </Text>
            );
          })}
          <Text style={[styles.lineScoreCell, styles.lineScoreTotal]}>{team.score}</Text>
        </View>
      ))}
    </View>
  );
}

function TeamToggle({
  teams,
  selectedTeamId,
  onSelect
}: {
  teams: NbaBoxScoreTeam[];
  selectedTeamId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <View style={styles.toggle}>
      {teams.map((team) => {
        const active = team.team.id === selectedTeamId;
        return (
          <Pressable
            key={team.team.id}
            onPress={() => onSelect(team.team.id)}
            style={({ pressed }) => [
              styles.togglePill,
              active && styles.togglePillActive,
              pressed && styles.togglePillPressed
            ]}
          >
            <Image source={{ uri: teamLogoUri(team.team) }} style={styles.toggleLogo} />
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{team.team.abbreviation}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function HeaderTeam({ abbreviation, score }: { abbreviation: string; score: number }) {
  return (
    <View style={styles.headerTeamColumn}>
      <Image source={{ uri: teamLogoUri({ abbreviation }) }} style={styles.headerLogo} />
      <Text style={styles.headerAbbr}>{abbreviation}</Text>
      <Text style={styles.headerScore}>{score}</Text>
    </View>
  );
}

function TableStickyHeader({ scrollRef }: { scrollRef: React.RefObject<ScrollView | null> }) {
  return (
    <ScrollView
      horizontal
      ref={scrollRef}
      scrollEnabled={false}
      showsHorizontalScrollIndicator={false}
      style={styles.stickyHeaderRow}
    >
      <View style={[styles.table, styles.tableHeaderRow]}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.headerCell, styles.playerCell]}>Player</Text>
          {statColumns.map((column) => (
            <Text key={column.label} style={[styles.headerCell, { width: column.width }]}>
              {column.label}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function TableBody({
  team,
  scrollX,
  showOnCourt
}: {
  team: NbaBoxScoreTeam;
  scrollX: Animated.Value;
  showOnCourt: boolean;
}) {
  const starters = team.players.filter((player) => player.starter);
  const bench = team.players.filter((player) => !player.starter);
  const totals = computeTotals(team.players);

  return (
    <View style={styles.teamSection}>
      <Animated.ScrollView
        horizontal
        contentContainerStyle={styles.tableScroll}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator
      >
        <View style={styles.table}>
          {starters.length > 0 ? <SectionLabel label="Starters" /> : null}
          {starters.map((player) => (
            <PlayerRow key={player.player_id} player={player} showOnCourt={showOnCourt} />
          ))}

          {bench.length > 0 ? <SectionLabel label="Bench" /> : null}
          {bench.map((player) => (
            <PlayerRow key={player.player_id} player={player} showOnCourt={showOnCourt} />
          ))}

          <TotalsRow totals={totals} />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

const PlayerRow = memo(function PlayerRow({
  player,
  showOnCourt
}: {
  player: NbaBoxScorePlayer;
  showOnCourt: boolean;
}) {
  // The on_court flag from cdn.nba.com sticks around in the box score data
  // even after a game ends, so only honor it while the game is actually live.
  const onCourt = showOnCourt && player.on_court;
  return (
    <View style={[styles.tableRow, styles.bodyRow]}>
      <View style={[styles.playerCell, styles.playerCellInner]}>
        {onCourt ? <View style={styles.onCourtDot} /> : <View style={styles.onCourtSpacer} />}
        <Text numberOfLines={1} style={styles.playerName}>
          {player.name}
        </Text>
      </View>
      {statColumns.map((column) => (
        <Text key={column.label} style={[styles.bodyCell, { width: column.width }]}>
          {column.player(player)}
        </Text>
      ))}
    </View>
  );
});

function TotalsRow({ totals }: { totals: TeamTotals }) {
  return (
    <View style={[styles.tableRow, styles.totalsRow]}>
      <View style={styles.playerCell}>
        <Text style={styles.totalsLabel}>Team Totals</Text>
      </View>
      {statColumns.map((column) => (
        <Text key={column.label} style={[styles.totalsCell, { width: column.width }]}>
          {column.total(totals)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1
  },
  header: {
    alignItems: "center",
    backgroundColor: "rgba(14, 30, 54, 0.86)",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md
  },
  headerStatus: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.9,
    marginBottom: spacing.xs,
    textTransform: "uppercase"
  },
  headerStatusLive: {
    color: colors.tertiary
  },
  refreshButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    right: spacing.gutter,
    top: spacing.md,
    width: 36
  },
  refreshButtonPressed: {
    opacity: 0.6
  },
  headerTeams: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center"
  },
  headerSeparator: {
    color: "#7D8490",
    fontFamily: fonts.heading,
    fontSize: 14
  },
  headerTeamColumn: {
    alignItems: "center"
  },
  headerLogo: {
    height: 36,
    resizeMode: "contain",
    width: 36
  },
  headerAbbr: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    marginTop: 2,
    textTransform: "uppercase"
  },
  headerScore: {
    color: colors.white,
    fontFamily: fonts.scoreboard,
    fontSize: 22,
    lineHeight: 26,
    marginTop: 2
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    paddingTop: spacing.md
  },
  // The three top-level body sections all cap at the same max width and
  // self-center, so on wide desktop panes they sit as a single centered column
  // (eliminates the "shifted left, whitespace on the right" feel) while still
  // filling narrower mobile widths.
  teamSection: {
    alignSelf: "center",
    marginBottom: spacing.lg,
    maxWidth: CONTENT_MAX_WIDTH,
    width: "100%"
  },
  stickyBlock: {
    alignSelf: "center",
    backgroundColor: colors.background,
    maxWidth: CONTENT_MAX_WIDTH,
    width: "100%"
  },
  stickyHeaderRow: {
    backgroundColor: colors.background
  },
  tableHeaderRow: {
    backgroundColor: colors.background
  },
  lineScore: {
    alignSelf: "center",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    maxWidth: CONTENT_MAX_WIDTH,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md,
    width: "100%"
  },
  lineScoreRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 30
  },
  lineScoreTeamRow: {
    borderTopColor: "rgba(255,255,255,0.04)",
    borderTopWidth: 1,
    minHeight: 38
  },
  lineScoreLogoCell: {
    alignItems: "center",
    justifyContent: "center",
    width: 38
  },
  lineScoreLogo: {
    height: 22,
    resizeMode: "contain",
    width: 22
  },
  lineScoreHeader: {
    color: "#7D8490",
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textAlign: "center",
    textTransform: "uppercase"
  },
  lineScoreTotalHeader: {
    color: "#A5ACB8"
  },
  lineScoreCell: {
    color: colors.white,
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    textAlign: "center"
  },
  lineScoreTotal: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 17
  },
  toggle: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md
  },
  togglePill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.sm
  },
  togglePillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  togglePillPressed: {
    opacity: 0.72
  },
  toggleLogo: {
    height: 22,
    resizeMode: "contain",
    width: 22
  },
  toggleText: {
    color: colors.onBackground,
    fontFamily: fonts.heading,
    fontSize: 13
  },
  toggleTextActive: {
    color: colors.white
  },
  // The table flexes to fill its wrapper, but never below the sum of all
  // column widths — so on narrow viewports horizontal scrolling still works.
  // flexGrow on the horizontal ScrollView's contentContainer makes it expand
  // to fill the wrapper width when the table fits, so the inner table can
  // claim the extra space via its own `flex: 1`.
  tableScroll: {
    flexGrow: 1
  },
  table: {
    flex: 1,
    minWidth: tableWidth,
    paddingHorizontal: spacing.gutter
  },
  tableRow: {
    alignItems: "center",
    flexDirection: "row"
  },
  tableHeader: {
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    paddingBottom: 8
  },
  headerCell: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.7,
    paddingHorizontal: 4,
    paddingVertical: 6,
    textAlign: "center",
    textTransform: "uppercase"
  },
  // Player column stretches so the stat columns end at the right edge of the
  // (now full-width) table, instead of being clustered on the left.
  playerCell: {
    flex: 1,
    minWidth: 180,
    paddingHorizontal: 4
  },
  playerCellInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  onCourtDot: {
    backgroundColor: colors.tertiary,
    borderRadius: 4,
    height: 8,
    width: 8
  },
  onCourtSpacer: {
    height: 8,
    width: 8
  },
  totalsRow: {
    backgroundColor: "rgba(14, 30, 54, 0.62)",
    borderTopColor: "rgba(255,107,0,0.5)",
    borderTopWidth: 1,
    minHeight: 38,
    marginTop: 4
  },
  totalsLabel: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  totalsCell: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    paddingHorizontal: 4,
    textAlign: "center"
  },
  bodyRow: {
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: 1,
    minHeight: 34
  },
  bodyCell: {
    color: colors.onSurface,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    paddingHorizontal: 4,
    textAlign: "center"
  },
  playerName: {
    color: colors.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 12
  },
  sectionLabelRow: {
    alignSelf: "stretch",
    backgroundColor: "rgba(14, 30, 54, 0.42)",
    paddingHorizontal: 4,
    paddingVertical: 4
  },
  sectionLabel: {
    color: "rgba(255,107,0,0.82)",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    textTransform: "uppercase"
  }
});
