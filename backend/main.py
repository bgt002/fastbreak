import json
import re
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Callable, TypeVar
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from nba_api.live.nba.endpoints import boxscore as live_boxscore, scoreboard as live_scoreboard
from nba_api.stats.endpoints import (
    boxscoretraditionalv2,
    leaguegamefinder,
    leaguegamelog,
    leagueleaders,
    leaguestandingsv3,
    scoreboardv2,
)
from nba_api.stats.static import teams as static_teams

EASTERN = ZoneInfo("America/New_York")
_TIPOFF_RE = re.compile(r"(\d{1,2}):(\d{2})\s*(am|pm)\s*ET", re.IGNORECASE)

T = TypeVar("T")

# Conference and division aren't on the static team list, so we hardcode them.
_CONFERENCE_BY_ABBR: dict[str, str] = {
    **dict.fromkeys(
        ["BOS", "BKN", "NYK", "PHI", "TOR", "CHI", "CLE", "DET", "IND", "MIL", "ATL", "CHA", "MIA", "ORL", "WAS"],
        "East",
    ),
    **dict.fromkeys(
        ["DEN", "MIN", "OKC", "POR", "UTA", "GSW", "LAC", "LAL", "PHX", "SAC", "DAL", "HOU", "MEM", "NOP", "SAS"],
        "West",
    ),
}

_DIVISION_BY_ABBR: dict[str, str] = {
    **dict.fromkeys(["BOS", "BKN", "NYK", "PHI", "TOR"], "Atlantic"),
    **dict.fromkeys(["CHI", "CLE", "DET", "IND", "MIL"], "Central"),
    **dict.fromkeys(["ATL", "CHA", "MIA", "ORL", "WAS"], "Southeast"),
    **dict.fromkeys(["DEN", "MIN", "OKC", "POR", "UTA"], "Northwest"),
    **dict.fromkeys(["GSW", "LAC", "LAL", "PHX", "SAC"], "Pacific"),
    **dict.fromkeys(["DAL", "HOU", "MEM", "NOP", "SAS"], "Southwest"),
}

_TEAM_LOOKUP: dict[int, dict[str, Any]] = {}

