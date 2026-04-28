import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAsyncData } from "../hooks/useAsyncData";
import {
  getBoxScore,
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
      {game ? <BoxScoreContent game={game} onClose={onClose} /> : null}
    </Modal>
  );
}

function BoxScoreContent({ game, onClose }: { game: NbaGame; onClose: () => void }) {
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTeams}>
          <HeaderTeam abbreviation={game.visitor_team.abbreviation} score={game.visitor_team_score} />
          <Text style={styles.headerSeparator}>@</Text>
          <HeaderTeam abbreviation={game.home_team.abbreviation} score={game.home_team_score} />
        </View>
        <Pressable accessibilityLabel="Close box score" hitSlop={12} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <Ionicons color={colors.white} name="close" size={22} />
        </Pressable>
      </View>

      {isUpcoming ? (
        <EmptyState message="Game has not started yet" title="No Box Score" />
      ) : (
        <>
          {loading ? <LoadingState label="Loading box score" /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}

          {data ? (
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {data.teams.map((team) => (
                <TeamSection key={team.team.id} team={team} />
              ))}
            </ScrollView>
          ) : null}
        </>
      )}
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

function TeamSection({ team }: { team: NbaBoxScoreTeam }) {
  const starters = team.players.filter((player) => player.starter);
  const bench = team.players.filter((player) => !player.starter);
  const totals = computeTotals(team.players);

  return (
    <View style={styles.teamSection}>
      <View style={styles.teamSectionHeader}>
        <Image source={{ uri: teamLogoUri(team.team) }} style={styles.teamSectionLogo} />
        <Text style={styles.teamSectionTitle}>{team.team.full_name}</Text>
        <Text style={styles.teamSectionScore}>{team.score}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={[styles.table, { width: tableWidth }]}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.headerCell, styles.playerCell]}>Player</Text>
            {statColumns.map((column) => (
              <Text key={column.label} style={[styles.headerCell, { width: column.width }]}>
                {column.label}
              </Text>
            ))}
          </View>

          {starters.length > 0 ? <SectionLabel label="Starters" /> : null}
          {starters.map((player) => (
            <PlayerRow key={player.player_id} player={player} />
          ))}

          {bench.length > 0 ? <SectionLabel label="Bench" /> : null}
          {bench.map((player) => (
            <PlayerRow key={player.player_id} player={player} />
          ))}

          <TotalsRow totals={totals} />
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={[styles.sectionLabelRow, { width: tableWidth }]}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function PlayerRow({ player }: { player: NbaBoxScorePlayer }) {
  return (
    <View style={[styles.tableRow, styles.bodyRow]}>
      <View style={styles.playerCell}>
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
}

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
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md
  },
  headerTeams: {
    alignItems: "center",
    flex: 1,
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
  closeButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    paddingTop: spacing.md
  },
  teamSection: {
    marginBottom: spacing.lg
  },
  teamSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm
  },
  teamSectionLogo: {
    height: 24,
    resizeMode: "contain",
    width: 24
  },
  teamSectionTitle: {
    color: colors.white,
    flex: 1,
    fontFamily: fonts.heading,
    fontSize: 14
  },
  teamSectionScore: {
    color: colors.secondary,
    fontFamily: fonts.scoreboard,
    fontSize: 18
  },
  table: {
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
  playerCell: {
    paddingHorizontal: 4,
    width: 180
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
  },
  pressed: {
    opacity: 0.72
  }
});
