#!/usr/bin/env python3
"""Walk-forward training of the win-probability network, its baselines, ablations and permutation importance.

For every test season T: train on the seasons before T-1, early-stop on T-1, predict T. Nothing from T or later is
seen in training. Writes ml/reports/results.json (one row per run) and ml/reports/importance.json.

  mode    prior: last season's play types / stats (honest)   same: the game's own season (leaks, correlations only)
  group   which inputs the players carry: pt (play types), box (season stats), form (season-to-date numbers and
          team form), and combinations such as pt+box or all
  model   net (player-set network), logreg and gbm (on minutes-weighted team averages of the same features),
          home (home-court rate only)

Usage: python -u train.py [--modes prior same] [--groups pt box form pt+box all] [--tests 2021-22 ...] [--seeds 3]
                          [--jobs 4]
"""
import argparse
import json
import os
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

ML = Path(__file__).parent
REPORTS = ML / "reports"
D = None  # dataset, loaded per process


def load():
    global D
    if D is None:
        z = np.load(ML / "cache" / "dataset.npz", allow_pickle=False)
        D = {k: z[k] for k in z.files}
        D["static_cols"] = [str(c) for c in D["static_cols"]]
        D["form_cols"] = [str(c) for c in D["form_cols"]]
        D["seasons"] = [str(s) for s in D["seasons"]]
    return D


