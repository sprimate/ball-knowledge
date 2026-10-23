#!/usr/bin/env python3
"""Turn ml/data/ into the training tensors in ml/cache/dataset.npz.

One example per game: both teams' rosters (the 10 players with the most expected minutes among those who played),
each player described by
  pt    Synergy play types of a season: per (offensive|defensive, play type) volume per 36 min, share of the player's
        possessions, and points per possession, eFG%, turnover, free-throw and scoring rates (shrunk to the league
        rate by possessions, so a 10-possession sample doesn't look like a superstar)
  box   season box-score and advanced stats of the same season as pt (per 36, shooting, ratings, usage, ...)
  form  leak-free: the player's numbers in this season's games before this game (games, minutes, per 36, TS%)
plus per team: season-to-date point differential, win %, games played, rest days, back-to-back (tform).

pt and box come in two versions (both stored):
  prior  the previous season's numbers: what you would know before the game (honest)
  same   the game's own season: includes the game being predicted (leaks; for correlations only)
A player with no row in that season (rookie, missed the year) gets the season's average player plus a `missing` flag.

Expected minutes (the weights of a roster): season-to-date minutes per game, blended with last season's for the
first games. Labels: home team won, home margin (`neutral` flags the NBA Cup games on a neutral floor).

Usage: python build_dataset.py   (in the bk-ml image, see Dockerfile)
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
DATA = ML / "data"
OUT = ML / "cache" / "dataset.npz"
SEASONS = sorted(p.name for p in DATA.iterdir() if p.is_dir())
MAXP = 10
K_POSS = 25.0     # play-type shrinkage, possessions
K_MIN = 300.0     # season-stat shrinkage, minutes
K_FORM = 150.0    # season-to-date shrinkage, minutes

PT_METRICS = ["vol", "share", "ppp", "efg", "tov", "ft", "score"]
BOX_COUNTS = ["PTS", "FGA", "FG3A", "FTA", "OREB", "DREB", "AST", "TOV", "STL", "BLK", "BLKA", "PF", "PFD",
              "PLUS_MINUS"]
BOX_PCTS = [("FG_PCT", "FGA", 100.0), ("FG3_PCT", "FG3A", 50.0), ("FT_PCT", "FTA", 30.0)]
ADV = ["OFF_RATING", "DEF_RATING", "NET_RATING", "USG_PCT", "TS_PCT", "AST_PCT", "OREB_PCT", "DREB_PCT", "PIE"]
FORM_COUNTS = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "FGA", "FG3A", "FTA", "PLUS_MINUS"]


def read(season, name):
    return pd.read_csv(DATA / season / f"{name}.csv.gz", dtype={"GAME_ID": str})


def season_index(s):
    return SEASONS.index(s)


# ---------------------------------------------------------------- static (season) features

def combos():
    seen = set()
    for s in SEASONS:
        pt = read(s, "playtypes_player")
        seen |= set(zip(pt.TYPE_GROUPING.str.lower(), pt.PLAY_TYPE))
    return sorted(seen)


COMBOS = combos()


def static_features(season):
    """DataFrame indexed by PLAYER_ID: pt columns, box columns. Plus the fill row for missing players."""
    base = read(season, "player_base").set_index("PLAYER_ID")
    adv = read(season, "player_advanced").set_index("PLAYER_ID")
    base = base[base.MIN > 0]
    mins = base.MIN
    out = {}

    # play types
    pt = read(season, "playtypes_player")
    pt["grp"] = pt.TYPE_GROUPING.str.lower()
    for col in ["POSS_PCT", "FT_POSS_PCT", "TOV_POSS_PCT", "SCORE_POSS_PCT", "EFG_PCT"]:
        pt[col + "_w"] = pt[col] * pt.POSS
    agg = pt.groupby(["PLAYER_ID", "grp", "PLAY_TYPE"]).agg(
        POSS=("POSS", "sum"), PTS=("PTS", "sum"), share=("POSS_PCT_w", "sum"), ft=("FT_POSS_PCT_w", "sum"),
        tov=("TOV_POSS_PCT_w", "sum"), score=("SCORE_POSS_PCT_w", "sum"), efg=("EFG_PCT_w", "sum"))
    for grp, ptype in COMBOS:
        name = f"pt:{grp}:{ptype}"
        try:
            g = agg.xs((grp, ptype), level=("grp", "PLAY_TYPE"))
        except KeyError:
            g = agg.iloc[0:0].droplevel([1, 2])
        g = g.reindex(base.index).fillna(0.0)
        poss = g.POSS
        tot = max(poss.sum(), 1.0)
        lg = {m: g[m].sum() / tot for m in ["ft", "tov", "score", "efg"]}
        lg_ppp = g.PTS.sum() / tot
        out[f"{name}:vol"] = np.log1p(poss / mins * 36.0)
        out[f"{name}:share"] = g.share / poss.where(poss > 0, 1.0)
        out[f"{name}:ppp"] = (g.PTS + lg_ppp * K_POSS) / (poss + K_POSS)
        for m in ["efg", "tov", "ft", "score"]:
            out[f"{name}:{m}"] = (g[m] + lg[m] * K_POSS) / (poss + K_POSS)

    # box score + advanced
    tot_min = mins.sum()
    for c in BOX_COUNTS:
        lg36 = base[c].sum() / tot_min * 36.0
        out[f"box:{c.lower()}_36"] = (base[c] + lg36 / 36.0 * K_MIN) / (mins + K_MIN) * 36.0
    for pct, att, k in BOX_PCTS:
        made = base[pct] * base[att]
        lg = made.sum() / max(base[att].sum(), 1.0)
        out[f"box:{pct.lower()}"] = (made + lg * k) / (base[att] + k)
    out["box:mpg"] = mins / base.GP
    out["box:gp"] = base.GP
    out["box:log_min"] = np.log1p(mins)
    out["box:age"] = base.AGE
    adv = adv.reindex(base.index)
    for c in ADV:
        v = adv[c].astype(float)
        lg = (v * mins).sum() / tot_min
        out[f"box:{c.lower()}"] = (v.fillna(lg) * mins + lg * K_MIN) / (mins + K_MIN)

    df = pd.DataFrame(out, index=base.index).astype("float32")
    df["pt:missing"] = 0.0
    df["box:missing"] = 0.0
    fill = df.mean()
    fill["pt:missing"] = 1.0
    fill["box:missing"] = 1.0
    return df, fill, (mins / base.GP)


# ---------------------------------------------------------------- per-game features

def season_games(season, prior_mpg):
    pg = read(season, "player_games")
    tg = read(season, "team_games")
    pg["GAME_DATE"] = pd.to_datetime(pg.GAME_DATE)
    tg["GAME_DATE"] = pd.to_datetime(tg.GAME_DATE)
    pg = pg.sort_values(["PLAYER_ID", "GAME_DATE", "GAME_ID"]).reset_index(drop=True)
    pg["MIN"] = pg.MIN.fillna(0).astype(float)
    for c in FORM_COUNTS + ["FGM", "FTM"]:
        pg[c] = pg[c].fillna(0).astype(float)
    pg["one"] = (pg.MIN > 0).astype(float)
    g = pg.groupby("PLAYER_ID")
    before = {c: g[c].cumsum() - pg[c] for c in FORM_COUNTS + ["MIN", "one"]}
    gp = before["one"]
    mb = before["MIN"]
    lg_min = pg.MIN.sum()
    form = {"form:log_gp": np.log1p(gp)}
    form["form:mpg"] = mb / gp.where(gp > 0, 1.0)
    for c in FORM_COUNTS:
        lg36 = pg[c].sum() / lg_min * 36.0
        form[f"form:{c.lower()}_36"] = (before[c] + lg36 / 36.0 * K_FORM) / (mb + K_FORM) * 36.0
    fga_b = g.FGA.cumsum() - pg.FGA
    fta_b = g.FTA.cumsum() - pg.FTA
    pts_b = before["PTS"]
    shots = 2.0 * (fga_b + 0.44 * fta_b)
    lg_ts = pg.PTS.sum() / (2.0 * (pg.FGA.sum() + 0.44 * pg.FTA.sum()))
    form["form:ts"] = (pts_b + lg_ts * 50.0) / (shots + 50.0)
    form = pd.DataFrame(form).astype("float32")
    prior = pg.PLAYER_ID.map(prior_mpg).fillna(15.0)
    pg["exp_min"] = (mb + prior * 3.0) / (gp + 3.0)
    pg = pd.concat([pg, form], axis=1)

    # team season-to-date form
    tg = tg.sort_values(["TEAM_ID", "GAME_DATE"]).reset_index(drop=True)
    tg["win"] = (tg.WL == "W").astype(float)
    tgg = tg.groupby("TEAM_ID")
    games_b = tgg.cumcount().astype(float)
    diff_b = tgg.PLUS_MINUS.cumsum() - tg.PLUS_MINUS
    wins_b = tgg.win.cumsum() - tg.win
    rest = tgg.GAME_DATE.diff().dt.days.fillna(5).clip(upper=5)
    tg["tform:log_games"] = np.log1p(games_b)
    tg["tform:diff"] = diff_b / (games_b + 5.0)
    tg["tform:win_pct"] = (wins_b + 2.5) / (games_b + 5.0)
    tg["tform:rest"] = rest
    tg["tform:b2b"] = (rest <= 1).astype(float)
    tg["home"] = tg.MATCHUP.str.contains(" vs. ")
    return pg, tg


def main():
    statics = {s: static_features(s) for s in SEASONS}
    form_cols = [c for c in season_games(SEASONS[0], pd.Series(dtype=float))[0].columns if c.startswith("form:")]
    tform_cols = ["tform:log_games", "tform:diff", "tform:win_pct", "tform:rest", "tform:b2b"]
    cols = list(statics[SEASONS[0]][0].columns)

    # static table: one row per (feature season, player) plus one fill row per feature season
    S_rows, key, S_player, S_season = [], {}, [], []
    for s in SEASONS:
        df, fill, _ = statics[s]
        df = df[cols]
        base = sum(len(r) for r in S_rows)
        key[s] = (base, {pid: base + 1 + i for i, pid in enumerate(df.index)})
        S_rows.append(np.vstack([fill[cols].to_numpy(np.float32)[None], df.to_numpy(np.float32)]))
        S_player += [-1] + list(df.index)
        S_season += [season_index(s)] * (len(df) + 1)
    S = np.vstack(S_rows)

    out = {k: [] for k in ["idx_prior", "idx_same", "w", "form", "tform", "y", "margin", "season", "game_id",
                           "date", "team", "neutral"]}
    for s in SEASONS:
        i = season_index(s)
        prior_s = SEASONS[i - 1] if i > 0 else None
        prior_mpg = statics[prior_s][2] if prior_s else pd.Series(dtype=float)
        pg, tg = season_games(s, prior_mpg)
        pg = pg[pg.MIN > 0]
        rosters = {k: v.sort_values("exp_min", ascending=False).head(MAXP)
                   for k, v in pg.groupby(["GAME_ID", "TEAM_ID"])}
        for gid, gm in tg.groupby("GAME_ID"):
            # NBA Cup knockout games are on a neutral floor: both rows say "@"; keep them, flagged
            neutral = gm.home.sum() == 0
            if len(gm) != 2 or gm.home.sum() > 1:
                raise SystemExit(f"{s} {gid}: {len(gm)} team rows, {gm.home.sum()} home")
            gm = gm.sort_values(["home", "TEAM_ID"], ascending=False)
            idx_p = np.full((2, MAXP), -1, np.int32)
            idx_s = np.full((2, MAXP), -1, np.int32)
            w = np.zeros((2, MAXP), np.float32)
            f = np.zeros((2, MAXP, len(form_cols)), np.float32)
            for t, (_, row) in enumerate(gm.iterrows()):
                r = rosters[(gid, row.TEAM_ID)]
                n = len(r)
                pids = r.PLAYER_ID.to_numpy()
                base_s, m_s = key[s]
                idx_s[t, :n] = [m_s.get(p, base_s) for p in pids]
                if prior_s:
                    base_p, m_p = key[prior_s]
                    idx_p[t, :n] = [m_p.get(p, base_p) for p in pids]
                w[t, :n] = r.exp_min.to_numpy() / r.exp_min.sum()
                f[t, :n] = r[form_cols].to_numpy(np.float32)
            out["idx_prior"].append(idx_p)
            out["idx_same"].append(idx_s)
            out["w"].append(w)
            out["form"].append(f)
            out["tform"].append(gm[tform_cols].to_numpy(np.float32))
            out["neutral"].append(float(neutral))
            out["y"].append(float(gm.WL.iloc[0] == "W"))
            out["margin"].append(float(gm.PLUS_MINUS.iloc[0]))
            out["season"].append(i)
            out["game_id"].append(gid)
            out["date"].append(str(gm.GAME_DATE.iloc[0].date()))
            out["team"].append(gm.TEAM_ID.to_numpy())
        print(f"{s}: {len(tg) // 2} games", flush=True)

    OUT.parent.mkdir(exist_ok=True)
    np.savez_compressed(
        OUT, S=S, S_player=np.array(S_player), S_season=np.array(S_season), static_cols=np.array(cols),
        form_cols=np.array(form_cols), tform_cols=np.array(tform_cols),
        seasons=np.array(SEASONS), **{k: np.array(v) for k, v in out.items()})
    print(f"wrote {OUT}: static {S.shape}, games {len(out['y'])}, home win rate {np.mean(out['y']):.3f}")


if __name__ == "__main__":
    main()
