/**
 * nbaLoader.ts
 *
 * Loads public/data/nba-teams.json (scraped from Basketball-Reference),
 * assigns tiers by win-percentage percentile, and exposes two functions that
 * replace the synthetic buildTierPool / pickCpuTeams from data.ts.
 *
 * Tier mapping (matches LEAGUES in data.ts):
 *   4 = NBA        (top    20 % by win pct)
 *   3 = G League   (61–80 %)
 *   2 = College    (41–60 %)
 *   1 = Varsity    (21–40 %)
 *   0 = JV         (bottom 20 %)
 */

import { Rng } from "./rng";
import { fantasyScore, gameScore, ovrToCost } from "./data";
import { Player, Position, Roster, Stats, Team } from "./types";

// ---------------------------------------------------------------------------
// Raw JSON shape (what the scraper writes)
// ---------------------------------------------------------------------------

export type NBAPlayerRaw = {
  name: string;
  positions: string[];
  gp: number;
  gs: number;
  mp: number;     // total minutes
  pts: number;
  fgm: number;
  fga: number;
  "3pm": number;
  "3pa": number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  // ── New fields from updated scraper ──────────────────────────────────────
  bbref_id?: string;       // e.g. "bryanko01" — stable cross-season identity
  age?: number;
  team?: string;           // "CHI", "LAL", or "TOT" (aggregate for traded player)
  is_trade_row?: boolean;  // true = individual team stint; false/absent = full season
  // Advanced metrics (% fields stored as e.g. 22.5 = 22.5%; rate fields 0-1)
  tov_pct?: number;
  usg_pct?: number;
  orb_pct?: number;
  drb_pct?: number;
  ast_pct?: number;
  stl_pct?: number;
  blk_pct?: number;
  "3par"?: number;   // 3PA/FGA ratio (0-1)
  ftr?: number;      // FTA/FGA ratio (0-1)
};

export type NBATeamRaw = {
  year: number;
  season: string;
  wins: number;
  losses: number;
  players: NBAPlayerRaw[];
};

// ---------------------------------------------------------------------------
// Derived / indexed types used at runtime
// ---------------------------------------------------------------------------

/** A player converted to per-game stats, with tier and ratings attached. */
export type RealPlayer = Player & {
  teamKey: string;   // e.g. "1997 Chicago Bulls"
  gp: number;
  gs: number;
  mpg: number;       // minutes per game (for opponent lineup selection)
  // Identity & age (present once new scraper data is loaded)
  bbrefId?: string;
  age?: number;
  teamCode?: string; // e.g. "CHI", "TOT"
  // Advanced metrics, normalised to 0-1 (% fields divided by 100)
  tov_pct?: number;
  usg_pct?: number;
  orb_pct?: number;
  drb_pct?: number;
  ast_pct?: number;
  stl_pct?: number;
  blk_pct?: number;
  "3par"?: number;
  ftr?: number;
};

/** A fully-resolved team with tier, record, and RealPlayer roster. */
export type RealTeam = {
  key: string;           // "1997 Chicago Bulls"
  displayName: string;
  year: number;
  season: string;
  wins: number;
  losses: number;
  winPct: number;
  tier: number;
  players: RealPlayer[];
  /** Raw tiebreaker score for tier assignment (avg pts of top-5). */
  teamScore: number;
  /** Normalised team quality: 55–99, scaled globally by win% (team vs team). */
  teamOvr: number;
};

// ---------------------------------------------------------------------------
// Module-level cache — populated once by loadNBAData()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// City/franchise → abbreviation lookup
// ---------------------------------------------------------------------------

const FRANCHISE_ABBR: Record<string, string> = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "New Jersey Nets": "NJN",
  "Charlotte Hornets": "CHA",
  "Charlotte Bobcats": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "San Diego Clippers": "SDC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Vancouver Grizzlies": "VAN",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New Orleans Hornets": "NOH",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Seattle SuperSonics": "SEA",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHO",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "Kansas City Kings": "KCK",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
  "Washington Bullets": "WSB",
};

/**
 * Returns the 3-letter city abbreviation for a team key like "1997 Chicago Bulls".
 * Falls back to the first word of the franchise name if not found.
 */
