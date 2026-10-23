# Network vs. the closing line

Walk-forward network (prior mode: last season's play types/stats, this season's form before the game), averaged over seeds, on the games with closing odds. Blend weight fitted on the previous test season. Betting: $1 flat, one side, only when expected value after costs > 0; Kalshi price = de-vigged line with Kalshi's fee (a stand-in, Kalshi prices were not logged); book = posted line.

| inputs | season | games | network | market | blend (w) | Kalshi-style ROI (bets) | book ROI (bets) |
|---|---|---|---|---|---|---|---|
| box+form | 2023-24 | 1223 | 0.5872 | 0.5802 | 0.5799 (0.20*) | -4.1 % [-12.4, +4.3] (1011) | -4.7 % [-13.9, +4.6] (931) |
| box+form | 2024-25 | 1218 | 0.5838 | 0.5815 | 0.5806 (0.20) | -0.6 % [-8.4, +7.9] (1007) | -0.9 % [-10.1, +8.1] (874) |
| box+form | 2025-26 | 1220 | 0.5831 | 0.5704 | 0.5722 (0.35) | -11.5 % [-18.9, -3.9] (1012) | -11.3 % [-20.2, -2.5] (930) |
| all | 2023-24 | 1223 | 0.5946 | 0.5802 | 0.5802 (0.05*) | -5.6 % [-14.2, +3.3] (1037) | -6.4 % [-15.6, +3.2] (991) |
| all | 2024-25 | 1218 | 0.5907 | 0.5815 | 0.5815 (0.05) | -1.9 % [-10.3, +6.8] (1006) | -3.6 % [-13.2, +5.7] (897) |
| all | 2025-26 | 1220 | 0.5855 | 0.5704 | 0.5705 (0.10) | -8.9 % [-16.8, -0.9] (1049) | -7.6 % [-16.8, +1.6] (969) |
| pt | 2023-24 | 1223 | 0.6205 | 0.5802 | 0.5802 (0.00*) | -4.3 % [-13.2, +4.2] (1125) | -4.9 % [-13.7, +3.5] (1099) |
| pt | 2024-25 | 1218 | 0.6248 | 0.5815 | 0.5815 (0.00) | -7.8 % [-16.1, +0.2] (1089) | -7.9 % [-15.9, +1.2] (1034) |
| pt | 2025-26 | 1220 | 0.6039 | 0.5704 | 0.5704 (0.00) | -6.0 % [-14.0, +3.1] (1108) | -5.6 % [-14.0, +3.2] (1062) |

\* first season: weight fitted on the same season (in-sample), so that blend is optimistic.

