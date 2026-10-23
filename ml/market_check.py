#!/usr/bin/env python3
"""The network against the closing moneyline: log loss, a blend with the market, and flat-stake betting.

Odds are only used here, after the fact, never as a model input. For each test season the network is trained
walk-forward exactly as in train.py (prior mode, seasons before T-1, early stop on T-1), averaged over seeds, and
matched by NBA game id to `games_with_odds` of the sports repo's sports_data.db (closing American moneylines).

- market: de-vigged closing line (multiplicative)
- blend: logit(p) = w * logit(model) + (1 - w) * logit(market), w fitted on the previous test season only
- betting, $10 per bet, one side per game, only when the expected value after costs is positive:
    kalshi  price = de-vigged line (a stand-in: Kalshi prices were not logged), fee 7% x p x (1 - p) per contract
    book    the posted line itself (vig included)
  ROI with a bootstrap 95% interval over games.

Usage: python market_check.py --odds-db sports_data.db [--groups box+form all pt] [--tests 2023-24 2024-25 2025-26]
Writes reports/market_check.json and reports/MARKET.md.
"""
import argparse
import json
import sqlite3
from multiprocessing import Pool
from pathlib import Path

import numpy as np

import train

ML = Path(__file__).parent


def american_to_prob(o):
    o = np.asarray(o, float)
    return np.where(o > 0, 100.0 / (o + 100.0), -o / (-o + 100.0))


def american_to_payout(o):
    """Profit per $1 staked on a win."""
    o = np.asarray(o, float)
    return np.where(o > 0, o / 100.0, 100.0 / -o)


def predict_season(job):
    import torch
    torch.set_num_threads(2)
    group, test, seed = job
    d = train.load()
    s = d["season"]
    ti = d["seasons"].index(test)
    tr, va, te = (s >= 1) & (s < ti - 1), s == ti - 1, s == ti
    X, W, T, _, _ = train.features("prior", group, tr)
    home = 1.0 - d["neutral"]
    pred = train.train_net(X, W, T, home, d["y"], d["margin"], tr, va, seed)[0]
    sl = lambda a: None if a is None else a[te]
    return group, test, seed, pred(X[te], W[te], sl(T), home[te]).tolist()