export function teamAbbr(teamKey: string): string {
  const franchise = franchiseOf(teamKey);
  return FRANCHISE_ABBR[franchise] ?? franchise.split(" ")[0].slice(0, 3).toUpperCase();
}

let _teams: RealTeam[] | null = null;

/**
 * playersByTierAndPos[tier][pos] = RealPlayer[]  sorted by normalizedRating desc
 * Only players with gp >= MIN_DRAFT_GAMES qualify.
 */
const playersByTierAndPos: Map<number, Map<Position, RealPlayer[]>> = new Map();

/**
 * Global draft pool indexed by position → cost → players.
 * Populated from ALL teams / ALL tiers so every eligible season is reachable.
 */
const draftPoolByPosCost: Map<Position, Map<number, RealPlayer[]>> = new Map();

/** teamsByTier[tier] = RealTeam[]  shuffled on each use */
const teamsByTier: Map<number, RealTeam[]> = new Map();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const MIN_DRAFT_GAMES = 42;   // minimum GP to be eligible for drafts

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Call once at application start. Resolves when data is ready. */
export async function loadNBAData(): Promise<void> {
  if (_teams) return;   // already loaded

  const res = await fetch("./data/nba-teams.json");
  if (!res.ok) throw new Error(`Failed to load nba-teams.json: ${res.status}`);
  const raw: Record<string, NBATeamRaw> = await res.json();

  // 1. Convert raw → RealTeam (stats still totals, ratings TBD)
  const teams = Object.entries(raw).map(([key, data]) =>
    buildRealTeam(key, data)
  );

  // 2. Assign tiers by win-percentage percentile
  assignTiers(teams);

  // 3. Compute per-game stats and game scores for every player.
  //    p.fantasyScore now holds the Game Score value (used for OVR/cost).
  for (const team of teams) {
    for (const p of team.players) {
      p.fantasyScore = gameScore(p.stats);
    }
  }

  // 4. Normalise ratings globally per tier (so scores are comparable within tier)
  normaliseRatingsAndCosts(teams);

  // 5. Compute team score = mean of starter game scores
  for (const team of teams) {
    const starters = pickStartingFive(team);
    team.teamScore = starters.reduce((s, p) => s + p.fantasyScore, 0) / starters.length;
  }

  _teams = teams;

  // 6. Build lookup indexes
  buildIndexes(teams);
}

/** True once loadNBAData() has resolved successfully. */
export function isNBADataLoaded(): boolean {
  return _teams !== null;
}

/**
 * Return every player from every team across all tiers, with a `_tier`
 * property attached for filtering. Used by the Data inspector view.
 */
export function getAllDataPlayers(): (RealPlayer & { _tier: number })[] {
  if (!_teams) return [];
  return _teams.flatMap((team) =>
    team.players.map((p) => ({ ...p, _tier: team.tier }))
  );
}

/**
 * Find the same player (by bbrefId) in the immediately following season.
 * Returns undefined if not found or if bbrefId is missing.
 * The returned player keeps the original cost so Age Up is budget-neutral.
 */
export function getNextSeasonPlayer(player: RealPlayer, lockedCost: number): RealPlayer | undefined {
  if (!_teams || !player.bbrefId) return undefined;
  const targetYear = player.seasonYear + 1;
  for (const team of _teams) {
    for (const p of team.players) {
      if (p.bbrefId === player.bbrefId && p.seasonYear === targetYear) {
        return { ...p, cost: lockedCost };
      }
    }
  }
  return undefined;
}

/**
 * Build a draft pool of exactly 25 players (1 per tier × 5 positions).
 * Mirrors the contract of buildTierPool() in data.ts.
 * Initial draft: 1 player per position/cost bucket.
 * Free-agency draft: 2 players per position/cost bucket (caller picks how many to show).
 */
export function buildRealTierPool(_tier: number, rng: Rng, _perBucket = 1): Player[] {
  assertLoaded();

  const pool: Player[] = [];

  // Pick exactly 1 random player per (position × cost) cell from the GLOBAL
  // draft pool. The rng is forked per-season in main.ts so a different player
  // is drawn every season without repeats.
  for (const pos of POSITIONS) {
    const costMap = draftPoolByPosCost.get(pos);
    if (!costMap) continue;

    for (let cost = 1; cost <= 5; cost++) {
      const bucket = costMap.get(cost);
      if (!bucket || bucket.length === 0) continue;
      pool.push(rng.choice(bucket));
    }
  }

  return pool;
}

