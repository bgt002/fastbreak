import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BoxScoreContent } from "../components/BoxScoreModal";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  formatIsoDate,
  formatTipOff,
  getCurrentNbaSeason,
  getGameClockLabel,
  getGamesByDate,
  getGameState,
  getPostseasonGames,
  getStandings,
  teamLogoUri,
  type NbaGame,
  type NbaTeam
} from "../services/nbaApi";
import { colors, fonts, radii, spacing } from "../theme";

type SeriesEntry = { teamA: number; scoreA: number; teamB: number; scoreB: number };
type TeamRecord = { wins: number; losses: number };

const VISIBLE_DAYS = 7;

export function ScoresScreenDesktop() {
  const today = useMemo(() => formatIsoDate(new Date()), []);
  const season = useMemo(() => getCurrentNbaSeason(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [windowStart, setWindowStart] = useState(() => shiftIsoDate(today, -3));
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handlePrevWeek = useCallback(() => setWindowStart((prev) => shiftIsoDate(prev, -7)), []);
  const handleNextWeek = useCallback(() => setWindowStart((prev) => shiftIsoDate(prev, 7)), []);
  const handleToday = useCallback(() => {
    setSelectedDate(today);
    setWindowStart(shiftIsoDate(today, -3));
  }, [today]);
  const handleCalendarSelect = useCallback((iso: string) => {
    setSelectedDate(iso);
    setWindowStart(shiftIsoDate(iso, -3));
    setCalendarOpen(false);
  }, []);

  const { data: games, error, loading, reload, silentReload } = useAsyncData(
    () => getGamesByDate(selectedDate),
    [selectedDate]
  );
  const { data: standings } = useAsyncData(() => getStandings(season), [season]);
  const { data: postseasonGames } = useAsyncData(() => getPostseasonGames(season), [season]);

  const recordByTeam = useMemo(() => {
    const map = new Map<number, TeamRecord>();
    standings?.forEach((s) => map.set(s.team.id, { wins: s.wins, losses: s.losses }));
    return map;
  }, [standings]);

  const seriesByPair = useMemo(() => {
    if (!postseasonGames) return new Map<string, SeriesEntry>();
    const reconciled = new Map<string, NbaGame>(postseasonGames.map((g) => [g.id, g]));
    games?.forEach((g) => {
      if (reconciled.has(g.id)) reconciled.set(g.id, g);
    });
    return aggregateSeriesScores([...reconciled.values()]);
  }, [postseasonGames, games]);

  const visibleGames = useMemo(() => {
    if (!games) return games;
    return games.filter((game) => {
      if (!game.postseason) return true;
      if (getGameState(game) !== "upcoming") return true;
      const { key } = seriesPairKey(game.home_team.id, game.visitor_team.id);
      const series = seriesByPair.get(key);
      if (!series) return true;
      return series.scoreA < 4 && series.scoreB < 4;
    });
  }, [games, seriesByPair]);

  // Auto-select the first game whenever the list changes; keep the user's
  // pick if it's still in the current set.
  useEffect(() => {
    if (!visibleGames || visibleGames.length === 0) {
      setSelectedGameId(null);
      return;
    }
    const stillVisible = selectedGameId && visibleGames.some((g) => g.id === selectedGameId);
    if (!stillVisible) {
      setSelectedGameId(visibleGames[0]!.id);
    }
  }, [visibleGames, selectedGameId]);

  const selectedGame = useMemo(
    () => visibleGames?.find((g) => g.id === selectedGameId) ?? null,
    [visibleGames, selectedGameId]
  );

  const hasLiveGame = games?.some((g) => getGameState(g) === "live") ?? false;
  useEffect(() => {
    if (selectedDate !== today || !hasLiveGame) return;
    const id = setInterval(silentReload, 5000);
    return () => clearInterval(id);
  }, [selectedDate, today, hasLiveGame, silentReload]);

  const dateOptions = useMemo(() => buildDateStrip(windowStart, today), [windowStart, today]);

  return (
    <View style={styles.container}>
      <View style={styles.leftPane}>
        <DateStrip
          options={dateOptions}
          selected={selectedDate}
          onSelect={setSelectedDate}
          onToday={handleToday}
          onPrev={handlePrevWeek}
          onNext={handleNextWeek}
          onOpenCalendar={() => setCalendarOpen(true)}
        />
        <View style={styles.listHeader}>
          <View style={styles.listHeaderTitleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.listHeaderTitle}>NBA Games</Text>
          </View>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={reload} style={({ pressed }) => [pressed && styles.pressed]}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.listScroll} showsVerticalScrollIndicator>
          {loading ? <LoadingState /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}
          {!loading && !error && visibleGames?.length === 0 ? (
            <EmptyState message="No NBA games scheduled for this date." title="No Games" />
          ) : null}
          {!loading && !error && visibleGames ? (
            <View style={styles.cardsStack}>
              {visibleGames.map((game) => (
                <GameRow
                  game={game}
                  key={game.id}
                  selected={game.id === selectedGameId}
                  onPress={() => setSelectedGameId(game.id)}
                  recordByTeam={recordByTeam}
                  seriesByPair={seriesByPair}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={styles.rightPane}>
        {selectedGame ? (
          <BoxScoreContent key={selectedGame.id} game={selectedGame} />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons color="#566275" name="basketball-outline" size={48} />
            <Text style={styles.placeholderTitle}>Pick a game</Text>
            <Text style={styles.placeholderText}>
              Select a game on the left to see the box score, line score, and player stats.
            </Text>
          </View>
        )}
      </View>

      <CalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        onSelect={handleCalendarSelect}
        onClose={() => setCalendarOpen(false)}
      />
    </View>
  );
}

function DateStrip({
  options,
  selected,
  onSelect,
  onToday,
  onPrev,
  onNext,
  onOpenCalendar
}: {
  options: { id: string; weekday: string; day: string; isToday: boolean }[];
  selected: string;
  onSelect: (iso: string) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenCalendar: () => void;
}) {
  // Use the leftmost visible day for the month label, since the strip can
  // span two months. Falls back to selected date if the window is empty.
  const labelDate = options[0]?.id ?? selected;
  return (
    <View style={styles.dateStripWrap}>
      <View style={styles.dateStripHeader}>
        <Text style={styles.dateStripLabel}>
          {parseIsoDate(labelDate).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <View style={styles.dateStripHeaderActions}>
          <Pressable
            accessibilityRole="button"
            onPress={onToday}
            style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open calendar"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onOpenCalendar}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.white} name="calendar-outline" size={18} />
          </Pressable>
        </View>
      </View>
      <View style={styles.dateStripRow}>
        <Pressable
          accessibilityLabel="Previous week"
          accessibilityRole="button"
          hitSlop={6}
          onPress={onPrev}
          style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.white} name="chevron-back" size={18} />
        </Pressable>
        <View style={styles.dateStrip}>
          {options.map((d) => {
            const active = selected === d.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={d.id}
                onPress={() => onSelect(d.id)}
                style={({ pressed }) => [
                  styles.datePill,
                  active && styles.datePillActive,
                  d.isToday && !active && styles.datePillToday,
                  pressed && styles.pressed
                ]}
              >
                <Text style={[styles.dateWeekday, active && styles.dateWeekdayActive]}>
                  {d.isToday ? "Today" : d.weekday}
                </Text>
                <Text style={[styles.dateDay, active && styles.dateDayActive]}>{d.day}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityLabel="Next week"
          accessibilityRole="button"
          hitSlop={6}
          onPress={onNext}
          style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.white} name="chevron-forward" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

function CalendarModal({
  visible,
  selectedDate,
  onSelect,
  onClose
}: {
  visible: boolean;
  selectedDate: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(selectedDate));
  useEffect(() => {
    if (visible) setViewMonth(firstOfMonth(selectedDate));
  }, [visible, selectedDate]);

  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [viewMonth]);

  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayIso = formatIsoDate(new Date());

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.calendarBackdrop}>
        <Pressable onPress={() => undefined} style={styles.calendarSheet}>
          <View style={styles.calendarHeader}>
            <Pressable
              accessibilityLabel="Previous month"
              hitSlop={8}
              onPress={() => setViewMonth(addMonths(viewMonth, -1))}
              style={({ pressed }) => [styles.calendarNav, pressed && styles.pressed]}
            >
              <Ionicons color={colors.white} name="chevron-back" size={20} />
            </Pressable>
            <Text style={styles.calendarTitle}>{monthLabel}</Text>
            <Pressable
              accessibilityLabel="Next month"
              hitSlop={8}
              onPress={() => setViewMonth(addMonths(viewMonth, 1))}
              style={({ pressed }) => [styles.calendarNav, pressed && styles.pressed]}
            >
              <Ionicons color={colors.white} name="chevron-forward" size={20} />
            </Pressable>
          </View>
          <View style={styles.calendarDow}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <Text key={i} style={styles.calendarDowText}>
                {d}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {cells.map((day, i) => {
              if (day === null) return <View key={i} style={styles.calendarCell} />;
              const iso = formatIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
              const isSelected = iso === selectedDate;
              const isToday = iso === todayIso;
              return (
                <Pressable
                  key={i}
                  onPress={() => onSelect(iso)}
                  style={({ pressed }) => [
                    styles.calendarCell,
                    isToday && !isSelected && styles.calendarCellToday,
                    isSelected && styles.calendarCellActive,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={[styles.calendarDay, isSelected && styles.calendarDayActive]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GameRow({
  game,
  selected,
  onPress,
  recordByTeam,
  seriesByPair
}: {
  game: NbaGame;
  selected: boolean;
  onPress: () => void;
  recordByTeam: Map<number, TeamRecord>;
  seriesByPair: Map<string, SeriesEntry>;
}) {
  const state = getGameState(game);
  const isLive = state === "live";
  const isFinal = state === "final";
  const ifNecessary = state === "upcoming" && Boolean(game.if_necessary);
  const tipLabel = ifNecessary ? "TBD" : formatTipOff(game) ?? game.status ?? getGameClockLabel(game);
  const seriesLabel = game.postseason ? getSeriesLabel(seriesByPair, game) : null;

  const homeWinning = isFinal && game.home_team_score > game.visitor_team_score;
  const visitorWinning = isFinal && game.visitor_team_score > game.home_team_score;

  const visitorRecord = !game.postseason ? recordByTeam.get(game.visitor_team.id) : undefined;
  const homeRecord = !game.postseason ? recordByTeam.get(game.home_team.id) : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={(state) => {
        // hovered is a react-native-web extension
        const { pressed } = state;
        const hovered = (state as { hovered?: boolean }).hovered;
        return [
          styles.card,
          selected && styles.cardSelected,
          hovered && !selected && styles.cardHovered,
          pressed && styles.pressed
        ];
      }}
    >
      {game.postseason && game.series_label ? (
        <Text style={styles.cardRoundLabel}>{game.series_label}</Text>
      ) : null}

      <View style={styles.cardBody}>
        <CardTeam team={game.visitor_team} record={visitorRecord} />
        <View style={styles.cardCenter}>
          {seriesLabel ? <Text style={styles.cardSeriesScore}>{seriesLabel}</Text> : null}
          {state === "upcoming" ? (
            <>
              <Text style={styles.cardTipLabel}>Tip-Off</Text>
              <Text style={styles.cardTip}>{tipLabel}</Text>
              {ifNecessary ? <Text style={styles.cardIfNecessary}>*if necessary</Text> : null}
            </>
          ) : (
            <View style={styles.cardScoreRow}>
              <Text style={[styles.cardScore, visitorWinning && styles.cardScoreWin, !visitorWinning && isFinal && styles.cardScoreLoss]}>
                {game.visitor_team_score}
              </Text>
              <Text style={[styles.cardStateLabel, isLive && styles.cardStateLive]}>
                {isLive ? getGameClockLabel(game) : "Final"}
              </Text>
              <Text style={[styles.cardScore, homeWinning && styles.cardScoreWin, !homeWinning && isFinal && styles.cardScoreLoss]}>
                {game.home_team_score}
              </Text>
            </View>
          )}
        </View>
        <CardTeam team={game.home_team} record={homeRecord} />
      </View>
    </Pressable>
  );
}

function CardTeam({ team, record }: { team: NbaTeam; record?: TeamRecord }) {
  return (
    <View style={styles.cardTeamColumn}>
      <Image source={{ uri: teamLogoUri(team) }} style={styles.cardTeamLogo} />
      <Text style={styles.cardTeamAbbr}>{team.abbreviation}</Text>
      {record ? (
        <Text style={styles.cardTeamRecord}>
          {record.wins}-{record.losses}
        </Text>
      ) : null}
    </View>
  );
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function shiftIsoDate(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return formatIsoDate(d);
}

function buildDateStrip(windowStart: string, today: string) {
  return Array.from({ length: VISIBLE_DAYS }, (_, i) => {
    const iso = shiftIsoDate(windowStart, i);
    const d = parseIsoDate(iso);
    return {
      id: iso,
      weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      day: String(d.getDate()),
      isToday: iso === today
    };
  });
}

function firstOfMonth(iso: string): Date {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function seriesPairKey(homeId: number, visitorId: number): { key: string; lowId: number } {
  const lowId = Math.min(homeId, visitorId);
  const highId = Math.max(homeId, visitorId);
  return { key: `${lowId}-${highId}`, lowId };
}

function aggregateSeriesScores(games: NbaGame[]): Map<string, SeriesEntry> {
  const map = new Map<string, SeriesEntry>();
  for (const game of games) {
    const { key, lowId } = seriesPairKey(game.home_team.id, game.visitor_team.id);
    const highId = lowId === game.home_team.id ? game.visitor_team.id : game.home_team.id;
    let entry = map.get(key);
    if (!entry) {
      entry = { teamA: lowId, scoreA: 0, teamB: highId, scoreB: 0 };
      map.set(key, entry);
    }
    if (getGameState(game) === "final") {
      const homeWon = game.home_team_score > game.visitor_team_score;
      const winnerId = homeWon ? game.home_team.id : game.visitor_team.id;
      if (winnerId === entry.teamA) entry.scoreA += 1;
      else entry.scoreB += 1;
    }
  }
  return map;
}

function getSeriesLabel(map: Map<string, SeriesEntry>, game: NbaGame): string | null {
  const { key } = seriesPairKey(game.home_team.id, game.visitor_team.id);
  const entry = map.get(key);
  if (!entry) return null;
  const visitorIsA = game.visitor_team.id === entry.teamA;
  const visitorScore = visitorIsA ? entry.scoreA : entry.scoreB;
  const homeScore = visitorIsA ? entry.scoreB : entry.scoreA;
  if (visitorScore === 0 && homeScore === 0) return null;
  return `${game.visitor_team.abbreviation} ${visitorScore}-${homeScore} ${game.home_team.abbreviation}`;
}

const LEFT_PANE_WIDTH = 420;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row"
  },
  leftPane: {
    backgroundColor: "rgba(5,11,20,0.65)",
    borderRightColor: "rgba(255,255,255,0.06)",
    borderRightWidth: 1,
    flexDirection: "column",
    width: LEFT_PANE_WIDTH
  },
  rightPane: {
    flex: 1,
    minWidth: 0
  },
  dateStripWrap: {
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md
  },
  dateStripHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm
  },
  dateStripHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  dateStripLabel: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 14
  },
  todayButton: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6
  },
  todayButtonText: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  dateStripRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  arrowButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 28
  },
  dateStrip: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between"
  },
  calendarBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.gutter
  },
  calendarSheet: {
    backgroundColor: colors.card,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.md,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.md,
    width: "100%"
  },
  calendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm
  },
  calendarNav: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
  },
  calendarTitle: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 15
  },
  calendarDow: {
    flexDirection: "row",
    paddingBottom: 6
  },
  calendarDowText: {
    color: "#7D8490",
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textAlign: "center",
    textTransform: "uppercase"
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  calendarCell: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: `${100 / 7}%`
  },
  calendarCellToday: {
    backgroundColor: "rgba(255,255,255,0.06)"
  },
  calendarCellActive: {
    backgroundColor: colors.secondary
  },
  calendarDay: {
    color: colors.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 18
  },
  calendarDayActive: {
    fontFamily: fonts.bodyBold
  },
  datePill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 6
  },
  datePillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  datePillToday: {
    borderColor: colors.secondary
  },
  dateWeekday: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  dateWeekdayActive: {
    color: "#572000"
  },
  dateDay: {
    color: colors.onBackground,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    marginTop: 1
  },
  dateDayActive: {
    color: colors.white
  },
  listHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md
  },
  listHeaderTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7
  },
  liveDot: {
    backgroundColor: colors.tertiary,
    borderRadius: 4,
    height: 7,
    width: 7
  },
  listHeaderTitle: {
    color: "#CDD3DD",
    fontFamily: fonts.heading,
    fontSize: 12,
    letterSpacing: 1.15,
    textTransform: "uppercase"
  },
  refreshText: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    textTransform: "uppercase"
  },
  listScroll: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md
  },
  cardsStack: {
    gap: spacing.sm
  },
  card: {
    backgroundColor: colors.card,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.gutter
  },
  cardSelected: {
    backgroundColor: "rgba(255,107,0,0.12)",
    borderColor: colors.secondary
  },
  cardHovered: {
    backgroundColor: "rgba(255,255,255,0.04)"
  },
  cardRoundLabel: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    marginBottom: 6,
    textAlign: "center",
    textTransform: "uppercase"
  },
  cardBody: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  cardCenter: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  cardSeriesScore: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  cardTipLabel: {
    color: "#7D8490",
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.8,
    marginBottom: 2,
    textTransform: "uppercase"
  },
  cardTip: {
    color: colors.white,
    fontFamily: fonts.scoreboard,
    fontSize: 16
  },
  cardIfNecessary: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    fontStyle: "italic",
    letterSpacing: 0.3,
    marginTop: 2
  },
  cardScoreRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  cardScore: {
    color: colors.white,
    fontFamily: fonts.scoreboard,
    fontSize: 20
  },
  cardScoreWin: {
    color: colors.win
  },
  cardScoreLoss: {
    color: colors.loss
  },
  cardStateLabel: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  cardStateLive: {
    color: colors.tertiary
  },
  cardTeamColumn: {
    alignItems: "center",
    width: 64
  },
  cardTeamLogo: {
    height: 32,
    resizeMode: "contain",
    width: 32
  },
  cardTeamAbbr: {
    color: colors.onBackground,
    fontFamily: fonts.heading,
    fontSize: 12,
    marginTop: 4
  },
  cardTeamRecord: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    marginTop: 1
  },
  placeholder: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: spacing.xl
  },
  placeholderTitle: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 18,
    marginTop: spacing.md
  },
  placeholderText: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    maxWidth: 320,
    textAlign: "center"
  },
  pressed: {
    opacity: 0.72
  }
});
