# Play-type win-probability network: results

Walk-forward: each test season (2021-22 to 2025-26) is predicted by models trained only on the seasons before it (the season just before it is used for early stopping). Numbers are averaged over the 5 test seasons (6150 games); the network is also averaged over its seeds. Lower log loss / Brier is better. For scale: always picking the home team scores log loss ~0.687. Only as a yardstick (odds are not an input): the de-vigged closing moneyline scored 0.5802 / 0.1981 / 69.4 % on 2023-24 and 0.5817 / 0.1993 / 69.2 % on 2024-25 (sports repo, `games_with_odds`).

- **prior** uses each player's previous-season play types and stats: what is known before the game.
- **same** uses the game's own season: the stats include the game being predicted, so it leaks. It shows how strongly a profile goes with winning, not how well we can predict.

## prior: log loss / Brier / accuracy by input group

| inputs | network | logistic regression | gradient boosting |
|---|---|---|---|
| play types | 0.6313 / 0.2208 / 64.1 % | 0.6316 / 0.2209 / 64.1 % | 0.6394 / 0.2243 / 63.4 % |
| season stats | 0.6162 / 0.2140 / 65.7 % | 0.6186 / 0.2148 / 66.2 % | 0.6212 / 0.2159 / 65.7 % |
| season-to-date form | 0.6037 / 0.2085 / 67.2 % | 0.6039 / 0.2086 / 67.4 % | 0.6113 / 0.2115 / 66.5 % |
| play types + stats | 0.6223 / 0.2167 / 65.1 % | 0.6238 / 0.2172 / 65.4 % | 0.6265 / 0.2183 / 65.0 % |
| play types + form | 0.6072 / 0.2101 / 66.6 % | 0.6085 / 0.2105 / 66.5 % | 0.6137 / 0.2127 / 66.7 % |
| stats + form | 0.6009 / 0.2071 / 67.7 % | 0.6018 / 0.2075 / 67.8 % | 0.6065 / 0.2093 / 67.4 % |
| all three | 0.6071 / 0.2100 / 66.8 % | 0.6076 / 0.2100 / 67.2 % | 0.6106 / 0.2112 / 66.6 % |
| home court only | 0.6881 / 0.2475 / 55.3 % |  |  |

### prior: what adding play types changes (network, paired by test season and seed)

| change | Δ log loss (95 % CI) | test seasons where it helped |
|---|---|---|
| season stats → + play types | +0.0061 ± 0.0036 | 1 of 5 |
| season-to-date form → + play types | +0.0034 ± 0.0025 | 2 of 5 |
| stats + form → + play types | +0.0063 ± 0.0014 | 0 of 5 |

Negative = play types made predictions better.

## same: log loss / Brier / accuracy by input group

| inputs | network | logistic regression | gradient boosting |
|---|---|---|---|
| play types | 0.6012 / 0.2073 / 67.6 % | 0.6021 / 0.2077 / 67.5 % | 0.6145 / 0.2128 / 66.7 % |
| season stats | 0.5718 / 0.1950 / 70.1 % | 0.5738 / 0.1957 / 70.0 % | 0.5789 / 0.1974 / 69.5 % |
| season-to-date form | 0.6038 / 0.2086 / 67.2 % | 0.6039 / 0.2087 / 67.1 % | 0.6120 / 0.2119 / 66.9 % |
| play types + stats | 0.5737 / 0.1956 / 69.7 % | 0.5760 / 0.1966 / 69.5 % | 0.5791 / 0.1975 / 69.8 % |
| play types + form | 0.5931 / 0.2038 / 68.3 % | 0.5930 / 0.2037 / 68.1 % | 0.6039 / 0.2082 / 67.0 % |
| stats + form | 0.5658 / 0.1923 / 70.4 % | 0.5699 / 0.1935 / 70.7 % | 0.5769 / 0.1966 / 69.6 % |
| all three | 0.5678 / 0.1930 / 70.4 % | 0.5707 / 0.1943 / 70.2 % | 0.5765 / 0.1965 / 70.0 % |
| home court only | 0.6883 / 0.2476 / 55.3 % |  |  |

### same: what adding play types changes (network, paired by test season and seed)

| change | Δ log loss (95 % CI) | test seasons where it helped |
|---|---|---|
| season stats → + play types | +0.0019 ± 0.0013 | 1 of 5 |
| season-to-date form → + play types | -0.0107 ± 0.0022 | 5 of 5 |
| stats + form → + play types | +0.0020 ± 0.0017 | 2 of 5 |

Negative = play types made predictions better.

## Per test season (prior, network)