/**
 * Pick `count` unique CPU teams from the given tier.
 * No franchise is repeated (same "franchise" key only once per call).
 * Each team gets a 5-player Roster by simulating the first 82 games of
 * their historical season using the MPG-sorted lineup logic.
 */
export function pickRealCpuTeams(tier: number, count: number, rng: Rng): Team[] {
  assertLoaded();
  const candidates = rng.shuffle([...(teamsByTier.get(tier) ?? [])]);
  const usedFranchise = new Set<string>();
  const result: Team[] = [];

  for (const realTeam of candidates) {
    const franchise = franchiseOf(realTeam.key);
    if (usedFranchise.has(franchise)) continue;
    usedFranchise.add(franchise);

    result.push({
      id: realTeam.key,
      name: realTeam.displayName,
      isUser: false,
      roster: buildSimRoster(realTeam, rng),
    });

    if (result.length >= count) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertLoaded(): void {
  if (!_teams) throw new Error("NBA data not loaded. Call loadNBAData() first.");
}

/** Derive franchise name from key "1997 Chicago Bulls" → "Chicago Bulls" */
function franchiseOf(key: string): string {
  return key.replace(/^\d{4}\s+/, "");
}

function buildRealTeam(key: string, raw: NBATeamRaw): RealTeam {
  const totalGames = raw.wins + raw.losses;
  const winPct = totalGames > 0 ? raw.wins / totalGames : 0;

  const players: RealPlayer[] = raw.players
    // Exclude per-team stint rows for traded players (is_trade_row = true).
    // Keep only the season-aggregate row (is_trade_row absent/false).
    // Old data predating the new scraper has no is_trade_row field and passes through unchanged.
    .filter((p) => p.gp > 0 && p.name !== "Team Totals" && p.is_trade_row !== true)
    .map((p, i) => {
      const gp = p.gp;
      const pgStats: Stats = {
        pts:     r(p.pts    / gp),
        threes:  r(p["3pm"] / gp),
        threepa: r(p["3pa"] / gp),
        fga:     r(p.fga    / gp),
        fgm:     r(p.fgm    / gp),
        fta:     r(p.fta    / gp),
        ftm:     r(p.ftm    / gp),
        orb:     r(p.orb    / gp),
        drb:     r(p.drb    / gp),
        reb:     r(p.reb    / gp),
        ast:     r(p.ast    / gp),
        stl:     r(p.stl    / gp),
        blk:     r(p.blk    / gp),
        tov:     r(p.tov    / gp),
      };

      const primaryPos = (p.positions[0] ?? "SF") as Position;
      const positions = p.positions
        .map((s) => normalisePos(s))
        .filter((pos): pos is Position => pos !== null);
      const resolvedPositions: Position[] = positions.length > 0 ? positions : [primaryPos];

      return {
        id: `${key}-${i}-${p.name.replace(/\s+/g, "-").toLowerCase()}`,
        fullName: p.name,
        seasonYear: raw.year,
        positions: resolvedPositions,
        stats: pgStats,
        fantasyScore: 0,       // filled in after
        normalizedRating: 60,  // filled in after
        cost: 3,               // filled in after
        teamKey: key,
        gp,
        gs: p.gs,
        mpg: r(p.mp / gp),
        // Identity
        bbrefId:  p.bbref_id,
        age:      p.age,
        teamCode: p.team ?? undefined,
        // Advanced metrics (passed through; % fields stay as-is for possessionSim.toSimPlayer)
        tov_pct:  p.tov_pct,
        usg_pct:  p.usg_pct,
        orb_pct:  p.orb_pct,
        drb_pct:  p.drb_pct,
        ast_pct:  p.ast_pct,
        stl_pct:  p.stl_pct,
        blk_pct:  p.blk_pct,
        "3par":   p["3par"],
        ftr:      p.ftr,
      } as RealPlayer;
    });

  return {
    key,
    displayName: key,
    year: raw.year,
    season: raw.season,
    wins: raw.wins,
    losses: raw.losses,
    winPct,
    tier: -1,        // assigned later
    players,
    teamScore: 0,    // tiebreaker, set in assignTiers
    teamOvr: 0,      // set in normaliseRatingsAndCosts
  };
}

function r(v: number): number {
  return Math.round(v * 10) / 10;
}

function normalisePos(raw: string): Position | null {
  const map: Record<string, Position> = {
    PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C",
    G: "PG", F: "SF", "G-F": "SG", "F-G": "SF", "F-C": "PF", "C-F": "C",
  };
  return map[raw.toUpperCase()] ?? null;
}

/**
 * Assign tier 0–4 based on win-pct percentile ranks.
 * Ties broken by teamScore (computed later via a pre-pass).
 */
function assignTiers(teams: RealTeam[]): void {
  // First, do a lightweight teamScore pre-pass so ties can be broken
  for (const team of teams) {
    // Quick score: average pts of top-5 by pts/g
    const top5 = [...team.players]
      .sort((a, b) => b.stats.pts - a.stats.pts)
      .slice(0, 5);
    team.teamScore = top5.reduce((s, p) => s + p.stats.pts, 0) / (top5.length || 1);
  }

  const sorted = [...teams].sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.teamScore - a.teamScore;
  });

  const n = sorted.length;
  sorted.forEach((team, i) => {
    const pct = i / n;   // 0 = best, 1 = worst
    if (pct < 0.20) team.tier = 4;
    else if (pct < 0.40) team.tier = 3;
    else if (pct < 0.60) team.tier = 2;
    else if (pct < 0.80) team.tier = 1;
    else team.tier = 0;
  });
}

