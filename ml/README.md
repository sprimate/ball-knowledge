# Win-probability network from play-type data

Card https://conductor.sprimate.com/cards/1890807339649336853. A neural network that gives P(team A beats team B)
from both rosters' Synergy play types (offensive and defensive) plus their other stats. No odds.
Results: `reports/REPORT.md` (also on Docs: Ball Knowledge space, "Play-type win-probability network").

Everything runs in Docker (the host has no ML libraries). From the repo root:

    docker build -t bk-ml ml
    run() { docker run --rm -u 0 -v "$PWD/ml:/work" -w /work bk-ml "$@"; }
    run python -u fetch_data.py          # stats.nba.com -> data/ (already done; resumable)
    python3 ml/check_data.py             # sanity checks, standard library only
    run python -u build_dataset.py       # data/ -> cache/dataset.npz (~1 min)
    run python -u train.py --jobs 3      # walk-forward grid -> reports/results*.json (~1.5 h on this machine)
    run python report.py                 # -> reports/REPORT.md
    run python predict.py BOS NYK        # P(BOS beats NYK at home) from 2025-26 players

(`-u 0`: Docker here is rootless, root in the container writes files as you.)

## Files
- `fetch_data.py`: every regular season from 2015-16 (the first with Synergy data) to 2025-26 into `data/<season>/`:
  play types per player and team, season base and advanced stats, player and team game logs.
- `build_dataset.py`: one example per game. Each team = the 10 players with the most expected minutes among those who
  played (expected minutes = season-to-date MPG blended with last season's, never the game's own minutes). Each player
  carries `pt` (18 offensive/defensive play types × volume per 36, possession share, PPP, eFG%, TOV, FT, score rates,
  shrunk toward the league by possessions), `box` (season per-36, shooting, ratings, usage, ...) and `form` (this
  season's numbers before the game); the team carries `tform` (point differential and win % to date, rest,
  back-to-back). `pt` and `box` exist as `prior` (last season: honest) and `same` (this season: leaks).
- `train.py`: network = shared player encoder → minutes-weighted team vector → antisymmetric matchup head
  (swapping the teams flips the probability) + home-court term; trained on win (log loss) and margin. Baselines:
  home rate, logistic regression and gradient boosting on minutes-weighted team averages. Walk-forward: test season T,
  train on seasons < T-1, early-stop on T-1. Permutation importance per play type / metric / input group.
- `report.py`: tables, paired "does adding play types help" test, importance, team-season correlations.
- `predict.py`: ensemble trained on all seasons (`prior`, `pt+box`), predicts a matchup from a season's rosters;
  `--home-players/--away-players` override rosters.

## Things to know
- Synergy play types are **season totals** (the endpoint has no date range) and only list players above a small
  possession threshold per play type; a missing row means the player rarely ran that play type.
- Defensive play types exist only for Isolation, PRBallHandler, PRRollman, Postup, Spotup, Handoff and OffScreen.
- NBA Cup knockout games are neutral-site (both rows say `@`): kept, `neutral` = 1, no home-court term.
- 2019-20 has 1059 games and 2020-21 1080; every other season 1230.
