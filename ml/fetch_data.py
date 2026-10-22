#!/usr/bin/env python3
"""Fetch the raw training data for the win-probability network from stats.nba.com (nba_api).

Writes gzipped CSVs to ml/data/<season>/ (resumable: files that exist are skipped):
  playtypes_player.csv.gz   Synergy play types per player: every play type, offensive and defensive
                            (POSS, PPP, FG%, eFG%, TOV/FT/SF/+1/score possession shares, percentile)
  playtypes_team.csv.gz     the same per team
  player_base.csv.gz        season box-score totals per player (LeagueDashPlayerStats, Base)
  player_advanced.csv.gz    season advanced stats per player (usage, ratings, TS%, ...)
  player_games.csv.gz       one row per player per game (LeagueGameLog P): minutes and box score
  team_games.csv.gz         one row per team per game (LeagueGameLog T): matchup, home/away, W/L, score

Synergy only exists from 2015-16, and only as season totals (the endpoint takes no date range).

Usage (Docker, from the repo root; Docker here is rootless, so -u 0 writes the files as you):
  docker run --rm -u 0 -v "$PWD/ml:/work" -w /work python:3.12-slim \
    sh -c 'pip install -q nba_api pandas && python -u fetch_data.py [2015-16 2016-17 ...]'
"""
import sys
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import leaguedashplayerstats, leaguegamelog, synergyplaytypes

DATA = Path(__file__).parent / "data"
PAUSE = 0.8
SEASONS = [f"{y}-{str(y + 1)[2:]}" for y in range(2015, 2026)]
PLAY_TYPES = ["Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup",
              "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]
GROUPINGS = ["offensive", "defensive"]


def call(fn, **kw):
    for attempt in range(5):
        try:
            time.sleep(PAUSE)
            return fn(timeout=90, **kw).get_data_frames()[0]
        except Exception as exc:  # stats.nba.com times out now and then
            print(f"    retry {attempt + 1}: {exc}", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"giving up on {fn.__name__} {kw}")


def save(df, path):
    df.to_csv(path, index=False, compression="gzip")
    print(f"  {path.relative_to(DATA)}: {len(df)} rows", flush=True)


def playtypes(season, who):
    frames = []
    for grouping in GROUPINGS:
        for pt in PLAY_TYPES:
            df = call(synergyplaytypes.SynergyPlayTypes, season=season, play_type_nullable=pt,
                      player_or_team_abbreviation=who, type_grouping_nullable=grouping,
                      per_mode_simple="Totals")
            if len(df):
                frames.append(df)
    return pd.concat(frames, ignore_index=True)


def fetch_season(season):
    out = DATA / season
    out.mkdir(parents=True, exist_ok=True)
    jobs = {
        "playtypes_player.csv.gz": lambda: playtypes(season, "P"),
        "playtypes_team.csv.gz": lambda: playtypes(season, "T"),
        "player_base.csv.gz": lambda: call(leaguedashplayerstats.LeagueDashPlayerStats, season=season,
                                           measure_type_detailed_defense="Base", per_mode_detailed="Totals"),
        "player_advanced.csv.gz": lambda: call(leaguedashplayerstats.LeagueDashPlayerStats, season=season,
                                               measure_type_detailed_defense="Advanced", per_mode_detailed="Totals"),
        "player_games.csv.gz": lambda: call(leaguegamelog.LeagueGameLog, season=season,
                                            player_or_team_abbreviation="P", season_type_all_star="Regular Season"),
        "team_games.csv.gz": lambda: call(leaguegamelog.LeagueGameLog, season=season,
                                          player_or_team_abbreviation="T", season_type_all_star="Regular Season"),
    }
    for name, job in jobs.items():
        path = out / name
        if path.exists():
            continue
        save(job(), path)


if __name__ == "__main__":
    for season in sys.argv[1:] or SEASONS:
        print(season, flush=True)
        fetch_season(season)
