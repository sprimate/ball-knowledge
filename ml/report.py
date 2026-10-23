#!/usr/bin/env python3
"""ml/reports/results.json + importance.json + the dataset -> ml/reports/REPORT.md.

Usage: python report.py   (in the bk-ml image)
"""
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ML = Path(__file__).parent
REPORTS = ML / "reports"
GROUP_NAMES = {"pt": "play types", "box": "season stats", "form": "season-to-date form", "pt+box": "play types + stats",
               "pt+form": "play types + form", "box+form": "stats + form", "all": "all three"}


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def main():
    rows = json.loads((REPORTS / "results.json").read_text())
    imps = json.loads((REPORTS / "results_importance.json").read_text())
    tests = sorted({r["test"] for r in rows})
    md = ["# Play-type win-probability network: results", "",
          f"Walk-forward: each test season ({tests[0]} to {tests[-1]}) is predicted by models trained only on the "
          "seasons before it (the season just before it is used for early stopping). Numbers are averaged over the "
          f"{len(tests)} test seasons ({sum(r['n'] for r in rows if r['model'] == 'home' and r['mode'] == 'prior' and r['group'] == 'all')} games); "
          "the network is also averaged over its seeds. Lower log loss / Brier is better. For scale: always "
          "picking the home team scores log loss ~0.687. Only as a yardstick (odds are not an input): the de-vigged "
          "closing moneyline scored 0.5802 / 0.1981 / 69.4 % on 2023-24 and 0.5817 / 0.1993 / 69.2 % on 2024-25 "
          "(sports repo, `games_with_odds`).", "",
          "- **prior** uses each player's previous-season play types and stats: what is known before the game.",
          "- **same** uses the game's own season: the stats include the game being predicted, so it leaks. It "
          "shows how strongly a profile goes with winning, not how well we can predict.", ""]

    # ---- main table
    agg = defaultdict(list)
    for r in rows:
        agg[(r["mode"], r["group"], r["model"])].append(r)
    for mode in ["prior", "same"]:
        md += [f"## {mode}: log loss / Brier / accuracy by input group", ""]
        out = []
        for g in GROUP_NAMES:
            cells = [GROUP_NAMES[g]]
            for model in ["net", "logreg", "gbm"]:
                rs = agg.get((mode, g, model))
                if not rs:
                    cells.append("")
                    continue
                cells.append(f"{np.mean([r['logloss'] for r in rs]):.4f} / {np.mean([r['brier'] for r in rs]):.4f}"
                             f" / {100 * np.mean([r['acc'] for r in rs]):.1f} %")
            out.append(cells)
        home = agg.get((mode, "all", "home"))
        if home:
            out.append(["home court only", f"{np.mean([r['logloss'] for r in home]):.4f} / "
                        f"{np.mean([r['brier'] for r in home]):.4f} / {100 * np.mean([r['acc'] for r in home]):.1f} %",
                        "", ""])
        md += [table(["inputs", "network", "logistic regression", "gradient boosting"], out), ""]

        # ---- does adding play types help? paired per test season and seed
        md += [f"### {mode}: what adding play types changes (network, paired by test season and seed)", ""]
        out = []
        for without, with_ in [("box", "pt+box"), ("form", "pt+form"), ("box+form", "all")]:
            a = {(r["test"], r["seed"]): r["logloss"] for r in agg.get((mode, without, "net"), [])}
            b = {(r["test"], r["seed"]): r["logloss"] for r in agg.get((mode, with_, "net"), [])}
            keys = sorted(set(a) & set(b))
            if not keys:
                continue
            d = np.array([b[k] - a[k] for k in keys])
            se = d.std(ddof=1) / np.sqrt(len(d)) if len(d) > 1 else 0.0
            per = defaultdict(list)
            for k in keys:
                per[k[0]].append(b[k] - a[k])
            better = sum(np.mean(v) < 0 for v in per.values())
            out.append([f"{GROUP_NAMES[without]} → + play types", f"{d.mean():+.4f} ± {1.96 * se:.4f}",
                        f"{better} of {len(per)}"])
        md += [table(["change", "Δ log loss (95 % CI)", "test seasons where it helped"], out),
               "", "Negative = play types made predictions better.", ""]

    # ---- per season, best honest config
    md += ["## Per test season (prior, network)", ""]
    out = []
    for t in tests:
        cells = [t]
        for g in ["pt", "box+form", "all"]:
            rs = [r for r in agg.get(("prior", g, "net"), []) if r["test"] == t]
            cells.append(f"{np.mean([r['logloss'] for r in rs]):.4f} / {100 * np.mean([r['acc'] for r in rs]):.1f} %"
                         if rs else "")
        out.append(cells)
    md += [table(["test season", "play types only", "stats + form", "all three"], out), ""]

    # ---- importance
    for mode in ["prior", "same"]:
        for g in ["pt", "all"]:
            sel = [i["importance"] for i in imps if i["mode"] == mode and i["group"] == g]
            if not sel:
                continue
            mean = {k: np.mean([s[k] for s in sel if k in s]) for k in sel[0]}
            md += [f"## What the network relies on: {mode}, inputs = {GROUP_NAMES[g]}", "",
                   "Permutation importance: how much the test log loss gets worse when one family of inputs is "
                   "shuffled across players (averaged over test seasons). Bigger = more relied on; ~0 or negative = "
                   "not used.", ""]
            groups = sorted(((k, v) for k, v in mean.items() if k.startswith("group")), key=lambda x: -x[1])
            pts = sorted(((k[9:], v) for k, v in mean.items() if k.startswith("playtype")), key=lambda x: -x[1])
            mets = sorted(((k[7:], v) for k, v in mean.items() if k.startswith("metric")), key=lambda x: -x[1])
            if len(groups) > 1:
                md += [table(["input group", "Δ log loss"], [(k[6:], f"{v:+.4f}") for k, v in groups]), ""]
            md += [table(["play type (offensive/defensive)", "Δ log loss"], [(k, f"{v:+.4f}") for k, v in pts]), "",
                   table(["play-type metric (all play types)", "Δ log loss"], [(k, f"{v:+.4f}") for k, v in mets]), ""]

    # ---- team-level correlations
    md += correlations()
    (REPORTS / "REPORT.md").write_text("\n".join(md) + "\n")
    print("wrote", REPORTS / "REPORT.md")


