/**
 * possessionSim.ts  —  "Realistic" possession-by-possession matchup engine.
 *
 * Simulates 75 offensive possessions per team.
 *
 * Design philosophy:
 *   - NBA BASELINE rates control WHETHER events happen (steal, block, assist, foul).
 *     These are grounded in league reality so events always fire at realistic rates.
 *   - Individual player stats are RELATIVE WEIGHTS that decide WHO gets credit.
 *   - Advanced metrics (tov_pct, usg_pct, 3par, ftr, etc.) replace the fallback
 *     derivations once the new scraper data is loaded.
 *
 * NBA baselines used:
 *   P(steal  | turnover) ≈ 0.50   (teams average ~7 stl / ~14 tov per game)
 *   P(block  | 2PA)      ≈ team blk/g ÷ 35  (~0.11 for avg team)
 *   P(assist | FGM)      ≈ 0.60   (roughly 60% of made shots are assisted)
 *   P(foul   | shot)     ≈ ftr ÷ 2.5  (converts FTA/FGA ratio to probability)
 */

import { Rng } from "./rng";
import { Position } from "./types";

// ─── Input types ─────────────────────────────────────────────────────────────

/**
 * Optional advanced stats from the scraper.
 * Percentage fields (orb_pct, stl_pct, etc.) stored as e.g. 22.5 = 22.5%.
 * Rate fields (3par, ftr) stored as 0–1 ratios.
 */
export interface SimAdvancedRaw {
  tov_pct?: number;
  usg_pct?: number;
  orb_pct?: number;
  drb_pct?: number;
  ast_pct?: number;
  stl_pct?: number;
  blk_pct?: number;
  "3par"?: number;
  ftr?: number;
}

/**
 * A player as the sim engine sees it.
 *
 * Probability fields:
 *   tovPct    – P(turnover | this player has the ball)      ~0.07–0.18
 *   threepar  – fraction of this player's FGA that are 3PA   ~0.15–0.55
 *   ftr       – FTA/FGA ratio                                ~0.15–0.60
 *   fg2Pct    – 2-point make probability                     ~0.40–0.65
 *   fg3Pct    – 3-point make probability                     ~0.25–0.45
 *   ftPct     – free throw make probability                  ~0.55–0.90
 *
 * Relative weight fields (used in weightedChoice, NOT absolute probabilities):
 *   usgWeight – possessions-used per game; higher = selected more often
 *   stlWeight – stl/g or stl_pct; determines who gets steal credit
 *   blkWeight – blk/g or blk_pct; determines who gets block credit
 *   orbWeight – orb/g or orb_pct; determines who grabs offensive rebound
 *   drbWeight – drb/g or drb_pct; determines who grabs defensive rebound
 *   astWeight – ast/g or ast_pct; determines who gets assist credit
 */
export interface SimPlayer {
  id: string;
  fullName: string;
  positions: Position[];
  teamLabel: string;
  // Per-game averages (stored for display / debugging)
  fgaPerG: number;
  fgmPerG: number;
  threepaPerG: number;
  threepmPerG: number;
  ftaPerG: number;
  ftmPerG: number;
  orbPerG: number;
  drbPerG: number;
  astPerG: number;
  stlPerG: number;
  blkPerG: number;
  tovPerG: number;
  // Probability fields
  usgWeight: number;
  tovPct: number;
  threepar: number;
  ftr: number;
  fg2Pct: number;
  fg3Pct: number;
  ftPct: number;
  // Relative weight fields
  stlWeight: number;
  blkWeight: number;
  orbWeight: number;
  drbWeight: number;
  astWeight: number;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface PlayerBoxLine {
  player: SimPlayer;
  pts: number;
  fgm: number;
  fga: number;
  fgm3: number;
  fga3: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
}

export interface TeamBoxScore {
  lines: PlayerBoxLine[];
  pts: number;
  fgm: number;
  fga: number;
  fgm3: number;
  fga3: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
}

export interface MatchupResult {
  home: TeamBoxScore;
  away: TeamBoxScore;
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * Convert any Player (real or synthetic) to the SimPlayer format.
 * Advanced stats (when present) take priority over per-game fallbacks.
 */
export function toSimPlayer(
  p: {
    id: string;
    fullName: string;
    positions: Position[];
    stats: {
      pts: number;
      fga: number;
      fgm: number;
      threepa: number;
      threes: number;
      fta: number;
      ftm: number;
      orb: number;
      drb: number;
      ast: number;
      stl: number;
      blk: number;
      tov: number;
    };
    teamLabel?: string;
  } & SimAdvancedRaw
): SimPlayer {
  const s = p.stats;

  // Safe helpers
  const g = (v: number | null | undefined, fb = 0): number =>
    v != null && isFinite(v) && !isNaN(v) ? v : fb;
  const cl = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));
  const ratio = (n: number, d: number, fb: number): number =>
    d > 0.001 ? cl(n / d, 0, 10) : fb;

