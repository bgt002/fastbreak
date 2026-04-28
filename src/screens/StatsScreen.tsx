import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { NAV_CLEARANCE } from "../components/AppChrome";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { PlayerLeadersModal } from "../components/PlayerLeadersModal";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  formatLeaderValue,
  formatSeasonLabel,
  getCurrentNbaSeason,
  getLeaders,
  getTeams,
  playerName,
  type NbaLeader,
  type NbaTeam,
  type StatType
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";

type SeasonType = "regular" | "playoffs";

type StatCategory = {
  id: StatType;
  title: string;
  leaders: NbaLeader[];
};

type StatsData = {
  categories: StatCategory[];
  teamMap: Map<number, NbaTeam>;
};

// Eight categories rendered in a 2-column grid — clicking any opens the full
// modal sorted by that stat. Mix of per-game and percentage leaders to give a
// fuller picture of who's leading the league.
const leaderCategories: Array<Omit<StatCategory, "leaders">> = [
  { id: "pts", title: "Points per Game" },
  { id: "reb", title: "Rebounds per Game" },
  { id: "ast", title: "Assists per Game" },
  { id: "stl", title: "Steals per Game" },
  { id: "blk", title: "Blocks per Game" },
  { id: "fg3m", title: "3PT Made per Game" },
  { id: "fg_pct", title: "Field Goal %" },
  { id: "ft_pct", title: "Free Throw %" }
];

const TOP_N_PER_CARD = 5;

const SEASON_HISTORY_LENGTH = 15;

