import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAsyncData } from "../hooks/useAsyncData";
import {
  getBoxScore,
  teamLogoUri,
  type NbaBoxScorePlayer,
  type NbaBoxScoreTeam,
  type NbaGame
} from "../services/nbaApi";
import { colors, fonts, spacing } from "../theme";
import { ErrorState, LoadingState } from "./DataState";

type Props = {
  game: NbaGame | null;
  onClose: () => void;
};

const statColumns: { key: keyof NbaBoxScorePlayer; label: string; width: number }[] = [
  { key: "minutes", label: "MIN", width: 44 },
  { key: "points", label: "PTS", width: 40 },
  { key: "rebounds", label: "REB", width: 40 },
  { key: "assists", label: "AST", width: 40 },
  { key: "steals", label: "STL", width: 40 },
  { key: "blocks", label: "BLK", width: 40 }
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
  const { data, error, loading, reload } = useAsyncData(() => getBoxScore(game.id), [game.id]);

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

      {loading ? <LoadingState label="Loading box score" /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      {data ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {data.teams.map((team) => (
            <TeamSection key={team.team.id} team={team} />
          ))}
        </ScrollView>
      ) : null}
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
              <Text key={column.key} style={[styles.headerCell, { width: column.width }]}>
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
  const dnp = !player.minutes || player.minutes === "0:00";

  return (
    <View style={[styles.tableRow, styles.bodyRow]}>
      <View style={styles.playerCell}>
        <Text numberOfLines={1} style={styles.playerName}>
          {player.name}
        </Text>
      </View>
      {statColumns.map((column) => {
        const value = column.key === "minutes" ? (dnp ? "—" : player.minutes ?? "—") : String(player[column.key] ?? 0);
        return (
          <Text key={column.key} style={[styles.bodyCell, { width: column.width }]}>
            {value}
          </Text>
        );
      })}
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