_VALID_STAT_CATEGORIES = {"PTS", "REB", "AST", "STL", "BLK", "FG_PCT"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _TEAM_LOOKUP
    _TEAM_LOOKUP = {
        team["id"]: {
            "id": team["id"],
            "abbreviation": team["abbreviation"],
            "city": team["city"],
            "name": team["nickname"],
            "full_name": team["full_name"],
            "conference": _CONFERENCE_BY_ABBR.get(team["abbreviation"], "Unknown"),
            "division": _DIVISION_BY_ABBR.get(team["abbreviation"], "Unknown"),
        }
        for team in static_teams.get_teams()
    }
    yield


app = FastAPI(title="FastBreak NBA API proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "teams_loaded": len(_TEAM_LOOKUP)}


@app.get("/teams")
def list_teams():
    return {"data": list(_TEAM_LOOKUP.values())}


@app.get("/games")
def list_games(date: str = Query(..., description="YYYY-MM-DD")):
    try:
        parsed = datetime.strptime(date, "%Y-%m-%d")
    except ValueError as err:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from err

    today_et = datetime.now(EASTERN).date()
    is_past_date = parsed.date() < today_et

    # ScoreboardV2's LineScore isn't reliably populated for past dates, so use LeagueGameFinder
    # for completed games. ScoreboardV2 is still the right source for today/future (live + scheduled).
    if is_past_date:
        return {"data": _list_past_games(parsed)}

    sb = _call_nba(
        lambda: scoreboardv2.ScoreboardV2(game_date=parsed.strftime("%m/%d/%Y"), timeout=30)
    )
    headers = _rows_to_dicts(sb.game_header.get_dict())
    line_scores = _rows_to_dicts(sb.line_score.get_dict())

    line_by_game: dict[str, list[dict[str, Any]]] = {}
    for row in line_scores:
        line_by_game.setdefault(row["GAME_ID"], []).append(row)

    games: list[dict[str, Any]] = []
    for header in headers:
        game_id = header["GAME_ID"]
        scores = line_by_game.get(game_id, [])
        home_line = next((s for s in scores if s["TEAM_ID"] == header["HOME_TEAM_ID"]), None)
        visitor_line = next((s for s in scores if s["TEAM_ID"] == header["VISITOR_TEAM_ID"]), None)
        home_team = _TEAM_LOOKUP.get(header["HOME_TEAM_ID"])
        visitor_team = _TEAM_LOOKUP.get(header["VISITOR_TEAM_ID"])
        if not home_team or not visitor_team:
            continue

        games.append(
            _build_game(game_id, parsed, header, home_team, visitor_team, home_line, visitor_line, False)
        )

    # ScoreboardV2 lags significantly for live games, so overlay realtime data
    # from cdn.nba.com (the same feed the official NBA app uses).
    if parsed.date() == today_et:
        _apply_live_overlay(games)

    games.sort(key=lambda g: g.get("datetime") or g.get("date") or "")
    return {"data": games}


def _apply_live_overlay(games: list[dict[str, Any]]) -> None:
    live_states = _fetch_live_states()
    if not live_states:
        return
    for game in games:
        live = live_states.get(game["id"])
        if not live:
            continue
        status_id = live["status_id"]
        if status_id == 2:  # Live
            game["period"] = live["period"] or game["period"]
            game["time"] = live["clock"]
            game["status"] = live["status_text"] or game["status"]
        elif status_id == 3:  # Final
            game["status"] = "Final"
            game["period"] = max(int(live["period"] or 0), 4)
            game["time"] = None
        if status_id in (2, 3):
            game["home_team_score"] = live["home_score"]
            game["visitor_team_score"] = live["away_score"]


def _fetch_live_states() -> dict[str, dict[str, Any]]:
    try:
        sb = live_scoreboard.ScoreBoard()
        payload = sb.get_dict()
    except Exception:
        return {}

    games = (payload.get("scoreboard") or {}).get("games") or []
    out: dict[str, dict[str, Any]] = {}
    for g in games:
        gid = g.get("gameId")
        if not gid:
            continue
        out[gid] = {
            "status_text": (g.get("gameStatusText") or "").strip(),
            "status_id": int(g.get("gameStatus") or 0),
            "period": int(g.get("period") or 0),
            "clock": _format_live_clock(g.get("gameClock")),
            "home_score": _safe_int((g.get("homeTeam") or {}).get("score")),
            "away_score": _safe_int((g.get("awayTeam") or {}).get("score")),
        }
    return out


_CLOCK_RE = re.compile(r"PT(\d+)M([\d.]+)S")


def _format_live_clock(clock: str | None) -> str | None:
    if not clock:
        return None
    match = _CLOCK_RE.match(clock)
    if not match:
        return None
    minutes = int(match.group(1))
    seconds = int(float(match.group(2)))
    if minutes == 0 and seconds == 0:
        return None
    return f"{minutes}:{seconds:02d}"


def _format_live_minutes(value: Any) -> str | None:
    if value is None or value == "":
        return None
    text = str(value)
    match = _CLOCK_RE.match(text)
    if not match:
        return text
    minutes = int(match.group(1))
    seconds = int(float(match.group(2)))
    return f"{minutes}:{seconds:02d}"


def _try_live_boxscore(game_id: str) -> dict[str, Any] | None:
    try:
        bs = live_boxscore.BoxScore(game_id=game_id)
        payload = bs.get_dict()
    except Exception:
        return None

    game = payload.get("game") or {}
    if not game:
        return None

    teams: list[dict[str, Any]] = []
    for side in ("homeTeam", "awayTeam"):
        team_data = game.get(side) or {}
        team_id = team_data.get("teamId")
        team_meta = _TEAM_LOOKUP.get(team_id)
        if not team_meta:
            continue
        players: list[dict[str, Any]] = []
        for p in team_data.get("players") or []:
            stats = p.get("statistics") or {}
            full_name = (p.get("name") or f"{p.get('firstName', '')} {p.get('familyName', '')}").strip()
            players.append(
                {
                    "player_id": p.get("personId"),
                    "name": full_name,
                    "starter": str(p.get("starter") or "").strip() == "1",
                    "minutes": _format_live_minutes(stats.get("minutes") or stats.get("minutesCalculated")),
                    "points": _safe_int(stats.get("points")),
                    "rebounds": _safe_int(stats.get("reboundsTotal")),
                    "oreb": _safe_int(stats.get("reboundsOffensive")),
                    "dreb": _safe_int(stats.get("reboundsDefensive")),
                    "assists": _safe_int(stats.get("assists")),
                    "steals": _safe_int(stats.get("steals")),
                    "blocks": _safe_int(stats.get("blocks")),
                    "turnovers": _safe_int(stats.get("turnovers")),
                    "fouls": _safe_int(stats.get("foulsPersonal")),
                    "plus_minus": _safe_int(stats.get("plusMinusPoints")),
                    "fgm": _safe_int(stats.get("fieldGoalsMade")),
                    "fga": _safe_int(stats.get("fieldGoalsAttempted")),
                    "fg3m": _safe_int(stats.get("threePointersMade")),
                    "fg3a": _safe_int(stats.get("threePointersAttempted")),
                    "ftm": _safe_int(stats.get("freeThrowsMade")),
                    "fta": _safe_int(stats.get("freeThrowsAttempted")),
                }
            )
        if not players:
            continue
        players.sort(key=lambda pl: (0 if pl["starter"] else 1))
        teams.append(
            {
                "team": team_meta,
                "score": _safe_int(team_data.get("score")),
                "players": players,
            }
        )

    if not teams:
        return None

    return {"game_id": game_id, "teams": teams}


def _list_past_games(parsed_date: datetime) -> list[dict[str, Any]]:
    """Build the games list for a date strictly in the past, using LeagueGameFinder."""
    finder = _call_nba(
        lambda: leaguegamefinder.LeagueGameFinder(
            date_from_nullable=parsed_date.strftime("%m/%d/%Y"),
            date_to_nullable=parsed_date.strftime("%m/%d/%Y"),
            league_id_nullable="00",
            timeout=30,
        )
    )
    rows = _rows_to_dicts(finder.league_game_finder_results.get_dict())

    games_by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        game_id = row.get("GAME_ID")
        if not game_id:
            continue
        team_meta = _TEAM_LOOKUP.get(row.get("TEAM_ID"))
        if not team_meta:
            continue

        is_home = "vs." in (row.get("MATCHUP") or "")
        team_score = _safe_int(row.get("PTS"))
        season_id = str(row.get("SEASON_ID") or "")
        season_year = int(season_id[1:]) if len(season_id) >= 5 and season_id[1:].isdigit() else 0

        existing = games_by_id.setdefault(
            game_id,
            {
                "id": game_id,
                "date": parsed_date.strftime("%Y-%m-%d"),
                "status": "Final",
                "period": 4,
                "time": None,
                "datetime": parsed_date.strftime("%Y-%m-%dT00:00:00"),
                "tip_off": None,
                "season": season_year,
                "postseason": game_id.startswith("004"),
                "home_team": None,
                "visitor_team": None,
                "home_team_score": 0,
                "visitor_team_score": 0,
            },
        )

        if is_home:
            existing["home_team"] = team_meta
            existing["home_team_score"] = team_score
        else:
            existing["visitor_team"] = team_meta
            existing["visitor_team_score"] = team_score

    games = [g for g in games_by_id.values() if g["home_team"] and g["visitor_team"]]
    games.sort(key=lambda g: g.get("date") or "")
    return games


@app.get("/leaders")
def list_leaders(
    season: int = Query(..., description="Starting year, e.g., 2025 for 2025-26"),
    stat: str = Query(..., description="One of PTS, REB, AST, STL, BLK, FG_PCT"),
    season_type: str = Query("Regular Season", description="Regular Season or Playoffs"),
):
    stat_upper = stat.upper()
    if stat_upper not in _VALID_STAT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"stat must be one of {sorted(_VALID_STAT_CATEGORIES)}")

    if season_type not in ("Regular Season", "Playoffs"):
        raise HTTPException(status_code=400, detail="season_type must be 'Regular Season' or 'Playoffs'")

    season_str = _format_season(season)
    ll = _call_nba(
        lambda: leagueleaders.LeagueLeaders(
            season=season_str,
            season_type_all_star=season_type,
            stat_category_abbreviation=stat_upper,
            per_mode48="PerGame",
            timeout=30,
        )
    )
    rows = _rows_to_dicts(ll.league_leaders.get_dict())

    leaders: list[dict[str, Any]] = []
    for row in rows[:25]:
        full_name = (row.get("PLAYER") or "").strip()
        first_name, _, last_name = full_name.partition(" ")
        team_id = row.get("TEAM_ID")
        team_meta = _TEAM_LOOKUP.get(team_id) if team_id else None
        value = row.get(stat_upper)

        leaders.append(
            {
                "player": {
                    "id": row.get("PLAYER_ID"),
                    "first_name": first_name or full_name,
                    "last_name": last_name,
                    "team_id": team_id,
                    "team": team_meta,
                },
                "value": float(value) if value is not None else 0.0,
                "stat_type": stat_upper.lower(),
                "rank": int(row.get("RANK") or 0),
                "season": season,
                "games_played": int(row.get("GP") or 0),
            }
        )

    return {"data": leaders}


@app.get("/standings")
def list_standings(season: int = Query(..., description="Starting year, e.g., 2025 for 2025-26")):
    season_str = _format_season(season)
    st = _call_nba(lambda: leaguestandingsv3.LeagueStandingsV3(season=season_str, timeout=30))
    rows = _rows_to_dicts(st.standings.get_dict())

    standings: list[dict[str, Any]] = []
    for row in rows:
        team_id = row.get("TeamID")
        team_meta = _TEAM_LOOKUP.get(team_id)
        if not team_meta:
            continue

        standings.append(
            {
                "team": team_meta,
                "wins": int(row.get("WINS") or 0),
                "losses": int(row.get("LOSSES") or 0),
                "conference_rank": int(row.get("PlayoffRank") or 0),
                "conference_record": str(row.get("ConferenceRecord") or ""),
                "division_rank": int(row.get("DivisionRank") or 0),
                "division_record": str(row.get("DivisionRecord") or ""),
                "home_record": str(row.get("HOME") or ""),
                "road_record": str(row.get("ROAD") or ""),
                "season": season,
            }
        )

    return {"data": standings}


@app.get("/playoffs")
def list_playoff_games(season: int = Query(..., description="Starting year, e.g., 2025 for 2025-26")):
    season_str = _format_season(season)
    glog = _call_nba(
        lambda: leaguegamelog.LeagueGameLog(
            season=season_str,
            season_type_all_star="Playoffs",
            player_or_team_abbreviation="T",
            timeout=30,
        )
    )
    rows = _rows_to_dicts(glog.league_game_log.get_dict())

    games_by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        game_id = row.get("GAME_ID")
        if not game_id:
            continue

        team_id = row.get("TEAM_ID")
        team_meta = _TEAM_LOOKUP.get(team_id)
        if not team_meta:
            continue

        is_home = "vs." in (row.get("MATCHUP") or "")
        team_score = int(row.get("PTS") or 0)
        date_str = row.get("GAME_DATE")

        existing = games_by_id.setdefault(
            game_id,
            {
                "id": game_id,
                "date": date_str,
                "status": "Final",
                "period": 4,
                "time": None,
                "datetime": date_str,
                "season": season,
                "postseason": True,
                "home_team": None,
                "visitor_team": None,
                "home_team_score": 0,
                "visitor_team_score": 0,
            },
        )

        if is_home:
            existing["home_team"] = team_meta
            existing["home_team_score"] = team_score
        else:
            existing["visitor_team"] = team_meta
            existing["visitor_team_score"] = team_score

    games = [g for g in games_by_id.values() if g["home_team"] and g["visitor_team"]]
    games.sort(key=lambda g: g.get("date") or "")
    return {"data": games}


@app.get("/boxscore")
def get_boxscore(game_id: str = Query(..., alias="gameId", description="Full 10-char NBA game ID, e.g., 0022500100")):
    # cdn.nba.com's live boxscore populates in realtime during games; the
    # stats.nba.com V2 endpoint only fills in well after the final buzzer.
    live_data = _try_live_boxscore(game_id)
    if live_data:
        return {"data": live_data}

    bs = _call_nba(lambda: boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id, timeout=30))
    player_rows = _rows_to_dicts(bs.player_stats.get_dict())
    team_rows = _rows_to_dicts(bs.team_stats.get_dict())

    teams_by_id: dict[int, dict[str, Any]] = {}
    for trow in team_rows:
        team_id = trow.get("TEAM_ID")
        team_meta = _TEAM_LOOKUP.get(team_id)
        if not team_meta:
            continue
        teams_by_id[team_id] = {
            "team": team_meta,
            "score": _safe_int(trow.get("PTS")),
            "players": [],
        }

    for prow in player_rows:
        team_id = prow.get("TEAM_ID")
        team = teams_by_id.get(team_id)
        if not team:
            continue
        team["players"].append(
            {
                "player_id": prow.get("PLAYER_ID"),
                "name": prow.get("PLAYER_NAME") or "",
                "starter": bool((prow.get("START_POSITION") or "").strip()),
                "minutes": prow.get("MIN"),
                "points": _safe_int(prow.get("PTS")),
                "rebounds": _safe_int(prow.get("REB")),
                "oreb": _safe_int(prow.get("OREB")),
                "dreb": _safe_int(prow.get("DREB")),
                "assists": _safe_int(prow.get("AST")),
                "steals": _safe_int(prow.get("STL")),
                "blocks": _safe_int(prow.get("BLK")),
                "turnovers": _safe_int(prow.get("TO")),
                "fouls": _safe_int(prow.get("PF")),
                "plus_minus": _safe_int(prow.get("PLUS_MINUS")),
                "fgm": _safe_int(prow.get("FGM")),
                "fga": _safe_int(prow.get("FGA")),
                "fg3m": _safe_int(prow.get("FG3M")),
                "fg3a": _safe_int(prow.get("FG3A")),
                "ftm": _safe_int(prow.get("FTM")),
                "fta": _safe_int(prow.get("FTA")),
            }
        )

    if not teams_by_id:
        raise HTTPException(status_code=404, detail="Box score not available for this game yet")

    # Starters first, then bench, otherwise preserve order returned by the API
    for team in teams_by_id.values():
        team["players"].sort(key=lambda p: (0 if p["starter"] else 1))

    return {"data": {"game_id": game_id, "teams": list(teams_by_id.values())}}


