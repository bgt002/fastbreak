import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

import { BoxScoreModal } from "../components/BoxScoreModal";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  formatIsoDate,
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

type TeamRecord = { wins: number; losses: number };
type SeriesEntry = { teamA: number; scoreA: number; teamB: number; scoreB: number };
type WeekDay = { id: string; weekday: string; day: string; isToday: boolean };
type Week = { id: string; days: WeekDay[] };

const WEEKS_BACK = 52;
const WEEKS_FORWARD = 52;
const TODAY_WEEK_INDEX = WEEKS_BACK;

function parseIsoDate(iso: string): Date {
  const parts = iso.split("-").map(Number);
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

function shiftDate(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

function startOfWeek(iso: string): Date {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

export function ScoresScreen() {
  const today = useMemo(() => formatIsoDate(new Date()), []);
  const season = useMemo(() => getCurrentNbaSeason(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [openGame, setOpenGame] = useState<NbaGame | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { data: games, error, loading, reload, silentReload } = useAsyncData(() => getGamesByDate(selectedDate), [selectedDate]);
  const { data: standings } = useAsyncData(() => getStandings(season), [season]);
  const { data: postseasonGames } = useAsyncData(() => getPostseasonGames(season), [season]);

  const recordByTeam = useMemo(() => {
    const map = new Map<number, TeamRecord>();
    standings?.forEach((s) => map.set(s.team.id, { wins: s.wins, losses: s.losses }));
    return map;
  }, [standings]);

  const seriesByPair = useMemo(() => {
    if (!postseasonGames) return new Map();
    // The /playoffs endpoint marks every game as "Final", which over-counts
    // wins while a game is in progress. Overlay the current view's games
    // (which carry accurate live state) before aggregating.
    const reconciled = new Map<string, NbaGame>(postseasonGames.map((g) => [g.id, g]));
    games?.forEach((g) => {
      if (reconciled.has(g.id)) reconciled.set(g.id, g);
    });
    return aggregateSeriesScores([...reconciled.values()]);
  }, [postseasonGames, games]);

  // ScoreboardV2 lists every potential "if necessary" playoff game for a date,
  // including ones for series that are already over (e.g., a Game 5 placeholder
  // for a series someone won 4-0). Drop those so the user only sees games that
  // will actually be played.
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

  const hasLiveGame = games?.some((game) => getGameState(game) === "live") ?? false;
  useEffect(() => {
    if (selectedDate !== today || !hasLiveGame) {
      return;
    }
    const interval = setInterval(silentReload, 5000);
    return () => clearInterval(interval);
  }, [selectedDate, today, hasLiveGame, silentReload]);

  const handlePullRefresh = useCallback(async () => {
    setRefreshing(true);
    await silentReload();
    setRefreshing(false);
  }, [silentReload]);

  // Fixed range of paged weeks centered on today. The list itself never
  // re-orders, so paging stays smooth; the user pages through real time.
  const weeks = useMemo<Week[]>(() => {
    const todayWeek = startOfWeek(today);
    return Array.from({ length: WEEKS_BACK + WEEKS_FORWARD + 1 }, (_, weekIndex) => {
      const start = new Date(todayWeek);
      start.setDate(todayWeek.getDate() + (weekIndex - WEEKS_BACK) * 7);
      const days: WeekDay[] = Array.from({ length: 7 }, (_, dayIndex) => {
        const d = new Date(start);
        d.setDate(start.getDate() + dayIndex);
        const iso = formatIsoDate(d);
        return {
          id: iso,
          weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
          day: String(d.getDate()),
          isToday: iso === today
        };
      });
      return { id: formatIsoDate(start), days };
    });
  }, [today]);

  const [visibleWeekIndex, setVisibleWeekIndex] = useState(TODAY_WEEK_INDEX);
  const [pageWidth, setPageWidth] = useState(0);
  const weekListRef = useRef<FlatList<Week>>(null);

  // Jump back to today. We always scroll the week strip to today's page
  // explicitly, since the selectedDate-watching effect below is a no-op when
  // today is already selected (e.g., the user paged the strip but didn't pick
  // a new date).
  const handleToday = useCallback(() => {
    setSelectedDate(today);
    setVisibleWeekIndex(TODAY_WEEK_INDEX);
    if (pageWidth > 0) {
      weekListRef.current?.scrollToOffset({
        offset: TODAY_WEEK_INDEX * pageWidth,
        animated: true
      });
    }
  }, [today, pageWidth]);

  // FlatList's `initialScrollIndex` is unreliable on react-native-web (the
  // list sometimes lands at index 0 anyway). Force the correct position the
  // first time `pageWidth` is known, using `scrollToOffset` rather than
  // `scrollToIndex` because the offset call doesn't depend on the
  // getItemLayout/measurement plumbing that flakes on web.
  const hasForcedInitialScroll = useRef(false);
  useEffect(() => {
    if (hasForcedInitialScroll.current || pageWidth <= 0) return;
    const startIso = formatIsoDate(startOfWeek(selectedDate));
    const idx = weeks.findIndex((w) => w.id === startIso);
    if (idx < 0) return;
    hasForcedInitialScroll.current = true;
    setVisibleWeekIndex(idx);
    // Two RAFs to give the FlatList two layout passes before we scroll —
    // belt-and-suspenders against initial-render timing differences across
    // platforms.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        weekListRef.current?.scrollToOffset({ offset: idx * pageWidth, animated: false });
      });
    });
  }, [pageWidth, weeks, selectedDate]);

  // When the user picks a date from the calendar (or anywhere else not via
  // tap), page the week list to the week that contains it.
  useEffect(() => {
    const startIso = formatIsoDate(startOfWeek(selectedDate));
    const idx = weeks.findIndex((w) => w.id === startIso);
    if (idx >= 0 && idx !== visibleWeekIndex) {
      setVisibleWeekIndex(idx);
      if (pageWidth > 0) {
        weekListRef.current?.scrollToOffset({ offset: idx * pageWidth, animated: true });
      }
    }
    // We only want to re-page when selectedDate changes, not when the index is
    // updated from a manual swipe — tracking visibleWeekIndex would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, weeks, pageWidth]);

  const monthLabel = useMemo(() => {
    const week = weeks[visibleWeekIndex];
    if (!week) return "";
    // Use the middle day so a week that spans two months still picks the
    // dominant one (Wed lands in the larger half).
    const middle = week.days[3];
    if (!middle) return "";
    return parseIsoDate(middle.id).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
  }, [weeks, visibleWeekIndex]);

  const handleWeekScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      setVisibleWeekIndex(Math.max(0, Math.min(weeks.length - 1, idx)));
    },
    [pageWidth, weeks.length]
  );

  const handleCalendarSelect = useCallback((iso: string) => {
    setSelectedDate(iso);
    setCalendarOpen(false);
  }, []);

  // Horizontal swipe on the games area moves the selected date by ±1 day.
  // Threshold checks ensure we don't hijack vertical scroll or pull-to-refresh.
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 60) return;
          setSelectedDate((prev) => shiftDate(prev, g.dx < 0 ? 1 : -1));
        }
      }),
    []
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handlePullRefresh} tintColor={colors.secondary} />
      }
    >
      <View style={styles.contentShell}>
        <View style={styles.monthRow}>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <View style={styles.monthActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleToday}
              style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Open calendar"
              hitSlop={8}
              onPress={() => setCalendarOpen(true)}
              style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.white} name="calendar-outline" size={20} />
            </Pressable>
          </View>
        </View>
        <View
          onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
          style={styles.weekViewport}
        >
          {pageWidth > 0 ? (
            <FlatList
              ref={weekListRef}
              data={weeks}
              decelerationRate="fast"
              getItemLayout={(_, idx) => ({
                length: pageWidth,
                offset: pageWidth * idx,
                index: idx
              })}
              horizontal
              initialScrollIndex={TODAY_WEEK_INDEX}
              keyExtractor={(week) => week.id}
              onMomentumScrollEnd={handleWeekScrollEnd}
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              renderItem={({ item: week }) => (
                <View style={[styles.weekPage, { width: pageWidth }]}>
                  {week.days.map((d) => {
                    const active = selectedDate === d.id;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        key={d.id}
                        onPress={() => setSelectedDate(d.id)}
                        style={({ pressed }) => [
                          styles.weekPill,
                          active && styles.weekPillActive,
                          d.isToday && !active && styles.weekPillToday,
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
              )}
            />
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.sectionTitle}>NBA Games</Text>
          </View>
          <View style={styles.localTimeNotice}>
            <Ionicons color="#7D8490" name="time-outline" size={11} />
            <Text style={styles.localTimeNoticeText}>Times shown in local time</Text>
          </View>
        </View>

        <View {...swipeResponder.panHandlers}>
          {loading ? <LoadingState /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}
          {!loading && !error && visibleGames?.length === 0 ? (
            <EmptyState message="No NBA games scheduled for this date." title="No Games" />
          ) : null}

          {!loading && !error && visibleGames ? (
            <View style={styles.gamesStack}>
              {visibleGames.map((game) => (
                <GameCard
                  game={game}
                  key={game.id}
                  onPress={() => setOpenGame(game)}
                  recordByTeam={recordByTeam}
                  seriesByPair={seriesByPair}
                />
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <BoxScoreModal game={openGame} onClose={() => setOpenGame(null)} />
      <CalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        onSelect={handleCalendarSelect}
        onClose={() => setCalendarOpen(false)}
      />
    </ScrollView>
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

function firstOfMonth(iso: string): Date {
  const parts = iso.split("-").map(Number);
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function GameCard({
  game,
  onPress,
  recordByTeam,
  seriesByPair
}: {
  game: NbaGame;
  onPress: () => void;
  recordByTeam: Map<number, TeamRecord>;
  seriesByPair: Map<string, SeriesEntry>;
}) {
  const state = getGameState(game);
  const isLive = state === "live";
  const isFinal = state === "final";
  const clockLabel = getGameClockLabel(game);

  const homeWinning = isFinal && game.home_team_score > game.visitor_team_score;
  const visitorWinning = isFinal && game.visitor_team_score > game.home_team_score;
  const homeLosing = isFinal && game.home_team_score < game.visitor_team_score;
  const visitorLosing = isFinal && game.visitor_team_score < game.home_team_score;

  const seriesLabel = game.postseason ? getSeriesLabel(seriesByPair, game) : null;
  const ifNecessary = state === "upcoming" && Boolean(game.if_necessary);
  const visitorRecord = !game.postseason ? recordByTeam.get(game.visitor_team.id) : undefined;
  const homeRecord = !game.postseason ? recordByTeam.get(game.home_team.id) : undefined;

  // "Final" is rendered between the scores below, so leave the top label
  // empty for non-playoff finals (the playoff series label still wins above).
  let topLabel: string;
  if (seriesLabel) {
    topLabel = seriesLabel;
  } else if (state === "upcoming") {
    topLabel = "Tip-Off";
  } else if (isLive) {
    topLabel = "Live";
  } else {
    topLabel = "";
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.gameCard, isLive && styles.liveGameCard, isFinal && styles.finalGameCard, pressed && styles.pressed]}
    >
      <View style={styles.gameCardMain}>
        <TeamBadge team={game.visitor_team} record={visitorRecord} />
        <View style={styles.matchupCenter}>
          {game.postseason && game.series_label ? (
            <Text style={styles.playoffRoundLabel}>{game.series_label}</Text>
          ) : null}
          {topLabel ? (
            <Text style={[styles.gameMeta, isLive && !seriesLabel && styles.gameMetaLive]}>{topLabel}</Text>
          ) : null}
          {state === "upcoming" ? (
            <>
              <Text style={styles.tipTime}>{ifNecessary ? "TBD" : clockLabel}</Text>
              {ifNecessary ? <Text style={styles.ifNecessary}>*if necessary</Text> : null}
            </>
          ) : (
            <View style={[styles.scoreRow, isFinal && styles.finalScoreRow]}>
              <Text
                style={[
                  styles.score,
                  isFinal && styles.finalScore,
                  visitorWinning && styles.scoreWin,
                  visitorLosing && styles.scoreLoss
                ]}
              >
                {game.visitor_team_score}
              </Text>
              {isLive ? <Text style={styles.liveClock}>{clockLabel}</Text> : null}
              {isFinal ? <Text style={styles.finalLabel}>Final</Text> : null}
              <Text
                style={[
                  styles.score,
                  isFinal && styles.finalScore,
                  homeWinning && styles.scoreWin,
                  homeLosing && styles.scoreLoss
                ]}
              >
                {game.home_team_score}
              </Text>
            </View>
          )}
        </View>
        <TeamBadge team={game.home_team} record={homeRecord} />
      </View>
    </Pressable>
  );
}

function TeamBadge({ team, record }: { team: NbaTeam; record?: TeamRecord }) {
  return (
    <View style={styles.teamColumn}>
      <Image source={{ uri: teamLogoUri(team) }} style={styles.teamLogo} />
      <Text style={styles.teamAbbreviation}>{team.abbreviation}</Text>
      {record ? (
        <Text style={styles.teamRecord}>
          {record.wins}-{record.losses}
        </Text>
      ) : null}
    </View>
  );
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

function getSeriesLabel(seriesMap: Map<string, SeriesEntry>, game: NbaGame): string | null {
  const { key } = seriesPairKey(game.home_team.id, game.visitor_team.id);
  const entry = seriesMap.get(key);
  if (!entry) return null;
  const visitorIsA = game.visitor_team.id === entry.teamA;
  const visitorScore = visitorIsA ? entry.scoreA : entry.scoreB;
  const homeScore = visitorIsA ? entry.scoreB : entry.scoreA;
  if (visitorScore === 0 && homeScore === 0) return "Playoffs";
  return `${game.visitor_team.abbreviation} ${visitorScore}-${homeScore} ${game.home_team.abbreviation}`;
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
  monthRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs
  },
  monthLabel: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 16,
    letterSpacing: 0.6
  },
  monthActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  todayButton: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 7
  },
  todayButtonText: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  weekViewport: {
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs
  },
  weekPage: {
    flexDirection: "row",
    gap: 4
  },
  weekPill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 6
  },
  weekPillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  weekPillToday: {
    borderColor: colors.secondary
  },
  calendarButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36
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
  localTimeNotice: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4
  },
  localTimeNoticeText: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 0.3
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
  teamRecord: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2
  },
  matchupCenter: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  playoffRoundLabel: {
    color: colors.secondary,
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.9,
    lineHeight: 11,
    marginBottom: 4,
    textAlign: "center",
    textTransform: "uppercase"
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
  scoreWin: {
    color: colors.win
  },
  scoreLoss: {
    color: colors.loss
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
  liveClock: {
    color: colors.tertiary,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    paddingHorizontal: spacing.xs,
    textAlign: "center"
  },
  finalLabel: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.9,
    paddingHorizontal: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase"
  },
  tipTime: {
    color: "#CDD3DD",
    fontFamily: fonts.scoreboard,
    fontSize: 19,
    lineHeight: 22
  },
  ifNecessary: {
    color: "#7D8490",
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    fontStyle: "italic",
    letterSpacing: 0.3,
    marginTop: 2
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