| test season | play types only | stats + form | all three |
|---|---|---|---|
| 2021-22 | 0.6489 / 62.5 % | 0.6187 / 66.2 % | 0.6238 / 65.4 % |
| 2022-23 | 0.6509 / 61.8 % | 0.6285 / 65.3 % | 0.6368 / 63.9 % |
| 2023-24 | 0.6220 / 65.1 % | 0.5884 / 69.2 % | 0.5964 / 68.1 % |
| 2024-25 | 0.6276 / 64.6 % | 0.5845 / 68.5 % | 0.5913 / 68.2 % |
| 2025-26 | 0.6073 / 66.3 % | 0.5842 / 69.3 % | 0.5874 / 68.2 % |

## What the network relies on: prior, inputs = play types

Permutation importance: how much the test log loss gets worse when one family of inputs is shuffled across players (averaged over test seasons). Bigger = more relied on; ~0 or negative = not used.

| play type (offensive/defensive) | Δ log loss |
|---|---|
| offensive PRBallHandler | +0.0044 |
| defensive PRBallHandler | +0.0030 |
| offensive Postup | +0.0027 |
| defensive Postup | +0.0017 |
| defensive Isolation | +0.0016 |
| offensive Spotup | +0.0016 |
| offensive Cut | +0.0014 |
| defensive Spotup | +0.0010 |
| offensive Handoff | +0.0010 |
| offensive Transition | +0.0009 |
| defensive PRRollMan | +0.0009 |
| offensive OffScreen | +0.0008 |
| offensive Isolation | +0.0007 |
| offensive OffRebound | +0.0005 |
| defensive OffScreen | +0.0005 |
| defensive Handoff | +0.0001 |
| offensive Misc | +0.0000 |
| offensive PRRollMan | -0.0005 |

| play-type metric (all play types) | Δ log loss |
|---|---|
| vol | +0.0156 |
| ppp | +0.0027 |
| ft | +0.0024 |
| share | +0.0020 |
| efg | +0.0014 |
| score | +0.0012 |
| tov | +0.0005 |

## What the network relies on: prior, inputs = all three

Permutation importance: how much the test log loss gets worse when one family of inputs is shuffled across players (averaged over test seasons). Bigger = more relied on; ~0 or negative = not used.

| input group | Δ log loss |
|---|---|
| team form (all) | +0.0185 |
| season stats (all) | +0.0167 |
| season-to-date player form (all) | +0.0097 |
| play types (all) | +0.0036 |

| play type (offensive/defensive) | Δ log loss |
|---|---|
| offensive PRBallHandler | +0.0006 |
| defensive PRBallHandler | +0.0005 |
| offensive Postup | +0.0005 |
| defensive Isolation | +0.0002 |
| defensive Postup | +0.0002 |
| offensive Transition | +0.0002 |
| defensive Spotup | +0.0001 |
| defensive OffScreen | +0.0001 |
| offensive Cut | +0.0001 |
| defensive PRRollMan | -0.0000 |
| offensive PRRollMan | -0.0001 |
| offensive Spotup | -0.0001 |
| offensive Misc | -0.0001 |
| offensive Isolation | -0.0001 |
| offensive OffRebound | -0.0001 |
| offensive OffScreen | -0.0003 |
| defensive Handoff | -0.0003 |
| offensive Handoff | -0.0004 |

| play-type metric (all play types) | Δ log loss |
|---|---|
| vol | +0.0015 |
| share | +0.0006 |
| score | +0.0004 |
| ft | -0.0001 |
| efg | -0.0004 |
| ppp | -0.0004 |
| tov | -0.0005 |

## What the network relies on: same, inputs = play types

Permutation importance: how much the test log loss gets worse when one family of inputs is shuffled across players (averaged over test seasons). Bigger = more relied on; ~0 or negative = not used.

| play type (offensive/defensive) | Δ log loss |
|---|---|
| defensive Spotup | +0.0103 |
| offensive Spotup | +0.0084 |
| offensive Misc | +0.0077 |
| defensive PRBallHandler | +0.0068 |
| defensive PRRollMan | +0.0059 |
| offensive PRBallHandler | +0.0047 |
| defensive Isolation | +0.0045 |
| offensive Cut | +0.0035 |
| defensive Postup | +0.0032 |
| offensive Transition | +0.0029 |
| offensive Isolation | +0.0022 |
| defensive OffScreen | +0.0018 |
| offensive Postup | +0.0017 |
| offensive OffRebound | +0.0015 |
| defensive Handoff | +0.0012 |
| offensive PRRollMan | +0.0006 |
| offensive OffScreen | +0.0006 |
| offensive Handoff | -0.0004 |