def logloss(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def bets(p_model, y, price_home, payout_home, payout_away, fee):
    """Flat $1 bets where EV > 0. fee: Kalshi-style contracts at price_home; else the book's payouts."""
    profit = []
    for pm, yy, ph, uh, ua in zip(p_model, y, price_home, payout_home, payout_away):
        best = None
        for side, p_win, pay in [(1, pm, uh), (0, 1 - pm, ua)]:
            if fee:
                price = ph if side == 1 else 1 - ph
                cost = price + 0.07 * price * (1 - price)
                ev = p_win / cost - 1          # $1 buys 1/cost contracts paying $1 each
                pay_eff = 1 / cost - 1
            else:
                ev = p_win * pay - (1 - p_win)
                pay_eff = pay
            if ev > 0 and (best is None or ev > best[0]):
                best = (ev, side, pay_eff)
        if best:
            won = (best[1] == 1) == (yy == 1)
            profit.append(best[2] if won else -1.0)
    return np.array(profit)


def roi(profit, rng):
    if len(profit) == 0:
        return {"bets": 0}
    boot = [rng.choice(profit, len(profit)).mean() for _ in range(2000)]
    return {"bets": int(len(profit)), "roi": float(profit.mean()),
            "lo": float(np.percentile(boot, 2.5)), "hi": float(np.percentile(boot, 97.5))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--odds-db", required=True)
    ap.add_argument("--groups", nargs="+", default=["box+form", "all", "pt"])
    ap.add_argument("--tests", nargs="+", default=["2023-24", "2024-25", "2025-26"])
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    d = train.load()
    jobs = [(g, t, s) for g in a.groups for t in a.tests for s in range(a.seeds)]
    cache = ML / "cache" / "market_preds.json"
    done = json.loads(cache.read_text()) if cache.exists() else {}
    todo = [j for j in jobs if f"{j[0]}|{j[1]}|{j[2]}" not in done]
    with Pool(a.jobs) as pool:
        for g, t, s, p in pool.imap_unordered(predict_season, todo):
            done[f"{g}|{t}|{s}"] = p
            cache.write_text(json.dumps(done))
            print(f"{g} {t} seed {s} done", flush=True)
    preds = {}
    for g, t, s in jobs:
        preds.setdefault((g, t), []).append(np.array(done[f"{g}|{t}|{s}"]))

    con = sqlite3.connect(f"file:{a.odds_db}?mode=ro", uri=True)
    odds = {gid: (ho, ao) for gid, ho, ao in con.execute(
        "select api_id, home_odds, away_odds from games_with_odds where abs(home_odds) >= 100 and abs(away_odds) >= 100")}
    rng = np.random.default_rng(0)
    out, md = [], ["# Network vs. the closing line", "",
                   "Walk-forward network (prior mode: last season's play types/stats, this season's form before the "
                   "game), averaged over seeds, on the games with closing odds. Blend weight fitted on the previous "
                   "test season. Betting: $1 flat, one side, only when expected value after costs > 0; Kalshi price = "
                   "de-vigged line with Kalshi's fee (a stand-in, Kalshi prices were not logged); book = posted line.",
                   "", "| inputs | season | games | network | market | blend (w) | Kalshi-style ROI (bets) | "
                   "book ROI (bets) |", "|---|---|---|---|---|---|---|---|"]
    for g in a.groups:
        w_prev = None
        for t in a.tests:
            ti = d["seasons"].index(t)
            te = np.where(d["season"] == ti)[0]
            p = np.mean(preds[(g, t)], axis=0)
            gids = d["game_id"][te]
            keep = [i for i, gid in enumerate(gids) if gid in odds and d["neutral"][te[i]] == 0]
            p, y = p[keep], d["y"][te][keep]
            ho = np.array([odds[gids[i]][0] for i in keep])
            ao = np.array([odds[gids[i]][1] for i in keep])
            qh, qa = american_to_prob(ho), american_to_prob(ao)
            mkt = qh / (qh + qa)
            ws = np.linspace(0, 1, 21)
            w_in = ws[np.argmin([logloss(1 / (1 + np.exp(-(w * logit(p) + (1 - w) * logit(mkt)))), y) for w in ws])]
            w = w_prev if w_prev is not None else w_in
            blend = 1 / (1 + np.exp(-(w * logit(p) + (1 - w) * logit(mkt))))
            k = roi(bets(p, y, mkt, american_to_payout(ho), american_to_payout(ao), fee=True), rng)
            b = roi(bets(p, y, mkt, american_to_payout(ho), american_to_payout(ao), fee=False), rng)
            row = {"group": g, "test": t, "games": len(y), "net": logloss(p, y), "market": logloss(mkt, y),
                   "blend": logloss(blend, y), "w": float(w), "w_fitted_here": float(w_in),
                   "w_from": "previous season" if w_prev is not None else "this season (in-sample)",
                   "kalshi": k, "book": b}
            out.append(row)
            fmt = lambda r: f"{100 * r['roi']:+.1f} % [{100 * r['lo']:+.1f}, {100 * r['hi']:+.1f}] ({r['bets']})" \
                if r["bets"] else "no bets"
            md.append(f"| {g} | {t} | {len(y)} | "
                      f"{row['net']:.4f} | {row['market']:.4f} | {row['blend']:.4f} ({w:.2f}"
                      f"{'*' if w_prev is None else ''}) | {fmt(k)} | {fmt(b)} |")
            w_prev = w_in
    md += ["", "\\* first season: weight fitted on the same season (in-sample), so that blend is optimistic.", ""]
    (ML / "reports" / "market_check.json").write_text(json.dumps(out, indent=1))
    (ML / "reports" / "MARKET.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
