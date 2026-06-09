import { League, Player, Position, Roster, Stats, Team } from "./types";
import { Rng } from "./rng";
import { HISTORICAL_TEAMS } from "./teams";
import { isNBADataLoaded, buildRealTierPool, pickRealCpuTeams } from "./nbaLoader";

export const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

export const LEAGUES: League[] = [
  { name: "JV", teams: 12, budget: 9 },
  { name: "Varsity", teams: 16, budget: 11 },
  { name: "College", teams: 20, budget: 13 },
  { name: "G League", teams: 24, budget: 15 },
  { name: "NBA", teams: 30, budget: 17 }
];

const FIRST_NAMES = [
  "Andre", "Baron", "Cedric", "Darius", "Elliot", "Frankie", "Gabe", "Harlan",
  "Isaiah", "Jalen", "Keon", "Lamar", "Malik", "Nico", "Omar", "Perry",
  "Quincy", "Rashad", "Silas", "Tariq", "Udon", "Vince", "Wes", "Xavier",
  "Yuri", "Zion"
];

const LAST_NAMES = [
  "Banks", "Cross", "Dawson", "Ellis", "Fields", "Grant", "Hayes", "Irving",
  "Johnson", "Knight", "Lewis", "Mercer", "Nash", "Owens", "Pierce", "Quinn",
  "Reed", "Stone", "Turner", "Usher", "Vale", "Walker", "Young", "Zimmer"
];

export function emptyRoster(): Roster {
  return { PG: null, SG: null, SF: null, PF: null, C: null };
}

/**
 * Maps a normalised OVR (55–99) to a draft cost tier (0–5).
 * Cost 0 means the player is below the threshold and excluded from drafts.
 */
export function ovrToCost(ovr: number): number {
  if (ovr >= 85) return 5;
  if (ovr >= 80) return 4;
  if (ovr >= 75) return 3;
  if (ovr >= 70) return 2;
  if (ovr >= 64) return 1;
  return 0;
}

export function fantasyScore(stats: Stats): number {
  return (
    stats.pts +
    stats.threes -
    stats.fga +
    stats.fgm * 2 -
    stats.fta +
    stats.ftm +
    stats.reb +
    stats.ast * 2 +
    stats.stl * 4 +
    stats.blk * 4 -
    stats.tov * 2
  );
}

/**
 * Hollinger Game Score — used as the primary OVR/cost metric.
 * GmSc = PTS + 0.4*FGM + 0.7*ORB + 0.3*DRB + STL + 0.7*AST + 0.7*BLK
 *        - 0.7*FGA - 0.4*(FTA-FTM) - TOV
 */
export function gameScore(stats: Stats): number {
  const ftMissed = (stats.fta ?? 0) - (stats.ftm ?? 0);
  return (
    (stats.pts   ?? 0) +
    0.4 * (stats.fgm  ?? 0) +
    0.7 * (stats.orb  ?? 0) +
    0.3 * (stats.drb  ?? 0) +
          (stats.stl  ?? 0) +
    0.7 * (stats.ast  ?? 0) +
    0.7 * (stats.blk  ?? 0) -
    0.7 * (stats.fga  ?? 0) -
    0.4 * ftMissed -
          (stats.tov  ?? 0)
  );
}

export function rosterCost(roster: Roster): number {
  return Object.values(roster).reduce((total, player) => total + (player?.cost ?? 0), 0);
}

export function rosterRating(roster: Roster): number {
  return Object.values(roster).reduce((total, player) => total + (player?.normalizedRating ?? 0), 0);
}

export function generatePlayers(rng: Rng, count: number, usedNames: Set<string>, idPrefix: string): Player[] {
  const raw = Array.from({ length: count }, (_, index) => {
    const positions = generatePositions(rng);
    const stats = generateStats(rng, positions);
    const fullName = uniqueName(rng, usedNames);
    return {
      id: `${idPrefix}-${index}-${fullName.split(" ").join("-").toLowerCase()}`,
      fullName,
      seasonYear: rng.int(1980, 2026),
      positions,
      stats,
      fantasyScore: gameScore(stats),
      normalizedRating: 60,
      cost: 3
    };
  });

  return applyRatingsAndCosts(raw);
}