| play-type metric (all play types) | Δ log loss |
|---|---|
| vol | +0.0181 |
| ppp | +0.0132 |
| efg | +0.0105 |
| share | +0.0060 |
| score | +0.0050 |
| ft | +0.0048 |
| tov | +0.0019 |

## What the network relies on: same, inputs = all three

Permutation importance: how much the test log loss gets worse when one family of inputs is shuffled across players (averaged over test seasons). Bigger = more relied on; ~0 or negative = not used.

| input group | Δ log loss |
|---|---|
| season stats (all) | +0.2721 |
| play types (all) | +0.0109 |
| season-to-date player form (all) | +0.0108 |
| team form (all) | +0.0081 |

| play type (offensive/defensive) | Δ log loss |
|---|---|
| offensive Cut | +0.0020 |
| offensive Isolation | +0.0016 |
| offensive Misc | +0.0014 |
| defensive Spotup | +0.0011 |
| defensive PRBallHandler | +0.0010 |
| offensive PRBallHandler | +0.0010 |
| offensive Spotup | +0.0006 |
| offensive OffRebound | +0.0004 |
| defensive Handoff | +0.0003 |
| defensive Isolation | +0.0003 |
| offensive Handoff | +0.0002 |
| offensive Transition | +0.0002 |
| offensive OffScreen | +0.0002 |
| defensive OffScreen | +0.0002 |
| defensive PRRollMan | +0.0001 |
| offensive PRRollMan | +0.0000 |
| offensive Postup | -0.0000 |
| defensive Postup | -0.0005 |

| play-type metric (all play types) | Δ log loss |
|---|---|
| vol | +0.0024 |
| ft | +0.0016 |
| share | +0.0016 |
| efg | +0.0011 |
| ppp | +0.0006 |
| score | +0.0004 |
| tov | -0.0005 |

## Team-season correlations with win % (same season)

330 team-seasons. Each team's play-type numbers are the minutes-weighted average of the players it put on the floor, z-scored within each season; r is the correlation with that season's win %. vol = possessions per 36 min of that play type, ppp = points per possession (defensive ppp = points allowed, so negative r is good defense). The 20 strongest:

| feature | r |
|---|---|
| offensive Spotup ppp | +0.60 |
| offensive PRBallHandler ppp | +0.50 |
| defensive Spotup ppp | -0.47 |
| offensive Transition ppp | +0.42 |
| defensive Postup ppp | -0.42 |
| defensive PRBallHandler ppp | -0.41 |
| offensive Isolation ppp | +0.35 |
| offensive Misc ppp | +0.33 |
| offensive PRBallHandler vol | -0.33 |
| defensive OffScreen ppp | -0.33 |
| offensive Cut ppp | +0.31 |
| defensive Isolation ppp | -0.31 |
| offensive OffScreen ppp | +0.30 |
| offensive Postup ppp | +0.28 |
| offensive Handoff ppp | +0.28 |
| defensive Handoff ppp | -0.26 |
| defensive PRRollMan vol | +0.24 |
| defensive Isolation vol | +0.23 |
| defensive Handoff vol | +0.23 |
| offensive Postup vol | +0.22 |

## Team-season correlations with win % (previous season's players)

300 team-seasons. Each team's play-type numbers are the minutes-weighted average of the players it put on the floor, z-scored within each season; r is the correlation with that season's win %. vol = possessions per 36 min of that play type, ppp = points per possession (defensive ppp = points allowed, so negative r is good defense). The 20 strongest:

| feature | r |
|---|---|
| offensive Spotup ppp | +0.45 |
| offensive PRBallHandler ppp | +0.38 |
| offensive Postup vol | +0.32 |
| defensive Isolation vol | +0.31 |
| offensive Isolation vol | +0.31 |
| offensive Misc vol | +0.31 |
| defensive Handoff vol | +0.30 |
| defensive Postup ppp | -0.30 |
| offensive Transition vol | +0.30 |
| offensive Isolation ppp | +0.29 |
| offensive OffScreen vol | +0.26 |
| offensive Misc ppp | +0.26 |
| offensive Postup ppp | +0.25 |
| offensive Transition ppp | +0.25 |
| defensive PRBallHandler vol | +0.25 |
| offensive OffScreen ppp | +0.25 |
| defensive Isolation ppp | -0.24 |
| defensive Spotup ppp | -0.23 |
| offensive Handoff ppp | +0.23 |
| defensive PRRollMan vol | +0.22 |

