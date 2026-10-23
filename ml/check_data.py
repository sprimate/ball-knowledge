#!/usr/bin/env python3
"""Sanity-check ml/data/: games per season, two team rows per game, player minutes per game, play types present.
Usage: python3 ml/check_data.py   (standard library only)"""
import csv
import gzip
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).parent / "data"
EXPECTED_GAMES = {"2019-20": 1059, "2020-21": 1080}  # COVID seasons; every other season is 1230


def rows(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        yield from csv.DictReader(f)


ok = True
for season_dir in sorted(p for p in DATA.iterdir() if p.is_dir()):
    season = season_dir.name
    teams = list(rows(season_dir / "team_games.csv.gz"))
    per_game = Counter(r["GAME_ID"] for r in teams)
    games = len(per_game)
    minutes = defaultdict(float)
    players = set()
    for r in rows(season_dir / "player_games.csv.gz"):
        minutes[r["GAME_ID"]] += float(r["MIN"] or 0)
        players.add(r["PLAYER_ID"])
    mins = sorted(minutes.values())
    pt = Counter((r["TYPE_GROUPING"], r["PLAY_TYPE"]) for r in rows(season_dir / "playtypes_player.csv.gz"))
    pt_players = {r["PLAYER_ID"] for r in rows(season_dir / "playtypes_player.csv.gz")}
    problems = []
    if games != EXPECTED_GAMES.get(season, 1230):
        problems.append(f"{games} games")
    if any(n != 2 for n in per_game.values()):
        problems.append("games without exactly two team rows")
    if set(minutes) != set(per_game):
        problems.append("player and team game ids differ")
    if mins and (mins[0] < 475 or mins[-1] > 800):  # both teams: 480 + 50 per overtime
        problems.append(f"player minutes per game {mins[0]:.0f}-{mins[-1]:.0f}")
    off = sum(1 for g, _ in pt if g.lower() == "offensive")
    dfn = sum(1 for g, _ in pt if g.lower() == "defensive")
    if off < 11 or dfn < 7:
        problems.append(f"play types: {off} offensive, {dfn} defensive")
    ok &= not problems
    print(f"{season}: {games} games, {len(players)} players, {len(pt_players)} with play types, "
          f"{off} off + {dfn} def play types, {sum(pt.values())} play-type rows"
          + (f"  PROBLEMS: {'; '.join(problems)}" if problems else "  ok"))
raise SystemExit(0 if ok else 1)