/**
 * Two separate normalisation passes — players vs players, teams vs teams.
 *
 * Player OVR: all players in the entire dataset compared globally → 55–99.
 *   A bench player on the 1997 Bulls is ranked against every other player
 *   ever, not just other tier-4 players.
 *
 * Team OVR:  all teams compared globally by win% → 55–99.  Completely
 *   independent of player OVR.
 *
 * Cost buckets: still assigned per-tier per-position so the draft budget
 *   system stays balanced at every league level.
 */
function normaliseRatingsAndCosts(teams: RealTeam[]): void {
  // ── Player OVR: global across ALL players, 55–99 ────────────────────────────
  const allPlayers = teams.flatMap((t) => t.players);
  if (allPlayers.length > 0) {
    const scores = allPlayers.map((p) => p.fantasyScore);
    const gMin   = Math.min(...scores);
    const gMax   = Math.max(...scores);
    for (const p of allPlayers) {
      p.normalizedRating =
        gMax === gMin
          ? 77
          : Math.round(55 + ((p.fantasyScore - gMin) / (gMax - gMin)) * 44);
    }
  }

  // ── Cost: OVR threshold-based (0–5) ──────────────────────────────────────
  // Cost 0 = below draft threshold; excluded from free-agency pools.
  for (const p of allPlayers) {
    p.cost = ovrToCost(p.normalizedRating);
  }

  // ── Team OVR: global across ALL teams by win%, 55–99 ──────────────────────
  const winPcts = teams.map((t) => t.winPct);
  const wMin   = Math.min(...winPcts);
  const wMax   = Math.max(...winPcts);
  for (const team of teams) {
    team.teamOvr =
      wMax === wMin
        ? 77
        : Math.round(55 + ((team.winPct - wMin) / (wMax - wMin)) * 44);
  }
}