def _safe_int(value: Any) -> int:
    try:
        return int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0


def _build_game(
    game_id: str,
    parsed_date: datetime,
    header: dict[str, Any],
    home_team: dict[str, Any],
    visitor_team: dict[str, Any],
    home_line: dict[str, Any] | None,
    visitor_line: dict[str, Any] | None,
    is_past_date: bool = False,
) -> dict[str, Any]:
    live_period = header.get("LIVE_PERIOD") or 0
    live_time_raw = header.get("LIVE_PC_TIME")
    live_time = live_time_raw.strip() if isinstance(live_time_raw, str) and live_time_raw.strip() else None
    status_text = (header.get("GAME_STATUS_TEXT") or "").strip()
    tip_off = _parse_tipoff(parsed_date, status_text)

    # ScoreboardV2 often leaves status_text as the original tip-off time even after a game ends,
    # and GAME_STATUS_ID isn't always refreshed for past dates either. Treat any game whose ET
    # date is in the past as Final, since ScoreboardV2 only returns games that were actually played.
    status_id_raw = header.get("GAME_STATUS_ID")
    status_id = int(status_id_raw) if status_id_raw is not None else 0
    if (status_id == 3 or is_past_date) and "final" not in status_text.lower():
        status_text = "Final"

    return {
        "id": game_id,
        "date": parsed_date.strftime("%Y-%m-%d"),
        "status": status_text,
        "period": int(live_period) if live_period is not None else 0,
        "time": live_time,
        "datetime": header.get("GAME_DATE_EST"),
        "tip_off": tip_off,
        "season": int(header.get("SEASON") or parsed_date.year),
        "postseason": isinstance(game_id, str) and game_id.startswith("004"),
        "home_team": home_team,
        "visitor_team": visitor_team,
        "home_team_score": int((home_line or {}).get("PTS") or 0),
        "visitor_team_score": int((visitor_line or {}).get("PTS") or 0),
    }


