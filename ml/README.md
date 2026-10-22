# Win-probability network: data

Goal (card https://conductor.sprimate.com/cards/1890807339649336853): train a neural network that gives P(team A beats
team B) from both rosters' Synergy play-type data plus their non-play-type stats. No odds. Plan:
https://conductor.sprimate.com/docs/p/W8ssmUxozp

- `fetch_data.py`: downloads every regular season from 2015-16 (the first season with Synergy data) to 2025-26 from
  stats.nba.com into `data/<season>/` (gzipped CSV, resumable). See its docstring for the files and the Docker command.
- `check_data.py`: games per season (1230; 1059 for 2019-20 and 1080 for 2020-21), two team rows per game, player
  minutes per game, and play types present. Standard library only.

Things to know before training:
- Synergy play types are **season totals** (the endpoint has no date range) and only list players above a small
  possession threshold per play type; a missing row means the player rarely ran that play type. Using a season's
  play types to predict games of the same season leaks; use the previous season's for honest predictions.
- Defensive play types exist only for Isolation, PRBallHandler, PRRollman, Postup, Spotup, Handoff and OffScreen.
- `player_games` rows give who played and for how long (the weights for a roster); `team_games` gives home/away
  (`MATCHUP` contains `vs.` for home, `@` for away), `WL` and points.
- Join on `PLAYER_ID`/`TEAM_ID` (NBA ids) across all files. A traded player has one play-type row per team.
