import { Fragment, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { NAV_CLEARANCE } from "../components/AppChrome";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  calculateGamesBack,
  calculatePct,
  formatSeasonLabel,
  getCurrentNbaSeason,
  getStandings,
  teamLogoUri,
  type NbaStanding
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";

type Conference = "east" | "west";

const standingsColumns = [
  { key: "w", label: "W", width: 48 },
  { key: "l", label: "L", width: 48 },
  { key: "pct", label: "PCT", width: 64 },
  { key: "gb", label: "GB", width: 60 },
  { key: "home", label: "Home", width: 72 },
  { key: "away", label: "Away", width: 72 },
  { key: "conf", label: "Conf", width: 72 },
  { key: "div", label: "Div", width: 64 },
  { key: "ppg", label: "PPG", width: 64 },
  { key: "oppPpg", label: "Opp PPG", width: 76 },
  { key: "diff", label: "Diff", width: 64 },
  { key: "strk", label: "Strk", width: 60 },
  { key: "l10", label: "L10", width: 60 }
] as const;

type ColumnKey = (typeof standingsColumns)[number]["key"];

const rankWidth = 42;
const teamWidth = 200;
const tableWidth = rankWidth + teamWidth + standingsColumns.reduce((total, column) => total + column.width, 0);

const season = getCurrentNbaSeason();

export function StandingsScreen() {
  const [conference, setConference] = useState<Conference>("west");
  const { data, error, loading, reload } = useAsyncData(() => getStandings(season), []);

  const grouped = useMemo(() => {
    if (!data) {
      return { east: [], west: [] };
    }

    const east = data
      .filter((row) => row.team.conference === "East")
      .sort((a, b) => a.conference_rank - b.conference_rank);
    const west = data
      .filter((row) => row.team.conference === "West")
      .sort((a, b) => a.conference_rank - b.conference_rank);

    return { east, west };
  }, [data]);

  const rows = grouped[conference];
  const leader = rows[0];
  let cutoffRendered = false;

  return (
    <ScrollView
      bounces={false}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: NAV_CLEARANCE as number }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.contentShell}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Conference Standings</Text>
          <Text style={styles.heroSubtitle}>{formatSeasonLabel(season)} Regular Season / Live Updates</Text>
        </View>

        <View style={styles.segmentedControl}>
          {(["west", "east"] as const).map((item) => {
            const active = conference === item;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={item}
                onPress={() => setConference(item)}
                style={({ pressed }) => [styles.segmentButton, active && styles.segmentButtonActive, pressed && styles.pressed]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{item}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState message="No standings available for this season." />
        ) : null}

        {!loading && !error && rows.length > 0 ? (
          <View style={styles.tablePanel}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={[styles.table, { width: tableWidth }]}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.headerCell, styles.rankCell]}>RK</Text>
                  <Text style={[styles.headerCell, styles.teamHeaderCell]}>Team</Text>
                  {standingsColumns.map((column) => (
                    <Text key={column.key} style={[styles.headerCell, { width: column.width }]}>
                      {column.label}
                    </Text>
                  ))}
                </View>

                {rows.map((row) => {
                  const shouldRenderCutoff = row.conference_rank >= 7 && !cutoffRendered;
                  if (shouldRenderCutoff) {
                    cutoffRendered = true;
                  }

                  return (
                    <Fragment key={row.team.id}>
                      {shouldRenderCutoff ? (
                        <View style={styles.cutoffRow}>
                          <Text style={styles.cutoffText}>Play-In Cutoff</Text>
                        </View>
                      ) : null}
                      <StandingTableRow leader={leader} row={row} />
                    </Fragment>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function StandingTableRow({ leader, row }: { leader?: NbaStanding; row: NbaStanding }) {
  const highlighted = row.conference_rank === 1;
  const diff = row.diff_points_pg ?? 0;
  const streak = row.streak ?? "";
  const streakIsWin = streak.startsWith("W");
  const streakIsLoss = streak.startsWith("L");
  const values: Record<ColumnKey, string> = {
    w: String(row.wins),
    l: String(row.losses),
    pct: calculatePct(row.wins, row.losses),
    gb: calculateGamesBack(row, leader),
    home: row.home_record,
    away: row.road_record,
    conf: row.conference_record,
    div: row.division_record,
    ppg: row.points_pg !== undefined ? row.points_pg.toFixed(1) : "—",
    oppPpg: row.opp_points_pg !== undefined ? row.opp_points_pg.toFixed(1) : "—",
    diff: row.diff_points_pg !== undefined ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}` : "—",
    strk: streak.replace(/\s+/g, "") || "—",
    l10: row.last_ten || "—"
  };

  return (
    <View style={[styles.tableRow, styles.bodyRow, highlighted && styles.bodyRowHighlighted]}>
      <Text style={[styles.bodyCell, styles.rankCell, highlighted && styles.rankHighlighted]}>{row.conference_rank}</Text>
      <View style={styles.teamCell}>
        <Image source={{ uri: teamLogoUri(row.team) }} style={styles.teamLogo} />
        <View style={styles.teamCopy}>
          <Text numberOfLines={1} style={styles.teamName}>
            {row.team.full_name}
          </Text>
          <Text numberOfLines={1} style={styles.teamNote}>
            {row.team.division}
          </Text>
        </View>
      </View>
      {standingsColumns.map((column) => {
        const value = values[column.key];
        const cellStyle = [styles.bodyCell] as Array<object>;
        if (column.key === "diff" && row.diff_points_pg !== undefined) {
          cellStyle.push(diff > 0 ? styles.diffPositive : diff < 0 ? styles.diffNegative : styles.bodyCell);
        } else if (column.key === "strk") {
          if (streakIsWin) cellStyle.push(styles.diffPositive);
          else if (streakIsLoss) cellStyle.push(styles.diffNegative);
        }
        return (
          <View key={column.key} style={[styles.metricCell, { width: column.width }]}>
            <Text style={cellStyle}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: "center"
  },
  contentShell: {
    maxWidth: 1120,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    width: "100%"
  },
  hero: {
    marginBottom: spacing.md
  },
  heroTitle: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 30,
    letterSpacing: 0,
    lineHeight: 35,
    textTransform: "uppercase",
    transform: [{ skewX: "-7deg" }]
  },
  heroSubtitle: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.75,
    lineHeight: 13,
    marginTop: 2,
    opacity: 0.7,
    textTransform: "uppercase"
  },
  segmentedControl: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    marginBottom: spacing.md,
    padding: 4
  },
  segmentButton: {
    borderRadius: 6,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: 7
  },
  segmentButtonActive: {
    backgroundColor: colors.secondary
  },
  segmentText: {
    color: "#A5ACB8",
    fontFamily: fonts.heading,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
    textTransform: "capitalize"
  },
  segmentTextActive: {
    color: colors.white
  },
  tablePanel: {
    backgroundColor: "rgba(14, 30, 54, 0.66)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  table: {
    backgroundColor: "transparent"
  },
  tableRow: {
    alignItems: "stretch",
    flexDirection: "row"
  },
  tableHeader: {
    backgroundColor: "rgba(49, 53, 55, 0.72)"
  },
  headerCell: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 13,
    paddingHorizontal: 8,
    paddingVertical: 10,
    textAlign: "center",
    textTransform: "uppercase"
  },
  rankCell: {
    width: rankWidth
  },
  teamHeaderCell: {
    textAlign: "left",
    width: teamWidth
  },
  bodyRow: {
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1,
    minHeight: 62
  },
  bodyRowHighlighted: {
    backgroundColor: "rgba(255,107,0,0.06)"
  },
  bodyCell: {
    alignSelf: "center",
    color: colors.onSurface,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center"
  },
  rankHighlighted: {
    color: colors.secondary
  },
  diffPositive: {
    color: colors.win
  },
  diffNegative: {
    color: colors.loss
  },
  teamCell: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    width: teamWidth
  },
  teamLogo: {
    height: 28,
    resizeMode: "contain",
    width: 28
  },
  teamCopy: {
    flex: 1,
    minWidth: 0
  },
  teamName: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14
  },
  teamNote: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.45,
    lineHeight: 10,
    marginTop: 3,
    textTransform: "uppercase"
  },
  metricCell: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4
  },
  cutoffRow: {
    alignItems: "center",
    backgroundColor: "rgba(28, 32, 34, 0.52)",
    borderTopColor: "rgba(255,107,0,0.2)",
    borderTopWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    width: tableWidth
  },
  cutoffText: {
    color: "rgba(255,107,0,0.82)",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1.4,
    lineHeight: 11,
    textTransform: "uppercase"
  },
  pressed: {
    opacity: 0.72
  }
});