def _parse_tipoff(date_obj: datetime, status_text: str) -> str | None:
    """Convert '7:30 pm ET' + a date into an ISO 8601 timestamp with timezone."""
    match = _TIPOFF_RE.search(status_text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if match.group(3).lower() == "pm" and hour != 12:
        hour += 12
    elif match.group(3).lower() == "am" and hour == 12:
        hour = 0
    et_dt = date_obj.replace(hour=hour, minute=minute, second=0, microsecond=0, tzinfo=EASTERN)
    return et_dt.isoformat()


def _rows_to_dicts(result_set: dict[str, Any]) -> list[dict[str, Any]]:
    # nba_api's DataSet.get_dict() renames `rowSet` to `data` on the way through.
    headers = result_set["headers"]
    rows = result_set.get("data") or result_set.get("rowSet") or []
    return [dict(zip(headers, row, strict=False)) for row in rows]


def _call_nba(fn: Callable[[], T]) -> T:
    """Run an nba_api call and translate upstream failures into a 502."""
    try:
        return fn()
    except json.JSONDecodeError as err:
        raise HTTPException(
            status_code=502,
            detail="stats.nba.com returned an empty or invalid response (likely rate-limited). Try again in a moment.",
        ) from err
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Upstream NBA API error: {err}") from err


def _format_season(season_year: int) -> str:
    return f"{season_year}-{str(season_year + 1)[-2:]}"