export function StatsScreen() {
  const currentSeason = useMemo(() => getCurrentNbaSeason(), []);
  const [season, setSeason] = useState(currentSeason);
  const [seasonType, setSeasonType] = useState<SeasonType>("regular");
  const [openStat, setOpenStat] = useState<StatType | null>(null);
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);

  const loader = useCallback(() => loadStatsData(season, seasonType), [season, seasonType]);
  const { data, error, loading, reload } = useAsyncData(loader, [season, seasonType]);
  const teamsArray = useMemo(() => Array.from(data?.teamMap.values() ?? []), [data]);

  const seasonOptions = useMemo(
    () => Array.from({ length: SEASON_HISTORY_LENGTH }, (_, i) => currentSeason - i),
    [currentSeason]
  );

  return (
    <ScrollView
      bounces={false}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: NAV_CLEARANCE as number }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.contentShell}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Season Leaders</Text>
          <Text style={styles.heroSubtitle}>
            {formatSeasonLabel(season)} / {seasonType === "regular" ? "Regular Season" : "Playoffs"}
          </Text>
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSeasonPickerOpen(true)}
            style={({ pressed }) => [styles.seasonButton, pressed && styles.pressed]}
          >
            <Text style={styles.seasonButtonLabel}>Season</Text>
            <Text style={styles.seasonButtonValue}>{formatSeasonLabel(season)}</Text>
            <Ionicons color="#A5ACB8" name="chevron-down" size={14} />
          </Pressable>
          <View style={styles.segmentedControl}>
            {(["regular", "playoffs"] as const).map((item) => {
              const active = seasonType === item;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={item}
                  onPress={() => setSeasonType(item)}
                  style={({ pressed }) => [
                    styles.segmentButton,
                    active && styles.segmentButtonActive,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {item === "regular" ? "Regular" : "Playoffs"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {!loading && !error && data?.categories.every((category) => category.leaders.length === 0) ? (
          <EmptyState
            message={
              seasonType === "playoffs"
                ? "No playoff leaders yet for this season."
                : "No leaders available for this season."
            }
          />
        ) : null}

        {!loading && !error && data ? (
          <View style={styles.statsGrid}>
            {data.categories.map((category) => (
              <View key={category.id} style={styles.gridCell}>
                <StatCategoryCard
                  category={category}
                  teamMap={data.teamMap}
                  onPress={() => setOpenStat(category.id)}
                />
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <PlayerLeadersModal
        visible={openStat !== null}
        initialStat={openStat}
        season={season}
        seasonType={seasonType}
        teams={teamsArray}
        onClose={() => setOpenStat(null)}
        onSeasonTypeChange={setSeasonType}
      />

      <SeasonPickerModal
        visible={seasonPickerOpen}
        seasons={seasonOptions}
        selected={season}
        onSelect={(s) => {
          setSeason(s);
          setSeasonPickerOpen(false);
        }}
        onClose={() => setSeasonPickerOpen(false)}
      />
    </ScrollView>
  );
}

async function loadStatsData(season: number, seasonType: SeasonType): Promise<StatsData> {
  // The backend caches the underlying LeagueDashPlayerStats payload for 5 min,
  // so the first /leaders call warms the cache and the rest are essentially
  // free. Sequential keeps stats.nba.com happy on a true cold start.
  const teams = await getTeams();
  const teamMap = new Map(teams.map((team) => [team.id, team]));

  const leaderSets: NbaLeader[][] = [];
  for (const stat of leaderCategories) {
    leaderSets.push(await getLeaders(stat.id, season, seasonType));
  }

  return {
    categories: leaderCategories.map((stat, index) => ({
      ...stat,
      leaders: leaderSets[index]?.slice(0, TOP_N_PER_CARD) ?? []
    })),
    teamMap
  };
}

function SeasonPickerModal({
  visible,
  seasons,
  selected,
  onSelect,
  onClose
}: {
  visible: boolean;
  seasons: number[];
  selected: number;
  onSelect: (season: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.pickerBackdrop}>
        <Pressable onPress={() => undefined} style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Select Season</Text>
          <ScrollView style={styles.pickerList}>
            {seasons.map((s) => {
              const active = s === selected;
              return (
                <Pressable
                  key={s}
                  onPress={() => onSelect(s)}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                >
                  <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>
                    {formatSeasonLabel(s)}
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

function StatCategoryCard({
  category,
  teamMap,
  onPress
}: {
  category: StatCategory;
  teamMap: Map<number, NbaTeam>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{category.title}</Text>
      </View>
      <View>
        {category.leaders.map((leader, index) => (
          <LeaderRow
            isLast={index === category.leaders.length - 1}
            key={`${category.id}-${leader.player.id}`}
            leader={leader}
            statType={category.id}
            teamMap={teamMap}
          />
        ))}
      </View>
    </Pressable>
  );
}

function LeaderRow({
  isLast,
  leader,
  statType,
  teamMap
}: {
  isLast: boolean;
  leader: NbaLeader;
  statType: StatType;
  teamMap: Map<number, NbaTeam>;
}) {
  const team = leader.player.team ?? (leader.player.team_id ? teamMap.get(leader.player.team_id) : undefined);

  return (
    <View style={[styles.leaderRow, !isLast && styles.leaderDivider]}>
      <View style={styles.leaderIdentity}>
        <Text style={styles.rank}>{leader.rank}</Text>
        <PlayerAvatar player={leader.player} size={38} />
        <View style={styles.leaderCopy}>
          <Text numberOfLines={1} style={styles.leaderName}>
            {playerName(leader.player)}
          </Text>
          <Text numberOfLines={1} style={styles.leaderTeam}>
            {team?.abbreviation ?? "NBA"} / {leader.games_played} GP
          </Text>
        </View>
      </View>
      <Text style={styles.statValue}>{formatLeaderValue(statType, leader.value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: "center"
  },
  contentShell: {
    maxWidth: 1320,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
    width: "100%"
  },
  hero: {
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  heroTitle: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 26,
    letterSpacing: 0,
    lineHeight: 30,
    textTransform: "uppercase",
    transform: [{ skewX: "-7deg" }]
  },
  heroSubtitle: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.55,
    lineHeight: 13,
    marginTop: 2,
    opacity: 0.72,
    textTransform: "uppercase"
  },
  controlsRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs
  },
  seasonButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  seasonButtonLabel: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  seasonButtonValue: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 13
  },
  segmentedControl: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 4
  },
  segmentButton: {
    borderRadius: 6,
    minWidth: 84,
    paddingHorizontal: spacing.md,
    paddingVertical: 6
  },
  segmentButtonActive: {
    backgroundColor: colors.secondary
  },
  segmentText: {
    color: "#A5ACB8",
    fontFamily: fonts.heading,
    fontSize: 12,
    lineHeight: 15,
    textAlign: "center",
    textTransform: "capitalize"
  },
  segmentTextActive: {
    color: colors.white
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
  },
  // 2-column grid on wide screens; cells fall back to single column once the
  // viewport is narrower than the per-card minWidth (so phones still get the
  // stacked layout).
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.gutter
  },
  gridCell: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 360
  },
  statsStack: {
    gap: spacing.gutter
  },
  card: {
    backgroundColor: "rgba(14, 30, 54, 0.52)",
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  cardHeader: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  cardTitle: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 14,
    lineHeight: 19
  },
  leaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  leaderDivider: {
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1
  },
  leaderIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0
  },
  rank: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center",
    width: 16
  },
  leaderCopy: {
    flex: 1,
    minWidth: 0
  },
  leaderName: {
    color: colors.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 17
  },
  leaderTeam: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.45,
    lineHeight: 11,
    marginTop: 2,
    textTransform: "uppercase"
  },
  statValue: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    lineHeight: 19,
    marginLeft: spacing.sm
  },
  compactGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.gutter
  },
  compactCard: {
    backgroundColor: "rgba(14, 30, 54, 0.52)",
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.md
  },
  compactHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm
  },
  compactLabel: {
    color: "#A5ACB8",
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
    lineHeight: 11,
    textTransform: "uppercase"
  },
  compactRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  },
  compactPlayer: {
    color: colors.white,
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 15,
    minWidth: 0
  },
  compactValue: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    lineHeight: 17
  },
  compactValueFeatured: {
    color: colors.secondary
  },
  compactEmpty: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 15
  },
  pressed: {
    opacity: 0.72
  }
});
