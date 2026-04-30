import json
import re
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from time import monotonic
from typing import Any, Callable, TypeVar
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from nba_api.live.nba.endpoints import boxscore as live_boxscore, scoreboard as live_scoreboard
from nba_api.stats.endpoints import (
    boxscoresummaryv2,
    boxscoretraditionalv2,
    leaguedashplayerstats,
    leaguegamefinder,
    leaguegamelog,
    leaguestandingsv3,
    playerindex,
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

_VALID_STAT_CATEGORIES = {"PTS", "REB", "AST", "STL", "BLK", "FG_PCT", "FG3M", "FG3_PCT", "FT_PCT"}

# Cache the full per-player stats payload (one call covers all six leader
# categories) so we hit stats.nba.com once per season per ~5 min instead of
# six times per page load.
_PLAYER_STATS_TTL_SECONDS = 300
_PLAYER_STATS_CACHE: dict[tuple[int, str], tuple[float, list[dict[str, Any]]]] = {}
_PLAYER_INDEX_CACHE: dict[int, tuple[float, dict[int, dict[str, Any]]]] = {}


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
        past_games = _list_past_games(parsed)
        # A game from the previous ET day can still be in progress past midnight,
        # so always overlay the live feed — matched games get their actual score
        # and clock; everything else is left as-is.
        _apply_live_overlay(past_games)
        # Backfill playoff metadata (series_label, game_number, if_necessary)
        # so completed postseason games still surface their round/game header
        # when the user navigates back to past dates.
        _apply_espn_tipoffs(past_games, parsed)
        return {"data": past_games}

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
    # from cdn.nba.com (the same feed the official NBA app uses). Apply for
    # any date — today's live games as well as previous-day games still
    # running past midnight ET.
    _apply_live_overlay(games)
    # nba_api marks playoff "if-necessary" games as TBD with no tip-off time
    # until the prior game finishes; ESPN often has the actual scheduled time
    # earlier. Backfill from there when nba_api leaves it blank.
    _apply_espn_tipoffs(games, parsed)

    games.sort(key=lambda g: g.get("datetime") or g.get("date") or "")
    return {"data": games}


def _apply_espn_tipoffs(games: list[dict[str, Any]], parsed_date: datetime) -> None:
    # Default the playoff metadata for every game so the field is always present
    # on the frontend (None / False) even if ESPN doesn't recognize the matchup.
    for game in games:
        game.setdefault("if_necessary", False)
        game.setdefault("series_game_number", None)
        game.setdefault("series_label", None)

    if not games:
        return

    date_str = parsed_date.strftime("%Y%m%d")
    try:
        req = urllib.request.Request(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={date_str}",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            payload = json.loads(r.read())
    except Exception:
        return

    by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    for ev in payload.get("events") or []:
        comps = ev.get("competitions") or []
        if not comps:
            continue
        competitors = comps[0].get("competitors") or []
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        if not (away and home):
            continue
        away_abbr = _normalize_espn_abbr((away.get("team") or {}).get("abbreviation"))
        home_abbr = _normalize_espn_abbr((home.get("team") or {}).get("abbreviation"))
        if not (away_abbr and home_abbr):
            continue
        notes_text = " ".join((n.get("headline") or "") for n in (comps[0].get("notes") or []))
        match = re.search(r"Game\s+(\d+)", notes_text, re.IGNORECASE)
        # ESPN sets timeValid=False when the game is on the schedule but the
        # league hasn't published a tip-off time yet (date defaults to midnight
        # ET, e.g. "T04:00Z"). Treat the time as unknown in that case.
        time_valid = bool(comps[0].get("timeValid"))
        by_pair[(away_abbr, home_abbr)] = {
            "tip_off": ev.get("date") if time_valid else None,
            "if_necessary": "if necessary" in notes_text.lower(),
            "series_game_number": int(match.group(1)) if match else None,
            "series_label": _format_series_label(notes_text),
        }

    for game in games:
        away_abbr = (game.get("visitor_team") or {}).get("abbreviation")
        home_abbr = (game.get("home_team") or {}).get("abbreviation")
        if not (away_abbr and home_abbr):
            continue
        info = by_pair.get((away_abbr, home_abbr))
        if not info:
            continue
        if not game.get("tip_off") and info["tip_off"]:
            game["tip_off"] = info["tip_off"]
        game["if_necessary"] = info["if_necessary"]
        game["series_game_number"] = info["series_game_number"]
        game["series_label"] = info["series_label"]


_ORDINAL_TO_WORD = {"1st": "First", "2nd": "Second", "3rd": "Third", "4th": "Fourth"}


def _format_series_label(notes_text: str) -> str | None:
    """Turn ESPN's note headline (e.g. 'East 1st Round - Game 6 If Necessary')
    into a display label like 'East First Round - Game 6'. Drops the optional
    'If Necessary' suffix because that's surfaced separately in the UI."""
    if not notes_text:
        return None
    label = re.sub(r"\s*if\s+necessary\s*$", "", notes_text.strip(), flags=re.IGNORECASE).strip()
    if not label:
        return None
    for ordinal, word in _ORDINAL_TO_WORD.items():
        label = re.sub(rf"\b{ordinal}\b", word, label, flags=re.IGNORECASE)
    return label


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
            # status_text already contains the clock (e.g. "Q3 5:32" or "Q4 39.8"),
            # so leave game["time"] empty to avoid concatenating "status - time"
            # into things like "Q4 39.8 - 39.8" on the client.
            game["time"] = None
            game["status"] = live["status_text"] or game["status"]
        elif status_id == 3:  # Final
            game["status"] = "Final"
            game["period"] = max(int(live["period"] or 0), 4)
            game["time"] = None
        if status_id in (2, 3):
            game["home_team_score"] = live["home_score"]
            game["visitor_team_score"] = live["away_score"]


def _fetch_live_states() -> dict[str, dict[str, Any]]:
    # cdn.nba.com is the official feed but periodically gets stuck (especially
    # during quarter breaks), while ESPN's public scoreboard is reliably fresh.
    # Build state from both and prefer whichever has the more advanced game.
    espn = _fetch_espn_states()
    cdn = _fetch_cdn_states()
    keys = set(espn.keys()) | set(cdn.keys())
    out: dict[str, dict[str, Any]] = {}
    for key in keys:
        e = espn.get(key)
        c = cdn.get(key)
        out[key] = _pick_fresher(e, c)
    return out


def _pick_fresher(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any]:
    if a is None:
        return b or {}
    if b is None:
        return a
    a_score = a["home_score"] + a["away_score"]
    b_score = b["home_score"] + b["away_score"]
    # Prefer whichever shows more action: higher status_id (final > live > pre),
    # then higher period, then higher total score.
    a_rank = (a["status_id"], a["period"], a_score)
    b_rank = (b["status_id"], b["period"], b_score)
    return a if a_rank >= b_rank else b


def _fetch_cdn_states() -> dict[str, dict[str, Any]]:
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


# ESPN's hidden public scoreboard tracks live games quickly and uses standard
# NBA game IDs (8-digit core like "0042500144" → "401774044" in ESPN-speak),
# so we match games by team-pair instead of ID.
_ESPN_TO_NBA_ABBR = {
    "GS": "GSW",
    "NO": "NOP",
    "NY": "NYK",
    "SA": "SAS",
    "UTAH": "UTA",
    "WSH": "WAS",
}

_ESPN_STATE_TO_ID = {"pre": 1, "in": 2, "post": 3}


def _fetch_espn_states() -> dict[str, dict[str, Any]]:
    """Returns live state keyed by NBA gameId, derived from team-pair matching."""
    try:
        req = urllib.request.Request(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            payload = json.loads(r.read())
    except Exception:
        return {}

    by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    for ev in payload.get("events") or []:
        comps = ev.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]
        competitors = comp.get("competitors") or []
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        if not (away and home):
            continue
        away_abbr = _normalize_espn_abbr((away.get("team") or {}).get("abbreviation"))
        home_abbr = _normalize_espn_abbr((home.get("team") or {}).get("abbreviation"))
        if not (away_abbr and home_abbr):
            continue
        status = comp.get("status") or {}
        status_type = status.get("type") or {}
        state = status_type.get("state")  # "pre" / "in" / "post"
        clock_raw = status.get("displayClock")
        period = int(status.get("period") or 0)
        completed = bool(status_type.get("completed"))
        status_id = 3 if completed else _ESPN_STATE_TO_ID.get(state, 0)
        status_text = status_type.get("shortDetail") or status_type.get("detail") or ""
        if status_id == 2 and period and clock_raw:
            status_text = f"Q{period} {clock_raw}" if period <= 4 else f"OT{period - 4} {clock_raw}"
        elif status_id == 3:
            status_text = "Final"
        by_pair[(away_abbr, home_abbr)] = {
            "status_text": status_text.strip(),
            "status_id": status_id,
            "period": period,
            "clock": clock_raw if clock_raw and clock_raw not in ("0:00", "0.0") else None,
            "home_score": _safe_int(home.get("score")),
            "away_score": _safe_int(away.get("score")),
            "_pair": (away_abbr, home_abbr),
        }

    # Re-key to NBA gameId so it merges cleanly with the cdn.nba.com state map.
    cdn_pair_to_id = _cdn_pair_index()
    out: dict[str, dict[str, Any]] = {}
    for pair, state in by_pair.items():
        gid = cdn_pair_to_id.get(pair)
        if gid:
            out[gid] = state
    return out


def _normalize_espn_abbr(abbr: str | None) -> str | None:
    if not abbr:
        return None
    upper = abbr.upper()
    return _ESPN_TO_NBA_ABBR.get(upper, upper)


def _cdn_pair_index() -> dict[tuple[str, str], str]:
    """Build (away_abbr, home_abbr) → gameId from the cdn.nba.com scoreboard."""
    try:
        sb = live_scoreboard.ScoreBoard()
        payload = sb.get_dict()
    except Exception:
        return {}
    out: dict[tuple[str, str], str] = {}
    for g in (payload.get("scoreboard") or {}).get("games") or []:
        gid = g.get("gameId")
        away_abbr = ((g.get("awayTeam") or {}).get("teamTricode") or "").upper()
        home_abbr = ((g.get("homeTeam") or {}).get("teamTricode") or "").upper()
        if gid and away_abbr and home_abbr:
            out[(away_abbr, home_abbr)] = gid
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
                    "on_court": str(p.get("oncourt") or "").strip() == "1",
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
        periods = [
            {"period": int(p.get("period") or 0), "score": _safe_int(p.get("score"))}
            for p in (team_data.get("periods") or [])
            if (p.get("period") or 0) > 0
        ]
        teams.append(
            {
                "team": team_meta,
                "score": _safe_int(team_data.get("score")),
                "players": players,
                "periods": periods,
            }
        )

    if not teams:
        return None

    return {"game_id": game_id, "teams": teams}


def _pick_fresher_boxscore(
    a: dict[str, Any] | None, b: dict[str, Any] | None
) -> dict[str, Any] | None:
    if not a:
        return b
    if not b:
        return a
    a_total = sum(t.get("score", 0) for t in a.get("teams") or [])
    b_total = sum(t.get("score", 0) for t in b.get("teams") or [])
    return a if a_total >= b_total else b


def _try_espn_boxscore(game_id: str) -> dict[str, Any] | None:
    espn_event_id = _resolve_espn_event_id(game_id)
    if not espn_event_id:
        return None
    try:
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={espn_event_id}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            payload = json.loads(r.read())
    except Exception:
        return None

    teams_by_abbr: dict[str, dict[str, Any]] = {}

    header = payload.get("header") or {}
    header_competitions = header.get("competitions") or []
    if header_competitions:
        for c in header_competitions[0].get("competitors") or []:
            abbr = _normalize_espn_abbr((c.get("team") or {}).get("abbreviation"))
            if not abbr:
                continue
            team_meta = _team_by_abbr(abbr)
            if not team_meta:
                continue
            line = c.get("linescores") or []
            periods = [
                {"period": i + 1, "score": _safe_int(p.get("displayValue") or p.get("value"))}
                for i, p in enumerate(line)
            ]
            teams_by_abbr[abbr] = {
                "team": team_meta,
                "score": _safe_int(c.get("score")),
                "players": [],
                "periods": periods,
            }

    boxscore = payload.get("boxscore") or {}
    for team_block in boxscore.get("players") or []:
        abbr = _normalize_espn_abbr((team_block.get("team") or {}).get("abbreviation"))
        team = teams_by_abbr.get(abbr or "")
        if not team:
            continue
        for stat_group in team_block.get("statistics") or []:
            keys = stat_group.get("keys") or []
            for athlete in stat_group.get("athletes") or []:
                if athlete.get("didNotPlay"):
                    continue
                stats = athlete.get("stats") or []
                stat_map = dict(zip(keys, stats))
                ath = athlete.get("athlete") or {}
                fgm, fga = _split_made_attempts(stat_map.get("fieldGoalsMade-fieldGoalsAttempted"))
                fg3m, fg3a = _split_made_attempts(stat_map.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
                ftm, fta = _split_made_attempts(stat_map.get("freeThrowsMade-freeThrowsAttempted"))
                team["players"].append(
                    {
                        "player_id": _safe_int(ath.get("id")),
                        "name": ath.get("displayName") or "",
                        "starter": bool(athlete.get("starter")),
                        "on_court": False,
                        "minutes": _format_espn_minutes(stat_map.get("minutes")),
                        "points": _parse_signed_int(stat_map.get("points")),
                        "rebounds": _parse_signed_int(stat_map.get("rebounds")),
                        "oreb": _parse_signed_int(stat_map.get("offensiveRebounds")),
                        "dreb": _parse_signed_int(stat_map.get("defensiveRebounds")),
                        "assists": _parse_signed_int(stat_map.get("assists")),
                        "steals": _parse_signed_int(stat_map.get("steals")),
                        "blocks": _parse_signed_int(stat_map.get("blocks")),
                        "turnovers": _parse_signed_int(stat_map.get("turnovers")),
                        "fouls": _parse_signed_int(stat_map.get("fouls")),
                        "plus_minus": _parse_signed_int(stat_map.get("plusMinus")),
                        "fgm": fgm,
                        "fga": fga,
                        "fg3m": fg3m,
                        "fg3a": fg3a,
                        "ftm": ftm,
                        "fta": fta,
                    }
                )
        team["players"].sort(key=lambda p: 0 if p["starter"] else 1)

    teams = [t for t in teams_by_abbr.values() if t["players"] or t["score"] > 0]
    if not teams:
        return None
    return {"game_id": game_id, "teams": teams}


def _resolve_espn_event_id(game_id: str) -> str | None:
    cdn_pair_to_id = _cdn_pair_index()
    nba_pair = next((pair for pair, gid in cdn_pair_to_id.items() if gid == game_id), None)
    if not nba_pair:
        return None
    return _espn_pair_index().get(nba_pair)


def _espn_pair_index() -> dict[tuple[str, str], str]:
    try:
        req = urllib.request.Request(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            payload = json.loads(r.read())
    except Exception:
        return {}
    out: dict[tuple[str, str], str] = {}
    for ev in payload.get("events") or []:
        comps = ev.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]
        competitors = comp.get("competitors") or []
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        if not (away and home):
            continue
        away_abbr = _normalize_espn_abbr((away.get("team") or {}).get("abbreviation"))
        home_abbr = _normalize_espn_abbr((home.get("team") or {}).get("abbreviation"))
        if away_abbr and home_abbr:
            ev_id = ev.get("id") or comp.get("id")
            if ev_id:
                out[(away_abbr, home_abbr)] = str(ev_id)
    return out


def _team_by_abbr(abbr: str | None) -> dict[str, Any] | None:
    if not abbr:
        return None
    for team in _TEAM_LOOKUP.values():
        if team.get("abbreviation") == abbr:
            return team
    return None


def _split_made_attempts(value: Any) -> tuple[int, int]:
    if value is None:
        return 0, 0
    text = str(value)
    if "-" not in text:
        return 0, 0
    made, _, attempted = text.partition("-")
    try:
        return int(made), int(attempted)
    except ValueError:
        return 0, 0


def _parse_signed_int(value: Any) -> int:
    if value is None or value == "":
        return 0
    text = str(value).strip().replace("+", "").replace(",", "")
    try:
        return int(float(text))
    except (ValueError, TypeError):
        return 0


def _format_espn_minutes(value: Any) -> str | None:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if not text:
        return None
    if ":" in text:
        return text
    return f"{text}:00"


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

    rows = _get_player_stats(season, season_type)
    min_gp = _qualification_min_gp(rows, season_type)

    qualified: list[dict[str, Any]] = []
    for row in rows:
        if int(row.get("GP") or 0) < min_gp:
            continue
        # Percentage leaders use NBA's "makes" pace rule: 300 FGM / 82 FT / 125
        # FTM over a full season, expressed as a per-game floor. This matches
        # the official qualification and is the same threshold mid-season since
        # PerGame stats are already pace-normalized.
        if stat_upper == "FG_PCT" and float(row.get("FGM") or 0) < (300 / 82):
            continue
        if stat_upper == "FG3_PCT" and float(row.get("FG3M") or 0) < (82 / 82):
            continue
        if stat_upper == "FT_PCT" and float(row.get("FTM") or 0) < (125 / 82):
            continue
        value = row.get(stat_upper)
        if value is None:
            continue
        qualified.append({"row": row, "value": float(value)})

    qualified.sort(key=lambda entry: entry["value"], reverse=True)
    top = qualified[:25]

    index = _get_player_index(season)
    leaders: list[dict[str, Any]] = []
    for rank, entry in enumerate(top, start=1):
        row = entry["row"]
        full_name = (row.get("PLAYER_NAME") or "").strip()
        first_name, _, last_name = full_name.partition(" ")
        team_id = row.get("TEAM_ID")
        team_meta = _TEAM_LOOKUP.get(team_id) if team_id else None
        player_id = row.get("PLAYER_ID")
        meta = index.get(int(player_id)) if player_id is not None else None

        leaders.append(
            {
                "player": {
                    "id": player_id,
                    "first_name": first_name or full_name,
                    "last_name": last_name,
                    "team_id": team_id,
                    "team": team_meta,
                    "position": (meta or {}).get("position", ""),
                },
                "value": entry["value"],
                "stat_type": stat_upper.lower(),
                "rank": rank,
                "season": season,
                "games_played": int(row.get("GP") or 0),
            }
        )

    return {"data": leaders}


@app.get("/players")
def list_players(
    season: int = Query(..., description="Starting year, e.g., 2025 for 2025-26"),
    season_type: str = Query("Regular Season", description="Regular Season or Playoffs"),
):
    if season_type not in ("Regular Season", "Playoffs"):
        raise HTTPException(status_code=400, detail="season_type must be 'Regular Season' or 'Playoffs'")

    rows = _get_player_stats(season, season_type)
    index = _get_player_index(season)
    min_gp = _qualification_min_gp(rows, season_type)

    players: list[dict[str, Any]] = []
    for row in rows:
        if int(row.get("GP") or 0) < min_gp:
            continue
        player_id = row.get("PLAYER_ID")
        if player_id is None:
            continue
        meta = index.get(int(player_id)) or {}
        team_id = row.get("TEAM_ID")
        team_meta = _TEAM_LOOKUP.get(team_id) if team_id else None
        full_name = (row.get("PLAYER_NAME") or "").strip()
        first_name, _, last_name = full_name.partition(" ")

        players.append(
            {
                "player": {
                    "id": player_id,
                    "first_name": first_name or full_name,
                    "last_name": last_name,
                    "team_id": team_id,
                    "team": team_meta,
                    "position": meta.get("position", ""),
                },
                "games_played": int(row.get("GP") or 0),
                "minutes": float(row.get("MIN") or 0),
                "stats": {
                    "pts": float(row.get("PTS") or 0),
                    "reb": float(row.get("REB") or 0),
                    "ast": float(row.get("AST") or 0),
                    "stl": float(row.get("STL") or 0),
                    "blk": float(row.get("BLK") or 0),
                    "tov": float(row.get("TOV") or 0),
                    "fgm": float(row.get("FGM") or 0),
                    "fga": float(row.get("FGA") or 0),
                    "fg_pct": float(row.get("FG_PCT") or 0),
                    "fg3m": float(row.get("FG3M") or 0),
                    "fg3a": float(row.get("FG3A") or 0),
                    "fg3_pct": float(row.get("FG3_PCT") or 0),
                    "ftm": float(row.get("FTM") or 0),
                    "fta": float(row.get("FTA") or 0),
                    "ft_pct": float(row.get("FT_PCT") or 0),
                    "dd2": int(row.get("DD2") or 0),
                    "td3": int(row.get("TD3") or 0),
                },
                "season": season,
            }
        )

    return {"data": players}


def _qualification_min_gp(rows: list[dict[str, Any]], season_type: str) -> int:
    """NBA's stat-leader rule: a player must have appeared in at least 70% of
    the team's games (or 58 games for a full 82-game season, whichever is
    less). We approximate the team's games by the league-wide max GP, which
    sidesteps the need to query schedules."""
    max_gp = max((int(r.get("GP") or 0) for r in rows), default=0)
    if max_gp == 0:
        return 0
    threshold = int(0.70 * max_gp)
    if season_type == "Regular Season":
        # Cap at 58 (NBA's hard floor for a finished 82-game season).
        return min(58, threshold) if max_gp >= 70 else threshold
    # Playoffs are short — most teams play 4-7 games per round, so 70% of the
    # league-leading total still keeps the bar at "started multiple rounds".
    return max(1, threshold)


def _get_player_stats(season: int, season_type: str) -> list[dict[str, Any]]:
    cache_key = (season, season_type)
    cached = _PLAYER_STATS_CACHE.get(cache_key)
    if cached and monotonic() - cached[0] < _PLAYER_STATS_TTL_SECONDS:
        return cached[1]

    season_str = _format_season(season)
    pds = _call_nba(
        lambda: leaguedashplayerstats.LeagueDashPlayerStats(
            season=season_str,
            season_type_all_star=season_type,
            per_mode_detailed="PerGame",
            timeout=30,
        )
    )
    rows = _rows_to_dicts(pds.league_dash_player_stats.get_dict())
    _PLAYER_STATS_CACHE[cache_key] = (monotonic(), rows)
    return rows


def _get_player_index(season: int) -> dict[int, dict[str, Any]]:
    cached = _PLAYER_INDEX_CACHE.get(season)
    if cached and monotonic() - cached[0] < _PLAYER_STATS_TTL_SECONDS:
        return cached[1]

    season_str = _format_season(season)
    try:
        pi = playerindex.PlayerIndex(season=season_str, league_id="00", timeout=30)
        rows = _rows_to_dicts(pi.player_index.get_dict())
    except Exception:
        rows = []

    out: dict[int, dict[str, Any]] = {}
    for row in rows:
        pid = row.get("PERSON_ID")
        if pid is None:
            continue
        out[int(pid)] = {
            "position": (row.get("POSITION") or "").strip(),
            "team_id": row.get("TEAM_ID"),
            "jersey_number": row.get("JERSEY_NUMBER"),
        }
    _PLAYER_INDEX_CACHE[season] = (monotonic(), out)
    return out


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
                "last_ten": str(row.get("L10") or ""),
                "streak": str(row.get("strCurrentStreak") or "").strip(),
                "points_pg": float(row.get("PointsPG") or 0),
                "opp_points_pg": float(row.get("OppPointsPG") or 0),
                "diff_points_pg": float(row.get("DiffPointsPG") or 0),
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


@app.get("/upcoming-playoff-games")
def upcoming_playoff_games(
    season: int = Query(..., description="Starting year, e.g., 2025 for 2025-26"),
    days: int = Query(14, description="Forward window in days"),
):
    # ESPN's scoreboard supports a hyphenated date range, so a single call covers
    # the whole window we care about. nba_api would require N round-trips here.
    today = datetime.now(EASTERN).date()
    start = today.strftime("%Y%m%d")
    end = (today + timedelta(days=days)).strftime("%Y%m%d")

    try:
        req = urllib.request.Request(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={start}-{end}",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            payload = json.loads(r.read())
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"ESPN unavailable: {err}") from err

    games: list[dict[str, Any]] = []
    for ev in payload.get("events") or []:
        comps = ev.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]
        notes_text = " ".join((n.get("headline") or "") for n in (comp.get("notes") or []))
        # Postseason games carry round/finals/conference in their note headlines.
        if not re.search(r"Round|Final|Conference", notes_text, re.IGNORECASE):
            continue

        competitors = comp.get("competitors") or []
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        if not (away and home):
            continue
        away_abbr = _normalize_espn_abbr((away.get("team") or {}).get("abbreviation"))
        home_abbr = _normalize_espn_abbr((home.get("team") or {}).get("abbreviation"))
        if not (away_abbr and home_abbr):
            continue

        time_valid = bool(comp.get("timeValid"))
        match = re.search(r"Game\s+(\d+)", notes_text, re.IGNORECASE)
        date_iso = ev.get("date")

        games.append(
            {
                "visitor_abbr": away_abbr,
                "home_abbr": home_abbr,
                "date": date_iso,
                "tip_off": date_iso if time_valid else None,
                "if_necessary": "if necessary" in notes_text.lower(),
                "series_game_number": int(match.group(1)) if match else None,
                "season": season,
            }
        )

    return {"data": games}


@app.get("/boxscore")
def get_boxscore(game_id: str = Query(..., alias="gameId", description="Full 10-char NBA game ID, e.g., 0022500100")):
    # cdn.nba.com's live boxscore populates in realtime during games; the
    # stats.nba.com V2 endpoint only fills in well after the final buzzer.
    # Both can stall mid-game, so we try ESPN as a parallel source and pick
    # whichever has the more advanced totals.
    cdn_data = _try_live_boxscore(game_id)
    espn_data = _try_espn_boxscore(game_id)
    chosen = _pick_fresher_boxscore(cdn_data, espn_data)
    if chosen:
        return {"data": chosen}

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
            "periods": [],
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
                "on_court": False,
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

    _apply_v2_line_score(game_id, teams_by_id)

    return {"data": {"game_id": game_id, "teams": list(teams_by_id.values())}}


def _apply_v2_line_score(game_id: str, teams_by_id: dict[int, dict[str, Any]]) -> None:
    """Pull per-quarter scores from BoxScoreSummaryV2 and attach to each team."""
    try:
        summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id, timeout=30)
        rows = _rows_to_dicts(summary.line_score.get_dict())
    except Exception:
        return
    for row in rows:
        team_id = row.get("TEAM_ID")
        team = teams_by_id.get(team_id)
        if not team:
            continue
        periods: list[dict[str, int]] = []
        for q in range(1, 5):
            value = row.get(f"PTS_QTR{q}")
            if value is None:
                continue
            periods.append({"period": q, "score": _safe_int(value)})
        for ot in range(1, 11):
            value = row.get(f"PTS_OT{ot}")
            if not value:
                continue
            periods.append({"period": 4 + ot, "score": _safe_int(value)})
        team["periods"] = periods


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
