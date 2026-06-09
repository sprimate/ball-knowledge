/**
 * possessionSim.ts  —  Possession-by-possession matchup engine.
 *
 * Weighted list entries per positional pair (Oi vs Di):
 *   Di.p100_blk        -> BLOCK    (Di blk; random Oi FGA, no rebound)
 *   Di.p100_stl / 2    -> STEAL    (Di stl; Oi tov)
 *   Oi.p100_tov / 2    -> TOV      (Oi tov; Di stl)
 *   Oi.p100_2pa        -> ATTEMPT2
 *   Oi.p100_3pa        -> ATTEMPT3
 *   Di.p100_pf / 2.5   -> FOUL     (Di pf; Oi 2 FTs)
 *
 * FG flow (ATTEMPT2):
 *   1. rng < ftr/2 -> shooting foul -> 2 FTs (no FGA)
 *   2. Assist: shuffle teammates, stop at first ast_pct/100 hit -> +8% make
 *   3. Roll p100_2pm/p100_2pa -> 2 pts or REBOUND
 *
 * FG flow (ATTEMPT3):
 *   1. No foul check
 *   2. Same assist check
 *   3. Roll p100_3pm/p100_3pa -> 3 pts or REBOUND
 *
 * Rebound: drb_pct (def) vs orb_pct (off). ORB -> bonus possession (cap 33%).
 */

import { Rng } from "./rng";
import type { Per100Stats } from "./nbaLoader";
import { Position } from "./types";

// --- SimPlayer ---------------------------------------------------------------

export interface SimPlayer {
  id: string;
  fullName: string;
  positions: Position[];
  teamLabel: string;
  p100_fgm: number;
  p100_fga: number;
  p100_2pm: number;
  p100_2pa: number;
  p100_3pm: number;
  p100_3pa: number;
  p100_ftm: number;
  p100_fta: number;
  p100_orb: number;
  p100_drb: number;
  p100_ast: number;
  p100_stl: number;
  p100_blk: number;
  p100_tov: number;
  p100_pf:  number;
  orb_pct:  number;
  drb_pct:  number;
  ast_pct:  number;
  ftr:      number;
}

// --- Output types ------------------------------------------------------------

export interface PlayerBoxLine {
  player: SimPlayer;
  pts:  number; fgm:  number; fga:  number;
  fgm3: number; fga3: number;
  ftm:  number; fta:  number;
  orb:  number; drb:  number;
  ast:  number; stl:  number; blk:  number;
  tov:  number; pf:   number;
}

export interface TeamBoxScore {
  lines: PlayerBoxLine[];
  pts:  number; fgm:  number; fga:  number;
  fgm3: number; fga3: number;
  ftm:  number; fta:  number;
  orb:  number; drb:  number;
  ast:  number; stl:  number; blk:  number;
  tov:  number; pf:   number;
}

export interface MatchupResult {
  home: TeamBoxScore;
  away: TeamBoxScore;
}

// --- Conversion --------------------------------------------------------------

