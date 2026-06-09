#!/usr/bin/env python3
"""
scrape_bbref.py  —  One-time local script to collect NBA team/roster/stats data
from Basketball-Reference.com.

Output: public/data/nba-teams.json
  A single JSON object keyed by  "{Year} {City} {Nickname}"  e.g. "1997 Chicago Bulls"
  Each value contains the team record + a list of player totals for that season.

Usage (from project root, WSL or Windows):
    pip install requests beautifulsoup4
    python scripts/scrape_bbref.py

Resume:  The script writes the output file after every team, so just re-run after
         any interruption — already-scraped teams are skipped.

Rate limiting: 3.5–5.5 s random delay per page (~90 min for full run of ~1 450 pages).
"""

import json
import re
import time
import random
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Comment

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT        = Path(__file__).parent.parent
OUTPUT_FILE = ROOT / "public" / "data" / "nba-teams.json"
LOG_FILE    = ROOT / "scripts" / "scrape_bbref.log"

# ---------------------------------------------------------------------------
# Request config
# ---------------------------------------------------------------------------
REQUEST_DELAY = (3.5, 5.5)   # seconds — stay well under BBRef's rate limit
MAX_RETRIES   = 3
RETRY_DELAY   = 30           # seconds to wait on a 429 or transient error
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ---------------------------------------------------------------------------
# Franchise list
# (abbr, start_year, end_year)  —  year = calendar year the season ENDED
# e.g. the 1996-97 Bulls are year=1997
# ---------------------------------------------------------------------------
FRANCHISES: list[tuple[str, int, int]] = [
    # Eastern Conference
    ("ATL", 1980, 2025),   # Atlanta Hawks
    ("BOS", 1980, 2025),   # Boston Celtics
    ("NJN", 1980, 2012),   # New Jersey Nets
    ("BRK", 2013, 2025),   # Brooklyn Nets
    ("CHA", 1989, 2002),   # Charlotte Hornets (original)
    ("CHA", 2005, 2025),   # Charlotte Bobcats / New Charlotte Hornets
    ("CHI", 1980, 2025),   # Chicago Bulls
    ("CLE", 1980, 2025),   # Cleveland Cavaliers
    ("DET", 1980, 2025),   # Detroit Pistons
    ("IND", 1980, 2025),   # Indiana Pacers
    ("MIA", 1989, 2025),   # Miami Heat
    ("MIL", 1980, 2025),   # Milwaukee Bucks
    ("NYK", 1980, 2025),   # New York Knicks
    ("ORL", 1990, 2025),   # Orlando Magic
    ("PHI", 1980, 2025),   # Philadelphia 76ers
    ("TOR", 1996, 2025),   # Toronto Raptors
    ("WSB", 1980, 1997),   # Washington Bullets
    ("WAS", 1998, 2025),   # Washington Wizards
    # Western Conference
    ("DAL", 1981, 2025),   # Dallas Mavericks
    ("DEN", 1980, 2025),   # Denver Nuggets
    ("GSW", 1980, 2025),   # Golden State Warriors
    ("HOU", 1980, 2025),   # Houston Rockets
    ("KCK", 1980, 1985),   # Kansas City Kings
    ("SDC", 1980, 1984),   # San Diego Clippers
    ("LAC", 1985, 2025),   # Los Angeles Clippers
    ("LAL", 1980, 2025),   # Los Angeles Lakers
    ("VAN", 1996, 2001),   # Vancouver Grizzlies
    ("MEM", 2002, 2025),   # Memphis Grizzlies
    ("MIN", 1990, 2025),   # Minnesota Timberwolves
    ("NOH", 2003, 2006),   # New Orleans Hornets (pre-Katrina)
    ("NOK", 2007, 2007),   # New Orleans/OKC Hornets (Katrina split season)
    ("NOH", 2008, 2013),   # New Orleans Hornets (returned)
    ("NOP", 2014, 2025),   # New Orleans Pelicans
    ("OKC", 2009, 2025),   # Oklahoma City Thunder
    ("PHO", 1980, 2025),   # Phoenix Suns
    ("POR", 1980, 2025),   # Portland Trail Blazers
    ("SAC", 1986, 2025),   # Sacramento Kings
    ("SAS", 1980, 2025),   # San Antonio Spurs
    ("SEA", 1980, 2008),   # Seattle SuperSonics
    ("UTA", 1980, 2025),   # Utah Jazz
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')}  {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def fetch_page(url: str) -> BeautifulSoup | None:
    """Fetch a BBRef page, retrying on transient errors. Returns None on hard failure."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            time.sleep(random.uniform(*REQUEST_DELAY))
            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 429:
                log(f"  429 rate-limited — waiting {RETRY_DELAY}s (attempt {attempt})")
                time.sleep(RETRY_DELAY)
                continue
            if resp.status_code == 404:
                return None          # team/year combo doesn't exist — not an error
            resp.raise_for_status()
            # Force UTF-8 — requests defaults to Latin-1 for text/html when no
            # charset header is present, which mangles non-ASCII names.
            resp.encoding = "utf-8"
            return BeautifulSoup(resp.text, "lxml")
        except requests.RequestException as exc:
            log(f"  Request error attempt {attempt}: {exc}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
    return None


def find_table(soup: BeautifulSoup, table_id: str):
    """BBRef hides many tables in HTML comments. Try both direct and commented."""
    table = soup.find("table", {"id": table_id})
    if table:
        return table
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        if table_id in comment:
            fragment = BeautifulSoup(str(comment), "lxml")
            table = fragment.find("table", {"id": table_id})
            if table:
                return table
    return None


def clean_name(raw: str) -> str:
    """Strip BBRef decorations: asterisks (HoF), footnote markers, (TW), etc."""
    name = raw.strip()
    name = name.replace("\xa0", " ")          # non-breaking spaces
    name = re.sub(r"\*+$", "", name)          # trailing asterisks (HoF)
    name = re.sub(r"\s*\(TW\)\s*$", "", name) # two-way contract tag
    name = re.sub(r"\s{2,}", " ", name)       # collapse double spaces
    return name.strip()


def parse_record(soup: BeautifulSoup) -> tuple[int, int]:
    """Extract W-L record from the team page."""
    # BBRef typically renders it as "Record: 69-13" in a <p> tag
    text = soup.get_text(" ", strip=True)
    # Try several patterns BBRef has used over the years
    for pattern in [
        r"Record[:\s]+(\d+)[–\-](\d+)",
        r"(\d+)[–\-](\d+)\s*,?\s*\d+(?:st|nd|rd|th)\s+in",  # "69-13, 1st in..."
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return int(m.group(1)), int(m.group(2))
    return 0, 0


def parse_team_name(soup: BeautifulSoup, year: int) -> str:
    """
    Extract the franchise display name from the page h1.
    BBRef h1 looks like:  "1996-97 Chicago Bulls Roster & Stats"
    We want:              "Chicago Bulls"
    """
    h1 = soup.find("h1")
    if not h1:
        return "Unknown"
    text = h1.get_text(" ", strip=True)
    # Remove the season prefix  "1996-97 " or "2024-25 "
    text = re.sub(r"^\d{4}-\d{2}\s+", "", text)
    # Remove the suffix
    text = re.sub(r"\s*(Roster\s*(&|and)\s*Stats?|Stats?\s*&\s*Roster)\s*$", "", text, flags=re.IGNORECASE)
    return text.strip()


def parse_positions(pos_str: str) -> list[str]:
    """
    BBRef positions look like "SG", "PG-SG", "PF-C", "F", "G", etc.
    Normalise to a list of standard NBA positions.
    """
    ALIASES = {"G": ["PG", "SG"], "F": ["SF", "PF"], "C": ["C"], "G-F": ["SG", "SF"], "F-G": ["SF", "SG"], "F-C": ["PF", "C"], "C-F": ["C", "PF"]}
    raw = pos_str.strip().upper()
    if raw in ALIASES:
        return ALIASES[raw]
    parts = [p.strip() for p in re.split(r"[-/,]", raw) if p.strip()]
    # Keep only recognised positions
    valid = {"PG", "SG", "SF", "PF", "C"}
    return [p for p in parts if p in valid] or ["?"]


def int_cell(val) -> int:
    try:
        return int(str(val).strip().replace(",", "") or "0")
    except (ValueError, TypeError):
        return 0


def float_cell(val) -> float:
    try:
        return float(str(val).strip() or "0")
    except (ValueError, TypeError):
        return 0.0


# ---------------------------------------------------------------------------
# Core scrape function
# ---------------------------------------------------------------------------

def scrape_team(abbr: str, year: int) -> tuple[str, dict] | None:
    """
    Scrape one team-season from BBRef. Returns (key, data) or None on failure.
    key  = "{year} {City Nickname}"   e.g.  "1997 Chicago Bulls"
    """
    url  = f"https://www.basketball-reference.com/teams/{abbr}/{year}.html"
    soup = fetch_page(url)
    if soup is None:
        return None

    team_name = parse_team_name(soup, year)
    key       = f"{year} {team_name}"
    wins, losses = parse_record(soup)

    # ── Roster table: player slug → positions (direct table, not commented) ──
    # Keyed by bbref slug (e.g. "bryanko01") to avoid same-name collisions.
    pos_map: dict[str, list[str]] = {}
    pos_map_by_name: dict[str, list[str]] = {}   # fallback for rows with no link
    roster_table = find_table(soup, "roster")
    if roster_table:
        for row in roster_table.find_all("tr"):
            # Roster columns: number | player | pos | height | weight | ...
            name_cell = row.find("td", {"data-stat": "player"})
            pos_cell  = row.find("td", {"data-stat": "pos"})
            if name_cell and pos_cell:
                name = clean_name(name_cell.get_text())
                pos  = pos_cell.get_text().strip()
                if name and pos:
                    positions = parse_positions(pos)
                    link = name_cell.find("a")
                    if link and link.get("href"):
                        slug = link["href"].rstrip("/").split("/")[-1].replace(".html", "")
                        pos_map[slug] = positions
                    pos_map_by_name[name] = positions

    # ── Totals table: season totals (hidden in HTML comment) ─────────────────
    # BBRef's actual table id on team pages is 'totals_stats'
    totals_table = find_table(soup, "totals_stats")
    if totals_table is None:
        log(f"  WARN no totals table for {abbr} {year}")
        return None

    players: list[dict] = []

    for row in totals_table.find_all("tr"):
        # Skip header rows only — we intentionally keep partial_table rows
        # (those are individual team stints for traded players).
        row_class = row.get("class", [])
        if "thead" in row_class:
            continue

        # BBRef totals_stats uses data-stat="name_display" for the player name
        name_cell = row.find("td", {"data-stat": "name_display"})
        if name_cell is None:
            continue

        name = clean_name(name_cell.get_text())
        if not name or name == "Player" or name == "Team Totals":
            continue

        # Extract the stable BBRef slug from the <a> tag (e.g. "bryanko01").
        # This is our cross-season player identity key.
        link = name_cell.find("a")
        bbref_id: str | None = None
        if link and link.get("href"):
            bbref_id = link["href"].rstrip("/").split("/")[-1].replace(".html", "")

        def g(stat: str) -> str:
            cell = row.find("td", {"data-stat": stat})
            return cell.get_text().strip() if cell else "0"

        gp  = int_cell(g("games"))
        gs  = int_cell(g("games_started"))  # games started (0 if column absent)
        mp  = int_cell(g("mp"))

        # Skip players with essentially no time (DNP / squad fillers)
        if gp == 0 and mp == 0:
            continue

        # team_id is "TOT" for the season-aggregate row of a traded player,
        # the actual team abbreviation for stint rows, or "0" for a player
        # who never changed teams (BBRef sentinel). Normalise "0" → None.
        raw_team = g("team_id").strip()
        team_id = None if (not raw_team or raw_team == "0") else raw_team

        # is_trade_row marks the individual stint rows (partial_table class).
        # The TOT row (aggregate) is NOT marked partial_table.
        is_trade_row = "partial_table" in row_class

        # Resolve positions: prefer slug-keyed map, fall back to name.
        positions = (
            pos_map.get(bbref_id, pos_map_by_name.get(name, ["?"]))
            if bbref_id
            else pos_map_by_name.get(name, ["?"])
        )

        player: dict = {
            "bbref_id":    bbref_id,
            "name":        name,
            "age":         int_cell(g("age")),
            "team":        team_id,
            "is_trade_row": is_trade_row,
            "positions":   positions,
            "gp":          gp,
            "gs":          gs,
            "mp":          mp,
            "pts":         int_cell(g("pts")),
            "fgm":         int_cell(g("fg")),
            "fga":         int_cell(g("fga")),
            "3pm":         int_cell(g("fg3")),
            "3pa":         int_cell(g("fg3a")),
            "ftm":         int_cell(g("ft")),
            "fta":         int_cell(g("fta")),
            "orb":         int_cell(g("orb")),
            "drb":         int_cell(g("drb")),
            "reb":         int_cell(g("trb")),
            "ast":         int_cell(g("ast")),
            "stl":         int_cell(g("stl")),
            "blk":         int_cell(g("blk")),
            "tov":         int_cell(g("tov")),
            "pf":          int_cell(g("pf")),
        }
        players.append(player)

    if not players:
        log(f"  WARN no players parsed for {abbr} {year}")
        return None

    # ── Per-100-possessions table: merge p100_* stats ─────────────────────────
    # Table ID is 'per_poss'. Stat IDs share names with totals but represent
    # per-100-poss values; we prefix them p100_ to keep the distinction clear.
    p100_map: dict[tuple, dict] = {}
    per_poss_table = find_table(soup, "per_poss")
    if per_poss_table:
        for row in per_poss_table.find_all("tr"):
            row_class = row.get("class", [])
            if "thead" in row_class:
                continue
            name_cell = row.find("td", {"data-stat": "name_display"})
            if name_cell is None:
                continue
            p100_name = clean_name(name_cell.get_text())
            if not p100_name or p100_name == "Player" or p100_name == "Team Totals":
                continue

            p100_link = name_cell.find("a")
            p100_id: str | None = None
            if p100_link and p100_link.get("href"):
                p100_id = p100_link["href"].rstrip("/").split("/")[-1].replace(".html", "")

            def gp100(stat: str) -> str:
                cell = row.find("td", {"data-stat": stat})
                return cell.get_text().strip() if cell else ""

            p100_team_raw = gp100("team_id").strip()
            p100_team = None if (not p100_team_raw or p100_team_raw == "0") else p100_team_raw
            p100_data = {
                "p100_fgm":   float_cell(gp100("fg_per_poss")),
                "p100_fga":   float_cell(gp100("fga_per_poss")),
                "p100_2pm":   float_cell(gp100("fg2_per_poss")),
                "p100_2pa":   float_cell(gp100("fg2a_per_poss")),
                "p100_3pm":   float_cell(gp100("fg3_per_poss")),
                "p100_3pa":   float_cell(gp100("fg3a_per_poss")),
                "p100_ftm":   float_cell(gp100("ft_per_poss")),
                "p100_fta":   float_cell(gp100("fta_per_poss")),
                "p100_orb":   float_cell(gp100("orb_per_poss")),
                "p100_drb":   float_cell(gp100("drb_per_poss")),
                "p100_reb":   float_cell(gp100("trb_per_poss")),
                "p100_ast":   float_cell(gp100("ast_per_poss")),
                "p100_stl":   float_cell(gp100("stl_per_poss")),
                "p100_blk":   float_cell(gp100("blk_per_poss")),
                "p100_tov":   float_cell(gp100("tov_per_poss")),
                "p100_pf":    float_cell(gp100("pf_per_poss")),
                "p100_pts":   float_cell(gp100("pts_per_poss")),
            }

            p100_id_key = p100_id or p100_name
            p100_map[(p100_id_key, p100_team)] = p100_data
            if p100_team is not None:
                p100_map.setdefault((p100_id_key, None), p100_data)

    # Merge per-100 stats into each player dict.
    for p in players:
        pid   = p["bbref_id"] or p["name"]
        pteam = p["team"]
        p100  = p100_map.get((pid, pteam)) or p100_map.get((pid, None)) or {}
        for field in ("p100_fgm","p100_fga","p100_2pm","p100_2pa","p100_3pm","p100_3pa",
                      "p100_ftm","p100_fta","p100_orb","p100_drb","p100_reb",
                      "p100_ast","p100_stl","p100_blk","p100_tov","p100_pf","p100_pts"):
            p[field] = p100.get(field, None)   # None = not available (old data)

    # ── Advanced table: merge 3PAr, FTr, ORB%, DRB%, AST%, STL%, BLK%, TOV% ──
    # Keyed by (bbref_id, team) to correctly match traded-player stint rows.
    adv_map: dict[tuple, dict] = {}
    advanced_table = find_table(soup, "advanced")
    if advanced_table:
        for row in advanced_table.find_all("tr"):
            row_class = row.get("class", [])
            if "thead" in row_class:
                continue
            name_cell = row.find("td", {"data-stat": "name_display"})
            if name_cell is None:
                continue
            adv_name = clean_name(name_cell.get_text())
            if not adv_name or adv_name == "Player" or adv_name == "Team Totals":
                continue

            adv_link = name_cell.find("a")
            adv_id: str | None = None
            if adv_link and adv_link.get("href"):
                adv_id = adv_link["href"].rstrip("/").split("/")[-1].replace(".html", "")

            def ga(stat: str) -> str:
                cell = row.find("td", {"data-stat": stat})
                return cell.get_text().strip() if cell else ""

            adv_team_raw = ga("team_id").strip()
            adv_team = None if (not adv_team_raw or adv_team_raw == "0") else adv_team_raw
            # Store under both (id, team) and (id, None) so single-team players
            # always match regardless of what team_id the totals row carried.
            adv_data = {
                "3par":    float_cell(ga("fg3a_per_fga_pct")),
                "ftr":     float_cell(ga("fta_per_fga_pct")),
                "orb_pct": float_cell(ga("orb_pct")),
                "drb_pct": float_cell(ga("drb_pct")),
                "ast_pct": float_cell(ga("ast_pct")),
                "stl_pct": float_cell(ga("stl_pct")),
                "blk_pct": float_cell(ga("blk_pct")),
                "tov_pct": float_cell(ga("tov_pct")),
                "usg_pct": float_cell(ga("usg_pct")),
            }

            adv_id_key = adv_id or adv_name
            adv_map[(adv_id_key, adv_team)] = adv_data
            # Also index under (id, None) as a fallback so single-team players
            # whose totals row had team_id="0" still match.
            if adv_team is not None:
                adv_map.setdefault((adv_id_key, None), adv_data)

    # Merge advanced stats flat into each player dict.
    # Try (bbref_id, team) first, then (bbref_id, None) for single-team players.
    for p in players:
        pid   = p["bbref_id"] or p["name"]
        pteam = p["team"]   # may be None, "TOT", or a real abbreviation
        adv   = adv_map.get((pid, pteam)) or adv_map.get((pid, None)) or {}
        p["3par"]    = adv.get("3par",    0.0)
        p["ftr"]     = adv.get("ftr",     0.0)
        p["orb_pct"] = adv.get("orb_pct", 0.0)
        p["drb_pct"] = adv.get("drb_pct", 0.0)
        p["ast_pct"] = adv.get("ast_pct", 0.0)
        p["stl_pct"] = adv.get("stl_pct", 0.0)
        p["blk_pct"] = adv.get("blk_pct", 0.0)
        p["tov_pct"] = adv.get("tov_pct", 0.0)
        p["usg_pct"] = adv.get("usg_pct", 0.0)

    season_str = f"{year - 1}-{str(year)[2:]}"   # e.g. 1997 → "1996-97"

    data = {
        "year":    year,
        "season":  season_str,
        "wins":    wins,
        "losses":  losses,
        "players": players,
    }

    return key, data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Load existing progress so we can resume
    output: dict[str, dict] = {}
    if OUTPUT_FILE.exists():
        try:
            output = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            log(f"Resuming — {len(output)} teams already in output file")
        except json.JSONDecodeError:
            log("Output file corrupt, starting fresh")

    # Build the full list of (abbr, year) to scrape
    work_list: list[tuple[str, int]] = []
    for abbr, start, end in FRANCHISES:
        for year in range(start, end + 1):
            work_list.append((abbr, year))

    total        = len(work_list)
    already_done = len(output)   # pre-existing from a previous run
    skipped      = 0
    done         = 0
    failed       = 0
    failed_list: list[str] = []   # records of skipped/failed team-seasons

    log(f"Total team-seasons:   {total}")
    log(f"Already completed:    {already_done}")
    log(f"Remaining this run:   {total - already_done}")
    log(f"Output → {OUTPUT_FILE}")
    log("-" * 60)

    run_start    = time.monotonic()
    fetch_times: list[float] = []   # seconds spent on each successful fetch this run

    def eta_str(remaining: int) -> str:
        """Return a human-readable ETA string based on average fetch time so far."""
        if not fetch_times:
            return "ETA: calculating..."
        avg    = sum(fetch_times) / len(fetch_times)
        secs   = avg * remaining
        if secs < 90:
            return f"ETA: ~{int(secs)}s"
        elif secs < 3600:
            return f"ETA: ~{secs/60:.1f} min"
        else:
            h = int(secs // 3600)
            m = int((secs % 3600) // 60)
            return f"ETA: ~{h}h {m:02d}m"

    for i, (abbr, year) in enumerate(work_list, 1):
        # Build a placeholder key to check if we already have it.
        # We don't know the full team name yet, so check by abbr+year in any key.
        already = any(
            v.get("year") == year and v.get("_abbr") == abbr
            for v in output.values()
        )
        if already:
            skipped += 1
            continue

        completed_so_far = already_done + done
        remaining_before = total - completed_so_far - 1
        elapsed          = time.monotonic() - run_start
        elapsed_str      = f"{elapsed/60:.1f} min" if elapsed >= 60 else f"{elapsed:.0f}s"
        log(
            f"[{i:4d}/{total}]  done={completed_so_far}  left={remaining_before}"
            f"  elapsed={elapsed_str}  {eta_str(remaining_before)}  — {abbr} {year} ..."
        )

        t0     = time.monotonic()
        result = scrape_team(abbr, year)
        fetch_times.append(time.monotonic() - t0)

        if result is None:
            log(f"  SKIP {abbr} {year}")
            failed += 1
            failed_list.append(f"{abbr} {year}")
        else:
            key, data = result
            data["_abbr"] = abbr   # keep internal so we can skip on resume
            output[key]   = data
            done += 1
            completed_so_far = already_done + done
            remaining_after  = total - completed_so_far
            log(
                f"  OK  → \"{key}\"  ({data['wins']}-{data['losses']},"
                f"  {len(data['players'])} players)"
                f"  [{completed_so_far}/{total} done, {remaining_after} left,"
                f"  {eta_str(remaining_after)}]"
            )
            # Save incrementally so we can resume
            OUTPUT_FILE.write_text(
                json.dumps(output, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )

    # Strip internal _abbr field from final output
    for v in output.values():
        v.pop("_abbr", None)
    OUTPUT_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    total_elapsed = time.monotonic() - run_start
    log("=" * 60)
    log(f"Done.  Scraped: {done}  Skipped (already done): {skipped}  Failed/404: {failed}")
    log(f"Total run time: {total_elapsed/60:.1f} min")
    log(f"Output: {OUTPUT_FILE}  ({OUTPUT_FILE.stat().st_size // 1024} KB)")
    if failed_list:
        log("")
        log(f"Failed / skipped team-seasons ({len(failed_list)}):")
        for entry in failed_list:
            log(f"  {entry}")


if __name__ == "__main__":
    main()