function buildIndexes(teams: RealTeam[]): void {
  playersByTierAndPos.clear();
  teamsByTier.clear();
  draftPoolByPosCost.clear();

  // Per-tier index (used by CPU team picking / sim roster logic)
  for (let tier = 0; tier <= 4; tier++) {
    const tierTeams = teams.filter((t) => t.tier === tier);
    teamsByTier.set(tier, tierTeams);

    const posMap = new Map<Position, RealPlayer[]>();
    for (const pos of POSITIONS) posMap.set(pos, []);

    for (const team of tierTeams) {
      for (const p of team.players) {
        if (p.gp < MIN_DRAFT_GAMES) continue;
        const primary = p.positions[0];
        posMap.get(primary)?.push(p);
      }
    }

    for (const [, list] of posMap) {
      list.sort((a, b) => b.normalizedRating - a.normalizedRating);
    }

    playersByTierAndPos.set(tier, posMap);
  }

  // Global draft index: ALL eligible players across ALL tiers, keyed by pos → cost
  for (const pos of POSITIONS) {
    draftPoolByPosCost.set(pos, new Map());
  }

  for (const team of teams) {
    for (const p of team.players) {
      if (p.gp < MIN_DRAFT_GAMES) continue;
      if (p.cost === 0) continue;           // cost 0 = below threshold, never drafted
      const primary = p.positions[0];
      const costMap = draftPoolByPosCost.get(primary);
      if (!costMap) continue;
      if (!costMap.has(p.cost)) costMap.set(p.cost, []);
      costMap.get(p.cost)!.push(p);
    }
  }
}

/**
 * Build a game Roster for an opponent team using the MPG simulation rule:
 * players are sorted by MPG desc; each plays at most their historical GP.
 * We simulate 82 games and record which player starts each position in
 * each game, then pick the player who appeared in the most games per slot.
 */
function buildSimRoster(team: RealTeam, rng: Rng): Roster {
  const MAX_GAMES = 82;
  const roster: Roster = { PG: null, SG: null, SF: null, PF: null, C: null };

  // For each position, maintain an ordered list: high MPG first
  const byPos: Map<Position, RealPlayer[]> = new Map();
  for (const pos of POSITIONS) {
    const candidates = team.players
      .filter((p) => p.positions.includes(pos))
      .sort((a, b) => b.mpg - a.mpg);
    byPos.set(pos, candidates);
  }

  // Count how many games each player fills per slot over 82 games
  const gamesPlayed: Map<string, number> = new Map();
  for (const p of team.players) gamesPlayed.set(p.id, 0);

  const appearances: Map<Position, Map<string, number>> = new Map(
    POSITIONS.map((pos) => [pos, new Map()])
  );

  for (let game = 1; game <= MAX_GAMES; game++) {
    const usedThisGame = new Set<string>();

    for (const pos of POSITIONS) {
      const candidates = byPos.get(pos) ?? [];
      // Pick first available player who: (a) hasn't been used this game,
      // (b) still has games remaining from their real season
      for (const p of candidates) {
        if (usedThisGame.has(p.id)) continue;
        const played = gamesPlayed.get(p.id) ?? 0;
        if (played >= p.gp) continue;

        gamesPlayed.set(p.id, played + 1);
        usedThisGame.add(p.id);
        const posMap = appearances.get(pos)!;
        posMap.set(p.id, (posMap.get(p.id) ?? 0) + 1);
        break;
      }
    }
  }

  // The "starter" for each slot is the player with most appearances
  for (const pos of POSITIONS) {
    const posMap = appearances.get(pos)!;
    let bestId = "";
    let bestCount = -1;
    for (const [id, count] of posMap) {
      if (count > bestCount) { bestCount = count; bestId = id; }
    }
    if (bestId) {
      const p = team.players.find((x) => x.id === bestId);
      if (p) roster[pos] = p;
    }
  }

  // Fill any empty slots with highest-rated available player
  for (const pos of POSITIONS) {
    if (roster[pos]) continue;
    const candidates = (byPos.get(pos) ?? [])
      .filter((p) => !Object.values(roster).some((r) => r?.id === p.id));
    if (candidates.length > 0) {
      roster[pos] = candidates.sort((a, b) => b.normalizedRating - a.normalizedRating)[0];
    }
  }

  return roster;
}

/**
 * Quick helper used for team score computation (not the full sim).
 * Returns the 5 players most likely to start based on MPG (one per position).
 */
function pickStartingFive(team: RealTeam): RealPlayer[] {
  const starters: RealPlayer[] = [];
  const used = new Set<string>();

  for (const pos of POSITIONS) {
    const best = team.players
      .filter((p) => p.positions.includes(pos) && !used.has(p.id))
      .sort((a, b) => b.mpg - a.mpg)[0];
    if (best) {
      starters.push(best);
      used.add(best.id);
    }
  }

  return starters;
}
