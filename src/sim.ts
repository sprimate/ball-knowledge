import { Rng } from "./rng";
import { Roster, Standing, Team, PlayerSeasonLine, SeasonBoxStats } from "./types";
import { rosterRating } from "./data";
import { toSimPlayer, simulateMatchup } from "./possessionSim";

export type SimProgress = {
  standings: Standing[];
  gamesPlayed: number;
  totalGames: number;
};

// ─── Possession-based season simulation ───────────────────────────────────────

/**
 * "Realistic" season simulation using the possession engine.
 * Each game simulates 75 possessions per team and produces a full box score.
 * Box score totals are accumulated per player across all games.
 */
export async function simulateSeasonPossession(
  teams: Team[],
  rng: Rng,
  userMultiplier: number,
  onProgress: (progress: SimProgress) => void
): Promise<{ standings: Standing[]; boxStats: SeasonBoxStats }> {
  const standings = teams.map((team) => ({
    teamId: team.id,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }));
  const standingByTeam = new Map(standings.map((s) => [s.teamId, s]));

  // Accumulate per-player box lines keyed by teamId
  const boxStats: SeasonBoxStats = new Map(
    teams.map((t) => [t.id, []])
  );

  // Convert every roster player to SimPlayer once per team
  const simRosters = new Map(
    teams.map((t) => [
      t.id,
      Object.values(t.roster)
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => toSimPlayer({ ...(p as any), teamLabel: t.name })),
    ])
  );

  // Initialise box line accumulators for every player
  for (const team of teams) {
    const lines = boxStats.get(team.id)!;
    for (const simP of simRosters.get(team.id)!) {
      lines.push({
        playerId: simP.id,
        fullName: simP.fullName,
        gp: 0, pts: 0, fgm: 0, fga: 0,
        fgm3: 0, fga3: 0, ftm: 0, fta: 0,
        orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
      });
    }
  }

  const schedule = buildSchedule(teams.map((t) => t.id), 82, rng);
  const totalGames = schedule.length;

  for (let index = 0; index < schedule.length; index++) {
    const [homeId, awayId] = schedule[index];

    const gameRng = rng.fork(`g${index}`);
    const result = simulateMatchup(simRosters.get(homeId)!, simRosters.get(awayId)!, gameRng, 75);

    // Accumulate box scores
    const accum = (teamId: string, lines: typeof result.home.lines) => {
      const teamLines = boxStats.get(teamId)!;
      for (const gl of lines) {
        const acc = teamLines.find((l) => l.playerId === gl.player.id);
        if (!acc) continue;
        acc.gp++;
        acc.pts  += gl.pts;
        acc.fgm  += gl.fgm;
        acc.fga  += gl.fga;
        acc.fgm3 += gl.fgm3;
        acc.fga3 += gl.fga3;
        acc.ftm  += gl.ftm;
        acc.fta  += gl.fta;
        acc.orb  += gl.orb;
        acc.drb  += gl.drb;
        acc.ast  += gl.ast;
        acc.stl  += gl.stl;
        acc.blk  += gl.blk;
        acc.tov  += gl.tov;
        if ((gl as any).pf !== undefined && (acc as any).pf !== undefined)
          (acc as any).pf += (gl as any).pf;
        if ('pf' in gl && (acc as any).pf !== undefined) (acc as any).pf += (gl as any).pf;
      }
    };
    accum(homeId, result.home.lines);
    accum(awayId, result.away.lines);

    // Update standings
    const hPts = result.home.pts;
    const aPts = result.away.pts;
    const hSt = standingByTeam.get(homeId)!;
    const aSt = standingByTeam.get(awayId)!;
    hSt.pointsFor  += hPts;
    hSt.pointsAgainst += aPts;
    aSt.pointsFor  += aPts;
    aSt.pointsAgainst += hPts;
    if (hPts !== aPts) {
      if (hPts > aPts) { hSt.wins++; aSt.losses++; }
      else { aSt.wins++; hSt.losses++; }
    } else {
      // No ties — give win to home (rare)
      hSt.wins++; aSt.losses++;
    }

    if (index % 16 === 0 || index === schedule.length - 1) {
      onProgress({ standings: sortStandings(standings), gamesPlayed: index + 1, totalGames });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return { standings: sortStandings(standings), boxStats };
}

// ─── Fast (rating-based) season simulation — kept intact ─────────────────────

// ─── Fast (rating-based) season simulation — kept intact ─────────────────────

export async function simulateSeason(
  teams: Team[],
  rng: Rng,
  userMultiplier: number,
  onProgress: (progress: SimProgress) => void
): Promise<Standing[]> {
  const standings = teams.map((team) => ({
    teamId: team.id,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0
  }));
  const standingByTeam = new Map(standings.map((standing) => [standing.teamId, standing]));
  const schedule = buildSchedule(teams.map((team) => team.id), 82, rng);
  const totalGames = schedule.length;

  for (let index = 0; index < schedule.length; index += 1) {
    const [homeId, awayId] = schedule[index];
    const home = teams.find((team) => team.id === homeId)!;
    const away = teams.find((team) => team.id === awayId)!;
    const result = simulateGame(home.roster, away.roster, rng,
      homeId === "user" ? userMultiplier : 1,
      awayId === "user" ? userMultiplier : 1
    );
    const homeStanding = standingByTeam.get(homeId)!;
    const awayStanding = standingByTeam.get(awayId)!;

    homeStanding.pointsFor += result.homeScore;
    homeStanding.pointsAgainst += result.awayScore;
    awayStanding.pointsFor += result.awayScore;
    awayStanding.pointsAgainst += result.homeScore;

    if (result.homeScore >= result.awayScore) {
      homeStanding.wins += 1;
      awayStanding.losses += 1;
    } else {
      awayStanding.wins += 1;
      homeStanding.losses += 1;
    }

    if (index % 16 === 0 || index === schedule.length - 1) {
      onProgress({ standings: sortStandings(standings), gamesPlayed: index + 1, totalGames });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return sortStandings(standings);
}

export function sortStandings(standings: Standing[]): Standing[] {
  return [...standings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst);
  });
}

function buildSchedule(teamIds: string[], gamesPerTeam: number, rng: Rng): [string, string][] {
  const targetGames = new Map(teamIds.map((id) => [id, 0]));
  const games: [string, string][] = [];
  let guard = 0;

  while ([...targetGames.values()].some((gamesPlayed) => gamesPlayed < gamesPerTeam) && guard < 100000) {
    guard += 1;
    const sorted = [...teamIds].sort((a, b) => targetGames.get(a)! - targetGames.get(b)!);
    const home = sorted[0];
    const candidates = sorted.filter((id) => id !== home && targetGames.get(id)! < gamesPerTeam);
    if (targetGames.get(home)! >= gamesPerTeam || candidates.length === 0) break;
    const away = rng.choice(candidates.slice(0, Math.max(2, Math.ceil(candidates.length / 2))));
    games.push([home, away]);
    targetGames.set(home, targetGames.get(home)! + 1);
    targetGames.set(away, targetGames.get(away)! + 1);
  }

  return games;
}

function simulateGame(home: Roster, away: Roster, rng: Rng, homeMultiplier = 1, awayMultiplier = 1): { homeScore: number; awayScore: number } {
  const homeStrength = rosterRating(home);
  const awayStrength = rosterRating(away);
  const homeScore = Math.round((78 + homeStrength * 0.115 + rng.float(-14, 14) + 2) * homeMultiplier);
  const awayScore = Math.round((78 + awayStrength * 0.115 + rng.float(-14, 14)) * awayMultiplier);
  if (homeScore === awayScore) {
    return rng.next() > 0.5 ? { homeScore: homeScore + 1, awayScore } : { homeScore, awayScore: awayScore + 1 };
  }
  return { homeScore, awayScore };
}
