import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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

type StatCategory = {
  id: StatType;
  title: string;
  leaders: NbaLeader[];
};

type StatsData = {
  categories: StatCategory[];
  compact: StatCategory[];
  teamMap: Map<number, NbaTeam>;
};

const season = getCurrentNbaSeason();
const primaryStats: Array<Omit<StatCategory, "leaders">> = [
  { id: "pts", title: "Points per Game" },
  { id: "reb", title: "Rebounds per Game" },
  { id: "ast", title: "Assists per Game" }
];

const compactStats: Array<Omit<StatCategory, "leaders">> = [
  { id: "stl", title: "Steals Leader" },
  { id: "blk", title: "Blocks Leader" },
  { id: "fg_pct", title: "FG% Leader" }
];

export function StatsScreen() {
  const { data, error, loading, reload } = useAsyncData(loadStatsData, []);
  const [openStat, setOpenStat] = useState<StatType | null>(null);
  const teamsArray = useMemo(() => Array.from(data?.teamMap.values() ?? []), [data]);

  return (
    <ScrollView bounces={false} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.contentShell}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Season Leaders</Text>
          <Text style={styles.heroSubtitle}>{formatSeasonLabel(season)} / Regular Season</Text>
        </View>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {!loading && !error && data?.categories.every((category) => category.leaders.length === 0) ? (
          <EmptyState message="No leaders available for this season." />
        ) : null}

        {!loading && !error && data ? (
          <>
            <View style={styles.statsStack}>
              {data.categories.map((category) => (
                <StatCategoryCard
                  category={category}
                  key={category.id}
                  teamMap={data.teamMap}
                  onPress={() => setOpenStat(category.id)}
                />
              ))}
            </View>

            <View style={styles.compactGrid}>
              {data.compact.map((category) => {
                const leader = category.leaders[0];

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={category.id}
                    onPress={() => setOpenStat(category.id)}
                    style={({ pressed }) => [styles.compactCard, pressed && styles.pressed]}
                  >
                    <View style={styles.compactHeader}>
                      <Text style={styles.compactLabel}>{category.title}</Text>
                    </View>
                    {leader ? (
                      <View style={styles.compactRow}>
                        <PlayerAvatar player={leader.player} size={28} />
                        <Text numberOfLines={1} style={styles.compactPlayer}>
                          {playerName(leader.player)}
                        </Text>
                        <Text style={[styles.compactValue, category.id === "stl" && styles.compactValueFeatured]}>
                          {formatLeaderValue(category.id, leader.value)}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.compactEmpty}>Unavailable</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </View>
      <PlayerLeadersModal
        visible={openStat !== null}
        initialStat={openStat}
        season={season}
        teams={teamsArray}
        onClose={() => setOpenStat(null)}
      />
    </ScrollView>
  );
}

async function loadStatsData(): Promise<StatsData> {
  // stats.nba.com rate-limits aggressive parallel requests, so fetch the six
  // leaders categories sequentially. The backend caches them for 5 min, so
  // subsequent loads are fast even though the cold path is serial.
  const teams = await getTeams();
  const teamMap = new Map(teams.map((team) => [team.id, team]));

  const allStats = [...primaryStats, ...compactStats];
  const leaderSets: NbaLeader[][] = [];
  for (const stat of allStats) {
    leaderSets.push(await getLeaders(stat.id, season));
  }

  const primaryLeaderSets = leaderSets.slice(0, primaryStats.length);
  const compactLeaderSets = leaderSets.slice(primaryStats.length);

  return {
    categories: primaryStats.map((stat, index) => ({
      ...stat,
      leaders: primaryLeaderSets[index]?.slice(0, 3) ?? []
    })),
    compact: compactStats.map((stat, index) => ({
      ...stat,
      leaders: compactLeaderSets[index]?.slice(0, 1) ?? []
    })),
    teamMap
  };
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
    alignItems: "center",
    paddingBottom: 90
  },
  contentShell: {
    maxWidth: 768,
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
  leaderRowFeatured: {
    backgroundColor: "rgba(255,107,0,0.06)"
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
  rankFeatured: {
    color: colors.secondary
  },
  initialsAvatar: {
    alignItems: "center",
    backgroundColor: "#172235",
    borderRadius: 19,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  initialsAvatarFeatured: {
    borderColor: colors.secondary,
    borderWidth: 1
  },
  initialsText: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14
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
  leaderNameFeatured: {
    fontFamily: fonts.bodyBold
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
  statValueFeatured: {
    color: colors.secondary,
    fontSize: 19,
    lineHeight: 22
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