export function toSimPlayer(
  p: {
    id: string;
    fullName: string;
    positions: Position[];
    teamLabel?: string;
    per100?: Per100Stats;
    stats?: {
      fga?: number; fgm?: number;
      threepa?: number; threes?: number;
      fta?: number; ftm?: number;
      orb?: number; drb?: number;
      ast?: number; stl?: number;
      blk?: number; tov?: number;
    };
    orb_pct?: number;
    drb_pct?: number;
    ast_pct?: number;
    ftr?: number;
  }
): SimPlayer {
  const safe = (v: number | null | undefined, fb = 0): number =>
    (v != null && isFinite(v as number)) ? (v as number) : fb;

  const h   = p.per100;
  const s   = p.stats ?? {};
  const sc  = 4;

  const fga   = safe(h?.fga,     safe(s.fga)    * sc);
  const fgm   = safe(h?.fgm,     safe(s.fgm)    * sc);
  const thrpa = safe(h?.threepa, safe(s.threepa) * sc);
  const thrpm = safe(h?.threes,  safe(s.threes)  * sc);
  const twoa  = safe(h?.twoa,    Math.max(fga - thrpa, 0));
  const twom  = safe(h?.twom,    Math.max(fgm - thrpm, 0));
  const fta   = safe(h?.fta,     safe(s.fta)    * sc);
  const ftm   = safe(h?.ftm,     safe(s.ftm)    * sc);
  const orb   = safe(h?.orb,     safe(s.orb)    * sc);
  const drb   = safe(h?.drb,     safe(s.drb)    * sc);
  const ast   = safe(h?.ast,     safe(s.ast)    * sc);
  const stl   = safe(h?.stl,     safe(s.stl)    * sc);
  const blk   = safe(h?.blk,     safe(s.blk)    * sc);
  const tov   = safe(h?.tov,     safe(s.tov)    * sc);
  const pf    = safe(h?.pf,      8.0);

  return {
    id: p.id, fullName: p.fullName, positions: p.positions, teamLabel: p.teamLabel ?? "",
    p100_fgm: fgm,  p100_fga: fga,
    p100_2pm: twom, p100_2pa: twoa,
    p100_3pm: thrpm, p100_3pa: thrpa,
    p100_ftm: ftm,  p100_fta: fta,
    p100_orb: orb,  p100_drb: drb,
    p100_ast: ast,  p100_stl: stl,
    p100_blk: blk,  p100_tov: tov,
    p100_pf:  pf,
    orb_pct: safe(p.orb_pct, orb > 0 ? (orb / (orb + drb + 0.1)) * 15 : 5),
    drb_pct: safe(p.drb_pct, drb > 0 ? (drb / (orb + drb + 0.1)) * 20 : 10),
    ast_pct: safe(p.ast_pct, ast > 0 ? ast / 4 : 5),
    ftr:     safe(p.ftr,     fga > 0 ? fta / fga : 0.25),
  };
}

// --- Internals ---------------------------------------------------------------

function newBoxLine(player: SimPlayer): PlayerBoxLine {
  return { player, pts:0, fgm:0, fga:0, fgm3:0, fga3:0, ftm:0, fta:0, orb:0, drb:0, ast:0, stl:0, blk:0, tov:0, pf:0 };
}