  const fga     = Math.max(g(s.fga),    0.1);
  const fgm     = g(s.fgm);
  const threepa = Math.max(g(s.threepa), 0.01);
  const threepm = g(s.threes);
  const fta     = Math.max(g(s.fta),    0.01);
  const ftm     = g(s.ftm);
  const tov     = Math.max(g(s.tov),    0.01);
  const ast     = Math.max(g(s.ast),    0.1);
  const stl     = Math.max(g(s.stl),    0.1);
  const blk     = Math.max(g(s.blk),    0.1);
  const orb     = Math.max(g(s.orb),    0.1);
  const drb     = Math.max(g(s.drb),    0.1);

  const fg2pm = Math.max(fgm - threepm, 0);
  const fg2pa = Math.max(fga - threepa, 0.1);

  // Possessions used per game (usage proxy)
  const possUsed = fga + 0.44 * fta + tov;

  return {
    id:           p.id,
    fullName:     p.fullName,
    positions:    p.positions,
    teamLabel:    p.teamLabel ?? "",

    // Per-game display values
    fgaPerG:     fga,
    fgmPerG:     fgm,
    threepaPerG: threepa,
    threepmPerG: threepm,
    ftaPerG:     fta,
    ftmPerG:     ftm,
    orbPerG:     orb,
    drbPerG:     drb,
    astPerG:     ast,
    stlPerG:     stl,
    blkPerG:     blk,
    tovPerG:     tov,

    // ── Probability fields ──────────────────────────────────────────────────

    // Usage weight: raw possessions-used per game as selection weight.
    // When usg_pct is available, scale to 0.05–0.50 and multiply by a
    // normalising constant (×30) so it stays on the same scale as the fallback.
    usgWeight: p.usg_pct != null
      ? cl(p.usg_pct / 100, 0.05, 0.50) * 30
      : cl(possUsed, 2, 50),

    // P(turnover | possession) — per-possession turnover rate.
    tovPct: p.tov_pct != null
      ? cl(p.tov_pct / 100, 0.03, 0.35)
      : cl(ratio(tov, possUsed, 0.12), 0.03, 0.35),

    // Fraction of FGA that are 3-point attempts.
    threepar: p["3par"] != null
      ? cl(p["3par"], 0, 1)
      : cl(ratio(threepa, fga, 0.30), 0, 1),

    // FTA/FGA ratio — used to derive foul probability.
    ftr: p.ftr != null
      ? cl(p.ftr, 0.05, 1.50)
      : cl(ratio(fta, fga, 0.28), 0.05, 1.50),

    // Make probabilities.
    fg2Pct: cl(ratio(fg2pm, fg2pa, 0.47), 0.28, 0.70),
    fg3Pct: cl(ratio(threepm, threepa, 0.35), 0.22, 0.55),
    ftPct:  cl(ratio(ftm,  fta,  0.75), 0.45, 0.95),

    // ── Relative weight fields (larger = more likely to be chosen) ──────────
    // These are NOT per-possession probabilities. They are used as unnormalised
    // weights in weightedChoice() so the player most likely to do X gets the
    // credit when X happens. We floor them at 0.1 so no player is ever weight-0.

    // stlWeight: stl/g or stl_pct (percentage). Higher = more likely to get steal.
    stlWeight: p.stl_pct != null
      ? Math.max(p.stl_pct, 0.1)
      : Math.max(stl, 0.1),

    // blkWeight: blk/g or blk_pct. Higher = more likely to get block credit.
    blkWeight: p.blk_pct != null
      ? Math.max(p.blk_pct, 0.1)
      : Math.max(blk, 0.1),

    // orbWeight: orb/g or orb_pct. Higher = more likely to grab offensive board.
    orbWeight: p.orb_pct != null
      ? Math.max(p.orb_pct, 0.1)
      : Math.max(orb, 0.1),

    // drbWeight: drb/g or drb_pct. Higher = more likely to grab defensive board.
    drbWeight: p.drb_pct != null
      ? Math.max(p.drb_pct, 0.1)
      : Math.max(drb, 0.1),

    // astWeight: ast/g or ast_pct. Higher = more likely to get assist.
    astWeight: p.ast_pct != null
      ? Math.max(p.ast_pct, 0.1)
      : Math.max(ast, 0.1),
  };
}

