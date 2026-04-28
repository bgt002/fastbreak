import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle
} from "react-native";

import { useAsyncData } from "../hooks/useAsyncData";
import {
  formatLeaderValue,
  getPlayerSeasonStats,
  playerName,
  type NbaPlayerSeasonStats,
  type NbaTeam,
  type StatType
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";
import { ErrorState, LoadingState } from "./DataState";
import { PlayerAvatar } from "./PlayerAvatar";

type SeasonType = "regular" | "playoffs";

type Props = {
  visible: boolean;
  initialStat: StatType | null;
  season: number;
  seasonType: SeasonType;
  teams: NbaTeam[];
  onClose: () => void;
};

type ColumnId =
  | "min"
  | "pts"
  | "fgm"
  | "fga"
  | "fg_pct"
  | "fg3m"
  | "fg3a"
  | "fg3_pct"
  | "ftm"
  | "fta"
  | "ft_pct"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "tov"
  | "dd2"
  | "td3";

type Column = {
  id: ColumnId;
  label: string;
  width: number;
  selector: (p: NbaPlayerSeasonStats) => number;
  format: (p: NbaPlayerSeasonStats) => string;
};

const oneDecimal = (n: number) => n.toFixed(1);
const integer = (n: number) => String(Math.round(n));
const percent = (n: number) => formatLeaderValue("fg_pct", n);

const COLUMNS: Column[] = [
  { id: "min", label: "MIN", width: 52, selector: (p) => p.minutes, format: (p) => oneDecimal(p.minutes) },
  { id: "pts", label: "PTS", width: 52, selector: (p) => p.stats.pts, format: (p) => oneDecimal(p.stats.pts) },
  { id: "fgm", label: "FGM", width: 52, selector: (p) => p.stats.fgm, format: (p) => oneDecimal(p.stats.fgm) },
  { id: "fga", label: "FGA", width: 52, selector: (p) => p.stats.fga, format: (p) => oneDecimal(p.stats.fga) },
  { id: "fg_pct", label: "FG%", width: 56, selector: (p) => p.stats.fg_pct, format: (p) => percent(p.stats.fg_pct) },
  { id: "fg3m", label: "3PM", width: 52, selector: (p) => p.stats.fg3m, format: (p) => oneDecimal(p.stats.fg3m) },
  { id: "fg3a", label: "3PA", width: 52, selector: (p) => p.stats.fg3a, format: (p) => oneDecimal(p.stats.fg3a) },
  { id: "fg3_pct", label: "3P%", width: 56, selector: (p) => p.stats.fg3_pct, format: (p) => percent(p.stats.fg3_pct) },
  { id: "ftm", label: "FTM", width: 52, selector: (p) => p.stats.ftm, format: (p) => oneDecimal(p.stats.ftm) },
  { id: "fta", label: "FTA", width: 52, selector: (p) => p.stats.fta, format: (p) => oneDecimal(p.stats.fta) },
  { id: "ft_pct", label: "FT%", width: 56, selector: (p) => p.stats.ft_pct, format: (p) => percent(p.stats.ft_pct) },
  { id: "reb", label: "REB", width: 52, selector: (p) => p.stats.reb, format: (p) => oneDecimal(p.stats.reb) },
  { id: "ast", label: "AST", width: 52, selector: (p) => p.stats.ast, format: (p) => oneDecimal(p.stats.ast) },
  { id: "stl", label: "STL", width: 52, selector: (p) => p.stats.stl, format: (p) => oneDecimal(p.stats.stl) },
  { id: "blk", label: "BLK", width: 52, selector: (p) => p.stats.blk, format: (p) => oneDecimal(p.stats.blk) },
  { id: "tov", label: "TO", width: 48, selector: (p) => p.stats.tov, format: (p) => oneDecimal(p.stats.tov) },
  { id: "dd2", label: "DD2", width: 48, selector: (p) => p.stats.dd2, format: (p) => integer(p.stats.dd2) },
  { id: "td3", label: "TD3", width: 48, selector: (p) => p.stats.td3, format: (p) => integer(p.stats.td3) }
];

const POSITION_FILTERS = ["All", "G", "F", "C"] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];

// NBA's percentage-stat qualification rules expressed as per-game make rates
// (300 FGM / 82 G, 82 3PM / 82 G, 125 FTM / 82 G). When the user sorts the
// table by one of these, players below the rate are hidden so a low-volume
// shooter at 100% can't appear ahead of legitimate league leaders.
const PCT_QUALIFICATION_RATES: Partial<Record<ColumnId, (p: NbaPlayerSeasonStats) => number>> = {
  fg_pct: (p) => p.stats.fgm,
  fg3_pct: (p) => p.stats.fg3m,
  ft_pct: (p) => p.stats.ftm
};
const PCT_QUALIFICATION_THRESHOLDS: Partial<Record<ColumnId, number>> = {
  fg_pct: 300 / 82,
  fg3_pct: 82 / 82,
  ft_pct: 125 / 82
};

