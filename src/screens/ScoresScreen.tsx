import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BoxScoreModal } from "../components/BoxScoreModal";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  buildDateOptions,
  formatIsoDate,
  getGameClockLabel,
  getGamesByDate,
  getGameState,
  teamLogoUri,
  type NbaGame,
  type NbaTeam
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";

export function ScoresScreen() {
  const today = useMemo(() => formatIsoDate(new Date()), []);
  const dateOptions = useMemo(() => buildDateOptions(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [openGame, setOpenGame] = useState<NbaGame | null>(null);
  const { data: games, error, loading, reload } = useAsyncData(() => getGamesByDate(selectedDate), [selectedDate]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} bounces={false}>
      <View style={styles.contentShell}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateScroller}>
          {dateOptions.map((date) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selectedDate === date.id }}
              key={date.id}
              onPress={() => setSelectedDate(date.id)}
              style={({ pressed }) => [
                styles.datePill,
                selectedDate === date.id && styles.datePillActive,
                pressed && styles.pressed
              ]}
            >
              <Text style={[styles.dateWeekday, selectedDate === date.id && styles.dateWeekdayActive]}>{date.weekday}</Text>
              <Text style={[styles.dateDay, selectedDate === date.id && styles.dateDayActive]}>{date.day}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.sectionTitle}>NBA Games</Text>
          </View>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={reload}>
            <Text style={styles.viewAll}>Refresh</Text>
          </Pressable>
        </View>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {!loading && !error && games?.length === 0 ? (
          <EmptyState message="No NBA games scheduled for this date." title="No Games" />
        ) : null}

        {!loading && !error && games ? (
          <View style={styles.gamesStack}>
            {games.map((game) => (
              <GameCard game={game} key={game.id} onPress={() => setOpenGame(game)} />
            ))}
          </View>
        ) : null}
      </View>
      <BoxScoreModal game={openGame} onClose={() => setOpenGame(null)} />
    </ScrollView>
  );
}

function GameCard({ game, onPress }: { game: NbaGame; onPress: () => void }) {
  const state = getGameState(game);
  const isLive = state === "live";
  const isFinal = state === "final";
  const clockLabel = getGameClockLabel(game);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.gameCard, isLive && styles.liveGameCard, isFinal && styles.finalGameCard, pressed && styles.pressed]}
    >
      <View style={styles.gameCardMain}>
        <TeamBadge team={game.visitor_team} />
        <View style={styles.matchupCenter}>
          <Text style={[styles.gameMeta, isLive && styles.gameMetaLive]}>{state === "upcoming" ? "Tip-Off" : clockLabel}</Text>
          {state === "upcoming" ? (
            <Text style={styles.tipTime}>{clockLabel}</Text>
          ) : (
            <View style={[styles.scoreRow, isFinal && styles.finalScoreRow]}>
              <Text style={[styles.score, isFinal && styles.finalScore]}>{game.visitor_team_score}</Text>
              {isLive ? <Text style={styles.scoreSeparator}>:</Text> : null}
              <Text style={[styles.score, isLive && styles.scoreLeader, isFinal && styles.finalScore]}>{game.home_team_score}</Text>
            </View>
          )}
          {game.postseason ? (
            <View style={styles.contextPill}>
              <Text style={styles.contextText}>Playoffs</Text>
            </View>
          ) : null}
        </View>
        <TeamBadge team={game.home_team} />
      </View>
    </Pressable>
  );
}

function TeamBadge({ team }: { team: NbaTeam }) {
  return (
    <View style={styles.teamColumn}>
      <Image source={{ uri: teamLogoUri(team) }} style={styles.teamLogo} />
      <Text style={styles.teamAbbreviation}>{team.abbreviation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: "center",
    paddingBottom: 86
  },
  contentShell: {
    maxWidth: 768,
    paddingHorizontal: spacing.gutter,
    width: "100%"
  },
  dateScroller: {
    gap: 6,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm
  },
  datePill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    borderWidth: 1,
    minWidth: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5
  },
  datePillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  dateWeekday: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    lineHeight: 10,
    textTransform: "uppercase"
  },
  dateWeekdayActive: {
    color: "#572000"
  },
  dateDay: {
    color: colors.onBackground,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    lineHeight: 17
  },
  dateDayActive: {
    color: colors.white
  },
  pressed: {
    opacity: 0.72
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  sectionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7
  },
  sectionTitle: {
    color: "#CDD3DD",
    fontFamily: fonts.heading,
    fontSize: 12,
    letterSpacing: 1.15,
    lineHeight: 16,
    textTransform: "uppercase"
  },
  viewAll: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    lineHeight: 11,
    textTransform: "uppercase"
  },
  liveDot: {
    backgroundColor: colors.tertiary,
    borderRadius: 4,
    height: 7,
    width: 7
  },
  gamesStack: {
    gap: spacing.sm
  },
  gameCard: {
    backgroundColor: colors.card,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  liveGameCard: {
    borderColor: "rgba(0,255,194,0.22)"
  },
  finalGameCard: {
    opacity: 0.78
  },
  gameCardMain: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 88,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.gutter
  },
  teamColumn: {
    alignItems: "center",
    justifyContent: "center",
    width: 64
  },
  teamLogo: {
    height: 34,
    marginBottom: 4,
    resizeMode: "contain",
    width: 34
  },
  teamAbbreviation: {
    color: colors.onBackground,
    fontFamily: fonts.heading,
    fontSize: 13,
    lineHeight: 17
  },
  matchupCenter: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  gameMeta: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.8,
    lineHeight: 10,
    marginBottom: 3,
    textTransform: "uppercase"
  },
  gameMetaLive: {
    color: colors.tertiary
  },
  scoreRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  finalScoreRow: {
    gap: 14,
    opacity: 0.85
  },
  score: {
    color: colors.white,
    fontFamily: fonts.scoreboard,
    fontSize: 22,
    letterSpacing: 0,
    lineHeight: 26
  },
  scoreLeader: {
    color: colors.secondary
  },
  finalScore: {
    fontSize: 19,
    lineHeight: 23
  },
  scoreSeparator: {
    color: "#526071",
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    lineHeight: 19
  },
  tipTime: {
    color: "#CDD3DD",
    fontFamily: fonts.scoreboard,
    fontSize: 19,
    lineHeight: 22
  },
  contextPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.pill,
    marginTop: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3
  },
  contextText: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.75,
    lineHeight: 10,
    textTransform: "uppercase"
  }
});