// ─── Simulation core ──────────────────────────────────────────────────────────

function newBoxLine(player: SimPlayer): PlayerBoxLine {
  return {
    player,
    pts: 0, fgm: 0, fga: 0, fgm3: 0, fga3: 0,
    ftm: 0, fta: 0, orb: 0, drb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0,
  };
}

function weightedChoice<T>(rng: Rng, items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (total <= 0) return items[rng.int(0, items.length - 1)];
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= Math.max(weights[i], 0);
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function resolveRebound(
  offense: SimPlayer[],
  defense: SimPlayer[],
  offBox: PlayerBoxLine[],
  defBox: PlayerBoxLine[],
  rng: Rng
): void {
  // NBA average: offense grabs ~27% of available rebounds.
  const teamOrbTotal = offense.reduce((s, p) => s + p.orbWeight, 0);
  const teamDrbTotal = defense.reduce((s, p) => s + p.drbWeight, 0);
  const orebChance   = teamOrbTotal / (teamOrbTotal + teamDrbTotal * 2.7);

  if (rng.next() < orebChance) {
    const rebounder = weightedChoice(rng, offense, offense.map((p) => p.orbWeight));
    offBox[offense.indexOf(rebounder)].orb++;
  } else {
    const rebounder = weightedChoice(rng, defense, defense.map((p) => p.drbWeight));
    defBox[defense.indexOf(rebounder)].drb++;
  }
}

/**
 * Simulate a single offensive possession.
 * Mutates offBox and defBox with the results.
 *
 * Flow:
 *   ball handler selected (weighted by usgWeight)
 *     → turnover? (tovPct)
 *         → steal? (50% baseline, distributed by stlWeight)
 *     → shot type (threepar)
 *     → [2PA only] block? (team blkWeight / 35 baseline, distributed by blkWeight)
 *     → foul? (ftr / 2.5 → free throws)
 *     → assist? (60% baseline, distributed by astWeight → +8% make bonus)
 *     → make/miss (fg2Pct or fg3Pct)
 *         → miss → rebound (orbWeight vs drbWeight)
 */
function simulatePossession(
  offense: SimPlayer[],
  defense: SimPlayer[],
  offBox: PlayerBoxLine[],
  defBox: PlayerBoxLine[],
  rng: Rng
): void {
  // ── 1. Select ball handler weighted by usage ─────────────────────────────
  const bhIdx       = offense.indexOf(
    weightedChoice(rng, offense, offense.map((p) => p.usgWeight))
  );
  const bh    = offense[bhIdx];
  const bhBox = offBox[bhIdx];

  // ── 2. Turnover check ────────────────────────────────────────────────────
  if (rng.next() < bh.tovPct) {
    bhBox.tov++;
    // P(steal | TOV) = 0.50 (NBA baseline: ~7 stl / ~14 tov per 100 possessions).
    // WHO steals is distributed by stlWeight.
    if (rng.next() < 0.50) {
      const stealer = weightedChoice(rng, defense, defense.map((d) => d.stlWeight));
      defBox[defense.indexOf(stealer)].stl++;
    }
    return;
  }

  // ── 3. Shot type: 3-pointer or 2-pointer ─────────────────────────────────
  const isThree = rng.next() < bh.threepar;

  // ── 4. Block check (2-pointers only) ─────────────────────────────────────
  // P(block | 2PA) = team_blk_per_game / 35  (NBA avg: ~5 blk / ~35 2PA per team)
  // WHO blocks is distributed by blkWeight.
  if (!isThree) {
    const teamBlkPerG = defense.reduce((s, d) => s + d.blkWeight, 0);
    const blkProb     = Math.min(teamBlkPerG / 35.0, 0.20);
    if (rng.next() < blkProb) {
      const blocker = weightedChoice(rng, defense, defense.map((d) => d.blkWeight));
      defBox[defense.indexOf(blocker)].blk++;
      bhBox.fga++;   // blocked shots count as FGA
      resolveRebound(offense, defense, offBox, defBox, rng);
      return;
    }
  }

  // Count the field goal attempt
  bhBox.fga++;
  if (isThree) bhBox.fga3++;

  // ── 5. Shooting foul → free throws ───────────────────────────────────────
  // P(foul | shot) = ftr / 2.5  (converts FTA/FGA ratio to a per-shot probability).
  // For ftr=0.30: foulProb=0.12.  For ftr=0.60: foulProb=0.24.
  const foulProb = Math.min(bh.ftr / 2.5, 0.35);
  if (rng.next() < foulProb) {
    bhBox.fga--;              // shooting foul: attempt doesn't count as FGA
    if (isThree) bhBox.fga3--;
    const numFTs = isThree ? 3 : 2;
    bhBox.fta += numFTs;
    for (let i = 0; i < numFTs; i++) {
      if (rng.next() < bh.ftPct) {
        bhBox.ftm++;
        bhBox.pts++;
      }
    }
    return;
  }

  // ── 6. Assist check ───────────────────────────────────────────────────────
  // P(assist | FGM) = 0.60 (NBA baseline: ~60% of made shots are assisted).
  // Scaled slightly by team's assist tendency vs a neutral baseline of 25 ast/g.
  const teammates    = offense.filter((_, i) => i !== bhIdx);
  const teamAstTotal = teammates.reduce((s, p) => s + p.astWeight, 0);
  const assistMod    = Math.min(teamAstTotal / 25, 1.30);   // teams that pass more assist more
  const isAssisted   = teammates.length > 0 && rng.next() < Math.min(0.60 * assistMod, 0.85);

  // ── 7. Make check ─────────────────────────────────────────────────────────
  let makePct = isThree ? bh.fg3Pct : bh.fg2Pct;
  if (isAssisted) makePct = Math.min(makePct * 1.08, 0.78);   // +8% on assisted shots

  if (rng.next() < makePct) {
    bhBox.pts += isThree ? 3 : 2;
    bhBox.fgm++;
    if (isThree) bhBox.fgm3++;
    if (isAssisted) {
      const assister = weightedChoice(rng, teammates, teammates.map((p) => p.astWeight));
      offBox[offense.indexOf(assister)].ast++;
    }
  } else {
    resolveRebound(offense, defense, offBox, defBox, rng);
  }
}

function aggregateBox(lines: PlayerBoxLine[]): TeamBoxScore {
  const t = lines.reduce(
    (acc, l) => ({
      pts:  acc.pts  + l.pts,
      fgm:  acc.fgm  + l.fgm,
      fga:  acc.fga  + l.fga,
      fgm3: acc.fgm3 + l.fgm3,
      fga3: acc.fga3 + l.fga3,
      ftm:  acc.ftm  + l.ftm,
      fta:  acc.fta  + l.fta,
      orb:  acc.orb  + l.orb,
      drb:  acc.drb  + l.drb,
      ast:  acc.ast  + l.ast,
      stl:  acc.stl  + l.stl,
      blk:  acc.blk  + l.blk,
      tov:  acc.tov  + l.tov,
    }),
    { pts:0, fgm:0, fga:0, fgm3:0, fga3:0, ftm:0, fta:0, orb:0, drb:0, ast:0, stl:0, blk:0, tov:0 }
  );
  return { lines, ...t };
}

/**
 * Simulate a full 5v5 matchup.
 * Each team gets `possessions` (default 75) offensive turns.
 * Returns complete box scores for both sides.
 */
export function simulateMatchup(
  home: SimPlayer[],
  away: SimPlayer[],
  rng: Rng,
  possessions = 75
): MatchupResult {
  const homeBox = home.map(newBoxLine);
  const awayBox = away.map(newBoxLine);

  for (let i = 0; i < possessions; i++) {
    simulatePossession(home, away, homeBox, awayBox, rng);
  }
  for (let i = 0; i < possessions; i++) {
    simulatePossession(away, home, awayBox, homeBox, rng);
  }

  return { home: aggregateBox(homeBox), away: aggregateBox(awayBox) };
}