function uniqueName(rng: Rng, usedNames: Set<string>): string {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const suffix = attempt > 200 ? ` ${rng.int(2, 99)}` : "";
    const name = `${rng.choice(FIRST_NAMES)} ${rng.choice(LAST_NAMES)}${suffix}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  const fallback = `Generated Player ${usedNames.size + 1}`;
  usedNames.add(fallback);
  return fallback;
}

function generatePositions(rng: Rng): Position[] {
  const primaryIndex = rng.int(0, POSITIONS.length - 1);
  const positions = new Set<Position>([POSITIONS[primaryIndex]]);
  if (rng.next() < 0.35 && primaryIndex > 0) positions.add(POSITIONS[primaryIndex - 1]);
  if (rng.next() < 0.35 && primaryIndex < POSITIONS.length - 1) positions.add(POSITIONS[primaryIndex + 1]);
  if (rng.next() < 0.08) positions.add(rng.choice(POSITIONS));
  return [...positions];
}

function generateStats(rng: Rng, positions: Position[]): Stats {
  const big = positions.includes("PF") || positions.includes("C");
  const guard = positions.includes("PG") || positions.includes("SG");
  const talent = rng.float(0.35, 1);
  const pts = rng.float(7, 32) * talent;
  const fga = Math.max(pts * rng.float(0.75, 1.05), pts + rng.float(0, 8));
  const fgm = fga * rng.float(0.39, big ? 0.58 : 0.51);
  const fta = rng.float(1, 9) * talent;
  const ftm = fta * rng.float(0.62, 0.91);
  return {
    pts: round(pts),
    threes: round(rng.float(0, guard ? 4.8 : 2.4) * talent),
    threepa: round(rng.float(0, guard ? 9 : 4) * talent),
    fga: round(fga),
    fgm: round(fgm),
    fta: round(fta),
    ftm: round(ftm),
    orb: round(rng.float(big ? 1 : 0.2, big ? 4 : 1.2) * talent),
    drb: round(rng.float(big ? 3 : 1.5, big ? 10 : 5) * talent),
    reb: round(rng.float(big ? 5 : 2, big ? 14 : 8) * talent),
    ast: round(rng.float(guard ? 3 : 1, guard ? 11 : 6) * talent),
    stl: round(rng.float(0.3, 2.2) * talent),
    blk: round(rng.float(big ? 0.6 : 0.1, big ? 3.1 : 1.3) * talent),
    tov: round(rng.float(0.8, 4.6) * talent)
  };
}

function applyRatingsAndCosts(players: Player[]): Player[] {
  const scores = players.map((player) => player.fantasyScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  return players.map((player) => {
    const ovr = max === min ? 77 : Math.round(55 + ((player.fantasyScore - min) / (max - min)) * 44);
    return { ...player, normalizedRating: ovr, cost: ovrToCost(ovr) };
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Historical-team helpers
// ---------------------------------------------------------------------------

/**
 * Build a draft pool for the given tier.
 * When real NBA data is loaded (nbaLoader), delegates to buildRealTierPool
 * which gives 1 player per (position × cost bucket) = 25 players for the
 * initial draft, or 2 per bucket = 50 for free-agency drafts.
 * Falls back to the synthetic path if data isn't ready.
 */
export function buildTierPool(tier: number, rng: Rng, perBucket = 1): Player[] {
  if (isNBADataLoaded()) {
    return buildRealTierPool(tier, rng, perBucket);
  }

  // ── Synthetic fallback ─────────────────────────────────────────────────
  const teams = HISTORICAL_TEAMS.filter((t) => t.tier === tier);
  const all: Player[] = teams.flatMap((t) =>
    t.players.map((hp) => {
      const gs = gameScore(hp.stats);
      return { ...hp, fantasyScore: gs, normalizedRating: 60, cost: 3 };
    })
  );

  const scores = all.map((p) => p.fantasyScore);
  const gMin = Math.min(...scores);
  const gMax = Math.max(...scores);
  const normalize = (fs: number) =>
    gMax === gMin ? 77 : Math.round(55 + ((fs - gMin) / (gMax - gMin)) * 44);

  const byPos = new Map<Position, Player[]>();
  for (const pos of POSITIONS) {
    const group = all
      .filter((p) => p.positions[0] === pos)
      .map((p) => {
        const ovr = normalize(p.fantasyScore);
        return { ...p, normalizedRating: ovr, cost: ovrToCost(ovr) };
      });
    byPos.set(pos, group);
  }

  const pool: Player[] = [];
  for (const pos of POSITIONS) {
    const group = byPos.get(pos) ?? [];
    for (let cost = 1; cost <= 5; cost++) {
      const candidates = group.filter((p) => p.cost === cost);
      for (let i = 0; i < perBucket; i++) {
        if (candidates.length > 0) {
          pool.push(rng.choice(candidates));
        } else {
          const fallback = [...group].sort((a, b) => Math.abs(a.cost - cost) - Math.abs(b.cost - cost))[0];
          if (fallback) pool.push({ ...fallback, cost });
        }
      }
    }
  }
  return pool;
}

/**
 * Pick `count` CPU teams for the given tier.
 * When real NBA data is loaded, uses pickRealCpuTeams which runs the
 * MPG-based lineup simulation. Falls back to the synthetic path.
 * `pool` parameter kept for API compatibility but unused in the real path.
 */
export function pickCpuTeams(tier: number, count: number, rng: Rng, pool: Player[]): Team[] {
  if (isNBADataLoaded()) {
    return pickRealCpuTeams(tier, count, rng);
  }

  // ── Synthetic fallback ─────────────────────────────────────────────────
  const playerById = new Map(pool.map((p) => [p.id, p]));
  const available = rng.shuffle(HISTORICAL_TEAMS.filter((t) => t.tier === tier));
  const usedFranchises = new Set<string>();
  const result: Team[] = [];

  for (const ht of available) {
    if (usedFranchises.has(ht.franchise)) continue;
    usedFranchises.add(ht.franchise);

    const roster = emptyRoster();
    for (const hp of ht.players) {
      for (const pos of hp.positions) {
        if (roster[pos] === null) {
          roster[pos] = playerById.get(hp.id) ?? null;
          break;
        }
      }
    }
    result.push({ id: ht.id, name: ht.displayName, isUser: false, roster });
    if (result.length >= count) break;
  }

  return result;
}