function weightedRoll(rng: Rng, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return rng.int(0, weights.length - 1);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

type OutcomeKind = "block" | "steal" | "tov" | "attempt2" | "attempt3" | "foul";

interface WeightedEntry {
  weight: number; kind: OutcomeKind; offIdx: number; defIdx: number;
}

function simulatePossession(
  offense: SimPlayer[], defense: SimPlayer[],
  offBox: PlayerBoxLine[], defBox: PlayerBoxLine[],
  rng: Rng
): boolean {
  const n = Math.min(offense.length, defense.length);
  const entries: WeightedEntry[] = [];

  for (let i = 0; i < n; i++) {
    const o = offense[i], d = defense[i];
    entries.push({ weight: d.p100_blk,      kind: "block",    offIdx: i, defIdx: i });
    entries.push({ weight: d.p100_stl / 2,  kind: "steal",    offIdx: i, defIdx: i });
    entries.push({ weight: o.p100_tov / 2,  kind: "tov",      offIdx: i, defIdx: i });
    entries.push({ weight: o.p100_2pa,       kind: "attempt2", offIdx: i, defIdx: i });
    entries.push({ weight: o.p100_3pa,       kind: "attempt3", offIdx: i, defIdx: i });
    entries.push({ weight: d.p100_pf / 2.5, kind: "foul",     offIdx: i, defIdx: i });
  }

  const { kind, offIdx, defIdx } = entries[weightedRoll(rng, entries.map((e) => e.weight))];
  const ob = offBox[offIdx], db = defBox[defIdx], o = offense[offIdx];

  if (kind === "block") {
    db.blk++;
    offBox[rng.int(0, offense.length - 1)].fga++;
    return false;
  }

  if (kind === "steal" || kind === "tov") {
    ob.tov++; db.stl++;
    return false;
  }

  if (kind === "foul") {
    db.pf++;
    const ftPct = o.p100_fta > 0 ? o.p100_ftm / o.p100_fta : 0.75;
    ob.fta += 2;
    for (let i = 0; i < 2; i++) if (rng.next() < ftPct) { ob.ftm++; ob.pts++; }
    return false;
  }

  const isThree = kind === "attempt3";

  if (!isThree && rng.next() < o.ftr / 2) {
    db.pf++;
    ob.fta += 2;
    const ftPct = o.p100_fta > 0 ? o.p100_ftm / o.p100_fta : 0.75;
    for (let i = 0; i < 2; i++) if (rng.next() < ftPct) { ob.ftm++; ob.pts++; }
    return false;
  }

  ob.fga++;
  if (isThree) ob.fga3++;

  const teammates = rng.shuffle(offense.map((p, idx) => ({ p, idx })).filter(({ idx }) => idx !== offIdx));
  let assisted = false, assistIdx = -1;
  for (const { p, idx } of teammates) {
    if (rng.next() < (p.ast_pct * 1.4) / 100) { assisted = true; assistIdx = idx; break; }
  }

  const basePct = isThree
    ? (o.p100_3pa > 0 ? o.p100_3pm / o.p100_3pa : 0.35)
    : (o.p100_2pa > 0 ? o.p100_2pm / o.p100_2pa : 0.47);
  const makePct = assisted ? basePct + 0.08 : basePct;

  if (rng.next() < makePct) {
    ob.fgm++; ob.pts += isThree ? 3 : 2;
    if (isThree) ob.fgm3++;
    if (assisted) offBox[assistIdx].ast++;
    return false;
  }

  return resolveRebound(offense, defense, offBox, defBox, rng);
}

function resolveRebound(
  offense: SimPlayer[], defense: SimPlayer[],
  offBox: PlayerBoxLine[], defBox: PlayerBoxLine[],
  rng: Rng
): boolean {
  const weights = [...defense.map((d) => d.drb_pct), ...offense.map((o) => o.orb_pct)];
  const idx = weightedRoll(rng, weights);
  if (idx < defense.length) { defBox[idx].drb++; return false; }
  offBox[idx - defense.length].orb++;
  return true;
}

function runPossessions(
  offense: SimPlayer[], defense: SimPlayer[],
  offBox: PlayerBoxLine[], defBox: PlayerBoxLine[],
  basePossessions: number, rng: Rng
): void {
  const maxBonus = Math.floor(basePossessions * 0.33);
  let orbQueue = 0, bonusUsed = 0;

  for (let i = 0; i < basePossessions; i++) {
    if (simulatePossession(offense, defense, offBox, defBox, rng)) orbQueue++;
  }

  while (orbQueue > 0 && bonusUsed < maxBonus) {
    if (simulatePossession(offense, defense, offBox, defBox, rng)) orbQueue++;
    orbQueue--;
    bonusUsed++;
  }
}

function aggregateBox(lines: PlayerBoxLine[]): TeamBoxScore {
  const z = { pts:0, fgm:0, fga:0, fgm3:0, fga3:0, ftm:0, fta:0, orb:0, drb:0, ast:0, stl:0, blk:0, tov:0, pf:0 };
  const t = lines.reduce((acc, l) => ({
    pts: acc.pts+l.pts, fgm: acc.fgm+l.fgm, fga: acc.fga+l.fga,
    fgm3: acc.fgm3+l.fgm3, fga3: acc.fga3+l.fga3,
    ftm: acc.ftm+l.ftm, fta: acc.fta+l.fta,
    orb: acc.orb+l.orb, drb: acc.drb+l.drb,
    ast: acc.ast+l.ast, stl: acc.stl+l.stl, blk: acc.blk+l.blk,
    tov: acc.tov+l.tov, pf: acc.pf+l.pf,
  }), z);
  return { lines, ...t };
}

// --- Public API --------------------------------------------------------------

export function simulateMatchup(
  home: SimPlayer[], away: SimPlayer[],
  rng: Rng, possessions = 75
): MatchupResult {
  const homeBox = home.map(newBoxLine);
  const awayBox = away.map(newBoxLine);
  runPossessions(home, away, homeBox, awayBox, possessions, rng);
  runPossessions(away, home, awayBox, homeBox, possessions, rng);
  return { home: aggregateBox(homeBox), away: aggregateBox(awayBox) };
}
