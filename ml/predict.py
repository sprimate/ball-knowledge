#!/usr/bin/env python3
"""Win probability of one team against another, from the players' play types and season stats.

Trains (once per --inputs, cached in ml/cache/) an ensemble of the network on every season in `prior` mode:
last season's play types and stats predict this season's games. So a matchup is described by the players' numbers
of --season (default: the latest season in ml/data), which is exactly what the model saw before each game it was
trained on. Rosters: each team's players at the end of that season (their last game), the 10 with the most minutes
per game, weighted by those minutes. --home-players / --away-players replace a roster (player names, comma
separated, any players of that season), so offseason moves or injuries can be tried.

Usage: python predict.py BOS NYK [--inputs pt|box|pt+box] [--season 2025-26] [--neutral] [--away-players "Jalen Brunson,Karl-Anthony Towns"]
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

import train

ML = Path(__file__).parent
MODE, SEEDS = "prior", 5


def models(group):
    import torch
    d = train.load()
    s = d["season"]
    last = len(d["seasons"]) - 1
    tr = (s >= 1) & (s < last)
    va = s == last
    X, W, T, names, norm = train.features(MODE, group, tr)
    home = 1.0 - d["neutral"]
    nets = []
    for seed in range(SEEDS):
        path = ML / "cache" / f"predict_{group}_{seed}.pt"
        net = train.build_net(X.shape[-1], 0)
        if path.exists():
            net.load_state_dict(torch.load(path))
        else:
            print(f"training model {seed + 1}/{SEEDS} ...", flush=True)
            train_net_and_save(X, W, home, d, tr, va, seed, path)
            net.load_state_dict(torch.load(path))
        net.eval()
        nets.append(net)
    return nets, norm


def train_net_and_save(X, W, home, d, tr, va, seed, path):
    import torch
    net = train.train_net(X, W, None, home, d["y"], d["margin"], tr, va, seed)[3]
    torch.save(net.state_dict(), path)


def roster(season, team, names):
    pg = pd.read_csv(ML / "data" / season / "player_games.csv.gz", dtype={"GAME_ID": str})
    base = pd.read_csv(ML / "data" / season / "player_base.csv.gz")
    base["MPG"] = base.MIN / base.GP
    if names:
        wanted = [n.strip().lower() for n in names.split(",")]
        r = base[base.PLAYER_NAME.str.lower().isin(wanted)]
        missing = set(wanted) - set(r.PLAYER_NAME.str.lower())
        if missing:
            raise SystemExit(f"not found in {season}: {', '.join(sorted(missing))}")
    else:
        last = pg.sort_values("GAME_DATE").groupby("PLAYER_ID").tail(1)
        ids = last[last.TEAM_ABBREVIATION == team].PLAYER_ID
        if ids.empty:
            raise SystemExit(f"no team {team} in {season}")
        r = base[base.PLAYER_ID.isin(ids)]
    return r.sort_values("MPG", ascending=False).head(10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("home")
    ap.add_argument("away")
    ap.add_argument("--season")
    ap.add_argument("--neutral", action="store_true")
    ap.add_argument("--inputs", default="pt+box", choices=["pt", "box", "pt+box"],
                    help="pt = play types only, box = season stats only, pt+box = both (default)")
    ap.add_argument("--home-players")
    ap.add_argument("--away-players")
    a = ap.parse_args()
    import torch
    d = train.load()
    season = a.season or d["seasons"][-1]
    si = d["seasons"].index(season)
    nets, (scols, mu, sd) = models(a.inputs)
    rows = {int(p): i for i, (p, s) in enumerate(zip(d["S_player"], d["S_season"])) if s == si and p >= 0}
    P = 10
    X = np.zeros((1, 2, P, len(scols)), np.float32)
    W = np.zeros((1, 2, P), np.float32)
    for t, (team, names) in enumerate([(a.home, a.home_players), (a.away, a.away_players)]):
        r = roster(season, team.upper(), names)
        print(f"{'home' if t == 0 and not a.neutral else 'team 1' if t == 0 else 'away' if not a.neutral else 'team 2'}"
              f" {team.upper()}: " + ", ".join(f"{n} {m:.0f}" for n, m in zip(r.PLAYER_NAME, r.MPG)))
        for j, (pid, mpg) in enumerate(zip(r.PLAYER_ID, r.MPG)):
            if pid in rows:
                X[0, t, j] = (d["S"][rows[pid], scols] - mu) / sd
                W[0, t, j] = mpg
        W[0, t] /= W[0, t].sum()
    h = torch.tensor([0.0 if a.neutral else 1.0])
    with torch.no_grad():
        ps = [torch.sigmoid(n(torch.from_numpy(X), torch.from_numpy(W), None, h)[0]).item() for n in nets]
    p = float(np.mean(ps))
    print(f"\nP({a.home.upper()} beats {a.away.upper()}) = {100 * p:.1f} %   "
          f"(ensemble of {len(ps)}: {', '.join(f'{100 * x:.1f}' for x in ps)})")


if __name__ == "__main__":
    main()