function meetsStatQualification(p: NbaPlayerSeasonStats, statId: ColumnId): boolean {
  const rate = PCT_QUALIFICATION_RATES[statId];
  const threshold = PCT_QUALIFICATION_THRESHOLDS[statId];
  if (!rate || threshold === undefined) return true;
  return rate(p) >= threshold;
}

type SortDirection = "asc" | "desc";

export function PlayerLeadersModal({ visible, initialStat, season, seasonType, teams, onClose }: Props) {
  const [sortKey, setSortKey] = useState<ColumnId>("pts");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [teamId, setTeamId] = useState<number | "all">("all");
  const [position, setPosition] = useState<PositionFilter>("All");
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

  useEffect(() => {
    if (visible && initialStat) setSortKey(initialStat);
    if (visible) {
      setSortDir("desc");
      setTeamId("all");
      setPosition("All");
    }
  }, [visible, initialStat]);

  // Click a header: same column toggles direction; different column resets
  // to descending (which is what you almost always want for stat leaders).
  const handleSortHeader = (id: ColumnId) => {
    if (id === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(id);
      setSortDir("desc");
    }
  };

  const { data, error, loading, reload } = useAsyncData(
    () => (visible ? getPlayerSeasonStats(season, seasonType) : Promise.resolve([])),
    [visible, season, seasonType]
  );

  const sortedFiltered = useMemo(() => {
    if (!data) return [];
    const filtered = data.filter((p) => {
      if (teamId !== "all" && p.player.team_id !== teamId) return false;
      if (position !== "All") {
        const pos = (p.player.position ?? "").toUpperCase();
        if (!pos.split("-").includes(position)) return false;
      }
      if (!meetsStatQualification(p, sortKey)) return false;
      return true;
    });
    const column = COLUMNS.find((c) => c.id === sortKey) ?? COLUMNS[0]!;
    return [...filtered].sort((a, b) => {
      const diff = column.selector(b) - column.selector(a);
      return sortDir === "desc" ? diff : -diff;
    });
  }, [data, sortKey, sortDir, teamId, position]);

  const selectedTeam = teamId === "all" ? null : teams.find((t) => t.id === teamId) ?? null;
  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.full_name.localeCompare(b.full_name)), [teams]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={styles.container}>
        <View style={[styles.header, webHeaderSafeArea]}>
          <Text style={styles.title}>Season Leaders</Text>
          <Pressable accessibilityLabel="Close" hitSlop={12} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Ionicons color={colors.white} name="close" size={22} />
          </Pressable>
        </View>

        <View style={styles.filtersRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTeamPickerOpen(true)}
            style={({ pressed }) => [styles.filterPill, pressed && styles.pressed]}
          >
            <Ionicons color="#A5ACB8" name="people-outline" size={14} />
            <Text style={styles.filterPillText}>{selectedTeam ? selectedTeam.abbreviation : "All Teams"}</Text>
            <Ionicons color="#A5ACB8" name="chevron-down" size={14} />
          </Pressable>
          <View style={styles.positionRow}>
            {POSITION_FILTERS.map((p) => {
              const active = position === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPosition(p)}
                  style={({ pressed }) => [styles.positionPill, active && styles.positionPillActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.positionPillText, active && styles.positionPillTextActive]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? <LoadingState label="Loading players" /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data && !loading ? (
          <ScrollView horizontal contentContainerStyle={styles.tableScroll} showsHorizontalScrollIndicator>
            <View style={styles.tableInner}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.headerCell, styles.rankCell]}>#</Text>
                <Text style={[styles.headerCell, styles.playerCell]}>Player</Text>
                <Text style={[styles.headerCell, styles.posCell]}>POS</Text>
                <Text style={[styles.headerCell, styles.gpCell]}>GP</Text>
                {COLUMNS.map((col) => {
                  const active = sortKey === col.id;
                  return (
                    <Pressable
                      key={col.id}
                      hitSlop={6}
                      onPress={() => handleSortHeader(col.id)}
                      style={[styles.headerStatCell, { width: col.width }]}
                    >
                      <Text style={[styles.headerCell, active && styles.headerCellActive]}>{col.label}</Text>
                      {active ? (
                        <Ionicons
                          color={colors.secondary}
                          name={sortDir === "desc" ? "caret-down" : "caret-up"}
                          size={10}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <FlatList
                data={sortedFiltered}
                keyExtractor={(item) => String(item.player.id)}
                initialNumToRender={20}
                windowSize={10}
                renderItem={({ item, index }) => (
                  <PlayerRow rank={index + 1} player={item} sortKey={sortKey} />
                )}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>No players match the current filters.</Text>
                  </View>
                }
              />
            </View>
          </ScrollView>
        ) : null}
      </View>

      <TeamPickerModal
        visible={teamPickerOpen}
        teams={sortedTeams}
        selectedId={teamId}
        onSelect={(id) => {
          setTeamId(id);
          setTeamPickerOpen(false);
        }}
        onClose={() => setTeamPickerOpen(false)}
      />
    </Modal>
  );
}

function PlayerRow({ rank, player, sortKey }: { rank: number; player: NbaPlayerSeasonStats; sortKey: ColumnId }) {
  return (
    <View style={[styles.tableRow, styles.bodyRow]}>
      <Text style={[styles.bodyCell, styles.rankCell]}>{rank}</Text>
      <View style={[styles.playerCell, styles.playerCellInner]}>
        <PlayerAvatar player={player.player} size={32} />
        <View style={styles.playerCopy}>
          <Text numberOfLines={1} style={styles.playerName}>{playerName(player.player)}</Text>
          <Text numberOfLines={1} style={styles.playerSub}>
            {player.player.team?.abbreviation ?? "—"} · {player.games_played} GP
          </Text>
        </View>
      </View>
      <Text style={[styles.bodyCell, styles.posCell]}>{player.player.position || "—"}</Text>
      <Text style={[styles.bodyCell, styles.gpCell]}>{player.games_played}</Text>
      {COLUMNS.map((col) => (
        <Text
          key={col.id}
          style={[styles.bodyCell, { width: col.width }, sortKey === col.id && styles.bodyCellActive]}
        >
          {col.format(player)}
        </Text>
      ))}
    </View>
  );
}

function TeamPickerModal({
  visible,
  teams,
  selectedId,
  onSelect,
  onClose
}: {
  visible: boolean;
  teams: NbaTeam[];
  selectedId: number | "all";
  onSelect: (id: number | "all") => void;
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.pickerBackdrop}>
        <Pressable onPress={() => undefined} style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Filter by Team</Text>
          <ScrollView style={styles.pickerList}>
            <Pressable onPress={() => onSelect("all")} style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}>
              <Text style={[styles.pickerRowText, selectedId === "all" && styles.pickerRowTextActive]}>All Teams</Text>
              {selectedId === "all" ? <Ionicons color={colors.secondary} name="checkmark" size={18} /> : null}
            </Pressable>
            {teams.map((team) => {
              const active = selectedId === team.id;
              return (
                <Pressable
                  key={team.id}
                  onPress={() => onSelect(team.id)}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                >
                  <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>
                    {team.abbreviation} · {team.full_name}
                  </Text>
                  {active ? <Ionicons color={colors.secondary} name="checkmark" size={18} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// On web (incl. iOS PWA standalone) the RN Modal renders fullscreen without
// honoring env(safe-area-inset-*), so the header would sit under the iOS
// status bar / dynamic island and the X button becomes unclickable. Push the
// header down by env() on web. Native iOS uses presentationStyle="pageSheet"
// which already insets, so this is a no-op there.
const webHeaderSafeArea = (Platform.OS === "web"
  ? { paddingTop: "calc(env(safe-area-inset-top) + 16px)" }
  : null) as ViewStyle | null;

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
  title: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 16
  },
  close: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  filtersRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md
  },
  filterPill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  filterPillText: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12
  },
  positionRow: {
    flexDirection: "row",
    gap: 6
  },
  positionPill: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.pill,
    borderWidth: 1,
    minWidth: 38,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  positionPillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  positionPillText: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: "center"
  },
  positionPillTextActive: {
    color: colors.white
  },
  tableRow: {
    alignItems: "center",
    flexDirection: "row"
  },
  tableHeader: {
    backgroundColor: "rgba(14, 30, 54, 0.62)",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1
  },
  headerCell: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    paddingVertical: 8,
    textAlign: "center",
    textTransform: "uppercase"
  },
  headerCellActive: {
    color: colors.secondary
  },
  headerStatCell: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center"
  },
  bodyRow: {
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: 1,
    minHeight: 50
  },
  bodyCell: {
    color: colors.onBackground,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    textAlign: "center"
  },
  bodyCellActive: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold
  },
  rankCell: {
    paddingHorizontal: 8,
    width: 36
  },
  playerCell: {
    paddingHorizontal: 8,
    width: 220
  },
  // Table sits at its natural content width and centers within the modal so
  // wide screens get symmetric breathing room on both sides instead of empty
  // space all on the right.
  tableScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg
  },
  tableInner: {
    // Natural width — sum of fixed-width cells.
  },
  playerCellInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  playerCopy: {
    flex: 1,
    minWidth: 0
  },
  playerName: {
    color: colors.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 13
  },
  playerSub: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.4,
    marginTop: 1,
    textTransform: "uppercase"
  },
  posCell: {
    width: 50
  },
  gpCell: {
    width: 40
  },
  statCell: {
    paddingHorizontal: 6,
    width: 56
  },
  empty: {
    padding: spacing.lg
  },
  emptyText: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    textAlign: "center"
  },
  pressed: {
    opacity: 0.72
  },
  pickerBackdrop: {
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "flex-end"
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopLeftRadius: radii.md,
    borderTopRightRadius: radii.md,
    borderTopWidth: 1,
    maxHeight: "70%",
    padding: spacing.md
  },
  pickerTitle: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 14,
    marginBottom: spacing.sm,
    textAlign: "center"
  },
  pickerList: {
    flexGrow: 0
  },
  pickerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: 12
  },
  pickerRowText: {
    color: colors.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 13
  },
  pickerRowTextActive: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold
  }
});