def correlations():
    z = np.load(ML / "cache" / "dataset.npz")
    S, cols, seasons = z["S"], [str(c) for c in z["static_cols"]], [str(s) for s in z["seasons"]]
    pt = [i for i, c in enumerate(cols) if c.startswith("pt:") and c.count(":") == 3 and
          c.split(":")[3] in ("vol", "ppp")]
    team, season, y = z["team"], z["season"], z["y"]
    out = []
    for mode, label in [("same", "same season"), ("prior", "previous season's players")]:
        idx, w = z[f"idx_{mode}"], z["w"]
        feats = (S[np.where(idx >= 0, idx, 0)][..., pt] * w[..., None]).sum(2)    # [G,2,F]
        acc = defaultdict(lambda: [np.zeros(len(pt)), 0.0, 0])
        for g in range(len(y)):
            if mode == "prior" and season[g] == 0:
                continue
            for t in range(2):
                a = acc[(int(season[g]), int(team[g, t]))]
                a[0] += feats[g, t]
                a[1] += y[g] if t == 0 else 1 - y[g]
                a[2] += 1
        X = np.array([a[0] / a[2] for a in acc.values()])
        wp = np.array([a[1] / a[2] for a in acc.values()])
        # within-season z-scores so league-wide trends (more 3s every year) don't dominate
        keys = list(acc)
        for s in set(k[0] for k in keys):
            m = np.array([k[0] == s for k in keys])
            X[m] = (X[m] - X[m].mean(0)) / (X[m].std(0) + 1e-9)
        r = np.array([np.corrcoef(X[:, j], wp)[0, 1] for j in range(len(pt))])
        order = np.argsort(-np.abs(r))[:20]
        out += [f"## Team-season correlations with win % ({label})", "",
                f"{len(keys)} team-seasons. Each team's play-type numbers are the minutes-weighted average of the "
                "players it put on the floor, z-scored within each season; r is the correlation with that "
                "season's win %. vol = possessions per 36 min of that play type, ppp = points per possession "
                "(defensive ppp = points allowed, so negative r is good defense). The 20 strongest:", "",
                table(["feature", "r"], [(cols[pt[j]][3:].replace(":", " "), f"{r[j]:+.2f}") for j in order]), ""]
    return out


if __name__ == "__main__":
    main()