def metrics(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {"logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "brier": float(np.mean((p - y) ** 2)), "acc": float(np.mean((p > 0.5) == (y == 1))), "n": int(len(y))}


def features(mode, group, train_mask):
    """Player tensor X [G,2,P,F], weights W [G,2,P], team tensor T [G,2,Ft] (or None), column names, and the
    normalisation of the static columns (for predict.py)."""
    d = load()
    parts = set(group.split("+"))
    if "all" in parts:
        parts = {"pt", "box", "form"}
    scols = [i for i, c in enumerate(d["static_cols"]) if c.split(":")[0] in parts]
    idx = d[f"idx_{mode}"]
    W = d["w"].astype(np.float32)
    valid = idx >= 0
    blocks, names, norm = [], [], None
    tr_slots = valid & train_mask[:, None, None]
    if scols:
        S = d["S"][:, scols]
        used = np.unique(idx[tr_slots])
        mu, sd = S[used].mean(0), S[used].std(0) + 1e-6
        Sn = ((S - mu) / sd).astype(np.float32)
        norm = (scols, mu, sd)
        Xs = Sn[np.where(valid, idx, 0)]
        Xs[~valid] = 0.0
        blocks.append(Xs)
        names += [d["static_cols"][i] for i in scols]
    T = None
    if "form" in parts:
        F = d["form"]
        mu, sd = F[tr_slots].mean(0), F[tr_slots].std(0) + 1e-6
        Fn = ((F - mu) / sd).astype(np.float32)
        Fn[~valid] = 0.0
        blocks.append(Fn)
        names += d["form_cols"]
        Tf = d["tform"]
        tr = Tf[train_mask].reshape(-1, Tf.shape[-1])
        T = ((Tf - tr.mean(0)) / (tr.std(0) + 1e-6)).astype(np.float32)
    X = np.concatenate(blocks, axis=-1)
    return X, W, T, names, norm


def team_table(X, W, T, home):
    """Minutes-weighted team averages, home minus away, for the baselines."""
    agg = (X * W[..., None]).sum(2)
    parts = [agg[:, 0] - agg[:, 1]]
    if T is not None:
        parts.append(T[:, 0] - T[:, 1])
    parts.append(home[:, None])
    return np.concatenate(parts, axis=1)


# ---------------------------------------------------------------- the network

def build_net(F, Ft, hid=128, emb=48, drop=0.3):
    import torch
    from torch import nn

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = nn.Sequential(nn.Dropout(0.1), nn.Linear(F, hid), nn.GELU(), nn.Dropout(drop),
                                     nn.Linear(hid, emb), nn.GELU())
            t = emb + Ft
            self.head = nn.Sequential(nn.Dropout(drop), nn.Linear(2 * t, 64), nn.GELU(), nn.Dropout(drop),
                                      nn.Linear(64, 2))
            self.home = nn.Parameter(torch.zeros(2))

        def forward(self, X, W, T, home):
            e = self.enc(X)                                  # [B,2,P,emb] one vector per player
            t = (e * W.unsqueeze(-1)).sum(2)                 # [B,2,emb]  minutes-weighted team vector
            if T is not None:
                t = torch.cat([t, T], -1)
            a = torch.cat([t[:, 0], t[:, 1]], -1)
            b = torch.cat([t[:, 1], t[:, 0]], -1)
            out = self.head(a) - self.head(b) + home.unsqueeze(-1) * self.home   # antisymmetric: swap = flip
            return out[:, 0], out[:, 1]

    return Net()


def train_net(X, W, T, home, y, margin, tr, va, seed, max_epochs=80, patience=10, lr=1e-3, wd=1e-2):
    import torch
    torch.manual_seed(seed)
    np.random.seed(seed)
    t = lambda a: None if a is None else torch.from_numpy(np.ascontiguousarray(a))
    Xt, Wt, Tt = t(X), t(W), t(T)
    ht, yt, mt = t(home.astype(np.float32)), t(y.astype(np.float32)), t((margin / 13.0).astype(np.float32))
    net = build_net(X.shape[-1], 0 if T is None else T.shape[-1])
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=wd)
    bce = torch.nn.BCEWithLogitsLoss()
    tr_i, va_i = np.where(tr)[0], np.where(va)[0]

    def predict(ix):
        net.eval()
        with torch.no_grad():
            lg, _ = net(Xt[ix], Wt[ix], None if Tt is None else Tt[ix], ht[ix])
        return torch.sigmoid(lg).numpy()

    best, best_state, bad, epochs = 1e9, None, 0, 0
    for epoch in range(max_epochs):
        net.train()
        perm = np.random.permutation(tr_i)
        for s in range(0, len(perm), 128):
            b = perm[s:s + 128]
            lg, mg = net(Xt[b], Wt[b], None if Tt is None else Tt[b], ht[b])
            loss = bce(lg, yt[b]) + 0.5 * torch.mean((mg - mt[b]) ** 2)
            opt.zero_grad()
            loss.backward()
            opt.step()
        v = metrics(predict(va_i), y[va_i])["logloss"]
        epochs = epoch + 1
        if v < best - 1e-4:
            best, bad = v, 0
            best_state = {k: x.clone() for k, x in net.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    net.load_state_dict(best_state)

    def predict_arrays(Xa, Wa, Ta, ha):
        net.eval()
        with torch.no_grad():
            lg, _ = net(t(Xa), t(Wa), t(Ta), t(ha.astype(np.float32)))
        return torch.sigmoid(lg).numpy()

    return predict_arrays, epochs, best, net


# ---------------------------------------------------------------- importance

def families(names):
    fam = {}
    for i, n in enumerate(names):
        k = n.split(":")
        if k[0] == "pt" and len(k) == 4:
            fam.setdefault(f"playtype {k[1]} {k[2]}", []).append(i)
            fam.setdefault(f"metric {k[3]}", []).append(i)
            fam.setdefault("group play types (all)", []).append(i)
        elif k[0] == "box":
            fam.setdefault(f"stat {k[1]}", []).append(i)
            fam.setdefault("group season stats (all)", []).append(i)
        elif k[0] == "form":
            fam.setdefault("group season-to-date player form (all)", []).append(i)
    return fam


def importance(pred, X, W, T, home, y, names, rng, repeats=3):
    base = metrics(pred(X, W, T, home), y)["logloss"]
    valid = W > 0
    flat_idx = np.argwhere(valid)
    out = {}
    for fam, cols in families(names).items():
        deltas = []
        for _ in range(repeats):
            Xp = X.copy()
            src = flat_idx[rng.permutation(len(flat_idx))]
            vals = X[src[:, 0], src[:, 1], src[:, 2]][:, cols]
            sub = Xp[flat_idx[:, 0], flat_idx[:, 1], flat_idx[:, 2]]
            sub[:, cols] = vals
            Xp[flat_idx[:, 0], flat_idx[:, 1], flat_idx[:, 2]] = sub
            deltas.append(metrics(pred(Xp, W, T, home), y)["logloss"] - base)
        out[fam] = float(np.mean(deltas))
    if T is not None:
        deltas = []
        for _ in range(repeats):
            Tp = T.copy()
            Tp[:] = T[rng.permutation(len(T))]
            deltas.append(metrics(pred(X, W, Tp, home), y)["logloss"] - base)
        out["group team form (all)"] = float(np.mean(deltas))
    return out


# ---------------------------------------------------------------- one job

def run(job):
    import torch
    torch.set_num_threads(int(os.environ.get("THREADS", "2")))
    mode, group, test, seed, do_baselines, do_importance = job
    d = load()
    seasons = d["seasons"]
    ti = seasons.index(test)
    s = d["season"]
    first = 1 if mode == "prior" else 0
    tr = (s >= first) & (s < ti - 1)
    va = s == ti - 1
    te = s == ti
    t0 = time.time()
    X, W, T, names, _ = features(mode, group, tr)
    home = 1.0 - d["neutral"]
    y, margin = d["y"], d["margin"]
    rows = []
    pred, epochs, best_val, _ = train_net(X, W, T, home, y, margin, tr, va, seed)
    sl = lambda a: None if a is None else a[te]
    p = pred(X[te], W[te], sl(T), home[te])
    key = {"mode": mode, "group": group, "test": test, "seed": seed}
    rows.append({**key, "model": "net", **metrics(p, y[te]), "val_logloss": best_val, "epochs": epochs,
                 "secs": round(time.time() - t0, 1)})
    imp = None
    if do_importance:
        imp = {**key, "importance": importance(pred, X[te], W[te], sl(T), home[te], y[te], names,
                                               np.random.default_rng(seed))}
    if do_baselines:
        from sklearn.ensemble import HistGradientBoostingClassifier
        from sklearn.linear_model import LogisticRegression
        Z = team_table(X, W, T, home)
        rows.append({**key, "model": "home", **metrics(np.full(te.sum(), y[tr].mean()), y[te])})
        best = None
        for C in [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]:
            m = LogisticRegression(C=C, max_iter=2000).fit(Z[tr], y[tr])
            v = metrics(m.predict_proba(Z[va])[:, 1], y[va])["logloss"]
            if best is None or v < best[0]:
                best = (v, m)
        rows.append({**key, "model": "logreg", **metrics(best[1].predict_proba(Z[te])[:, 1], y[te]),
                     "val_logloss": best[0]})
        best = None
        for leaves in [7, 15]:
            m = HistGradientBoostingClassifier(learning_rate=0.03, max_iter=600, max_leaf_nodes=leaves,
                                               l2_regularization=1.0, early_stopping=True,
                                               validation_fraction=0.15, n_iter_no_change=30,
                                               random_state=seed).fit(Z[tr], y[tr])
            v = metrics(m.predict_proba(Z[va])[:, 1], y[va])["logloss"]
            if best is None or v < best[0]:
                best = (v, m)
        rows.append({**key, "model": "gbm", **metrics(best[1].predict_proba(Z[te])[:, 1], y[te]),
                     "val_logloss": best[0]})
    print(f"{mode:5} {group:10} {test} seed {seed}: net {rows[0]['logloss']:.4f} acc {rows[0]['acc']:.3f} "
          f"({rows[0]['epochs']} ep, {rows[0]['secs']} s)", flush=True)
    return rows, imp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", nargs="+", default=["prior", "same"])
    ap.add_argument("--groups", nargs="+", default=["pt", "box", "form", "pt+box", "pt+form", "box+form", "all"])
    ap.add_argument("--tests", nargs="+", default=["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"])
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--out", default="results")
    a = ap.parse_args()
    jobs = [(m, g, t, s, s == 0, s == 0 and g in ("all", "pt", "pt+box"))
            for m in a.modes for g in a.groups for t in a.tests for s in range(a.seeds)]
    REPORTS.mkdir(exist_ok=True)
    rows, imps = [], []
    with Pool(a.jobs) as pool:
        for r, imp in pool.imap_unordered(run, jobs):
            rows += r
            if imp:
                imps.append(imp)
            (REPORTS / f"{a.out}.json").write_text(json.dumps(rows, indent=1))
            (REPORTS / f"{a.out}_importance.json").write_text(json.dumps(imps, indent=1))
    print(f"{len(rows)} result rows -> {REPORTS / (a.out + '.json')}")


if __name__ == "__main__":
    main()
