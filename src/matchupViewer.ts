/**
 * matchupViewer.ts  —  5v5 possession-sim test/validation page.
 *
 * Loads NBA data (or falls back to synthetic players), picks 10 random players,
 * splits them 5v5, simulates 75 possessions each direction, and renders a
 * box score table so you can sanity-check the simulation output.
 */

import { loadNBAData, isNBADataLoaded, getAllDataPlayers, RealPlayer } from "./nbaLoader";
import { generatePlayers } from "./data";
import { toSimPlayer, simulateMatchup, SimPlayer, TeamBoxScore } from "./possessionSim";
import { Rng } from "./rng";
import { Player, Position } from "./types";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

(async () => {
  app.innerHTML = `<p class="loading">Loading NBA data…</p>`;
  try {
    await loadNBAData();
  } catch {
    // Fine – will use synthetic fallback
  }
  renderPage();
})();

// ─── Main render ──────────────────────────────────────────────────────────────

function renderPage(): void {
  const seed = Date.now().toString();
  const { home, away, homeLabel, awayLabel } = buildTeams(seed);
  const rng = new Rng(seed + "-sim");
  const result = simulateMatchup(home, away, rng, 75);

  const homePts = result.home.pts;
  const awayPts = result.away.pts;

  app.innerHTML = `
    <header>
      <a href="/">← Home</a>
      <h1>Matchup Sim <span class="subtitle">— possession-by-possession validation</span></h1>
      <button id="simBtn" class="btn-sim">▶ Simulate Again</button>
    </header>

    <div class="scoreboard">
      <div class="score-block ${homePts > awayPts ? "winner" : ""}">
        <div class="team-label">${homeLabel}</div>
        <div class="score">${homePts}</div>
      </div>
      <div class="score-sep">vs</div>
      <div class="score-block ${awayPts > homePts ? "winner" : ""}">
        <div class="score">${awayPts}</div>
        <div class="team-label">${awayLabel}</div>
      </div>
    </div>

    <div class="panels">
      <div class="panel">
        <div class="panel-title">${homeLabel}</div>
        ${renderBoxScore(result.home)}
      </div>
      <div class="panel">
        <div class="panel-title">${awayLabel}</div>
        ${renderBoxScore(result.away)}
      </div>
    </div>
  `;

  document.getElementById("simBtn")!.addEventListener("click", () => renderPage());
}

// ─── Team builder ─────────────────────────────────────────────────────────────

type BuiltTeams = {
  home: SimPlayer[];
  away: SimPlayer[];
  homeLabel: string;
  awayLabel: string;
};

function buildTeams(seed: string): BuiltTeams {
  const rng = new Rng(seed + "-pick");
  const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

  if (isNBADataLoaded()) {
    // ── Real data path ────────────────────────────────────────────────────────
    // For each team slot, pick a random player whose primary position matches.
    const all = getAllDataPlayers();
    const byPos = new Map<Position, (RealPlayer & { _tier: number })[]>();
    for (const pos of POSITIONS) {
      byPos.set(pos, all.filter((p) => p.positions[0] === pos && p.gp >= 20));
    }

    const pick5 = (exclude: Set<string>): SimPlayer[] => {
      const players: SimPlayer[] = [];
      for (const pos of POSITIONS) {
        const pool = (byPos.get(pos) ?? []).filter((p) => !exclude.has(p.id));
        const p = rng.choice(pool.length > 0 ? pool : all.filter((x) => !exclude.has(x.id)));
        exclude.add(p.id);
        players.push(
          toSimPlayer({
            ...p,
            teamLabel: shortTeamLabel(p.teamKey),
          })
        );
      }
      return players;
    };

    const usedIds = new Set<string>();
    const home = pick5(usedIds);
    const away = pick5(usedIds);

    return {
      home,
      away,
      homeLabel: uniqueTeamLabel(home),
      awayLabel: uniqueTeamLabel(away),
    };
  } else {
    // ── Synthetic fallback ────────────────────────────────────────────────────
    const usedNames = new Set<string>();
    const raw = generatePlayers(rng, 10, usedNames, "mv");
    const home5 = raw.slice(0, 5).map((p) => syntheticSimPlayer(p, POSITIONS));
    const away5 = raw.slice(5, 10).map((p) => syntheticSimPlayer(p, POSITIONS));
    return {
      home: home5,
      away: away5,
      homeLabel: "Team Home",
      awayLabel: "Team Away",
    };
  }
}

function syntheticSimPlayer(p: Player, positions: Position[]): SimPlayer {
  // Assign a clean position by slot index so the 5-player array has one of each
  return toSimPlayer({ ...p, teamLabel: "Gen" });
}

function shortTeamLabel(teamKey: string): string {
  // "1997 Chicago Bulls" → "1997 CHI"
  const year = teamKey.match(/^\d{4}/)?.[0] ?? "";
  const name = teamKey.replace(/^\d{4}\s+/, "");
  const abbr = name.split(" ").pop()?.slice(0, 3).toUpperCase() ?? name.slice(0, 3).toUpperCase();
  return `${year} ${abbr}`;
}

function uniqueTeamLabel(players: SimPlayer[]): string {
  const labels = [...new Set(players.map((p) => p.teamLabel))].slice(0, 2);
  return labels.join(" / ") || "Team";
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function pct(made: number, att: number): string {
  if (att === 0) return "—";
  return (made / att * 100).toFixed(1) + "%";
}

function renderBoxScore(box: TeamBoxScore): string {
  const rows = box.lines.map((l) => `
    <tr>
      <td class="name">
        ${l.player.fullName}
        ${l.player.teamLabel ? `<span class="team-tag">${l.player.teamLabel}</span>` : ""}
      </td>
      <td class="pts">${l.pts}</td>
      <td>${l.fgm}-${l.fga}</td>
      <td class="dim">${pct(l.fgm, l.fga)}</td>
      <td>${l.fgm3}-${l.fga3}</td>
      <td class="dim">${pct(l.fgm3, l.fga3)}</td>
      <td>${l.ftm}-${l.fta}</td>
      <td class="dim">${pct(l.ftm, l.fta)}</td>
      <td>${l.orb + l.drb}<span class="dim"> (${l.orb}+${l.drb})</span></td>
      <td>${l.ast}</td>
      <td>${l.stl}</td>
      <td>${l.blk}</td>
      <td class="tov">${l.tov}</td>
    </tr>
  `).join("");

  const t = box;
  const totalsRow = `
    <tr class="totals">
      <td>TOTALS</td>
      <td class="pts">${t.pts}</td>
      <td>${t.fgm}-${t.fga}</td>
      <td class="dim">${pct(t.fgm, t.fga)}</td>
      <td>${t.fgm3}-${t.fga3}</td>
      <td class="dim">${pct(t.fgm3, t.fga3)}</td>
      <td>${t.ftm}-${t.fta}</td>
      <td class="dim">${pct(t.ftm, t.fta)}</td>
      <td>${t.orb + t.drb}<span class="dim"> (${t.orb}+${t.drb})</span></td>
      <td>${t.ast}</td>
      <td>${t.stl}</td>
      <td>${t.blk}</td>
      <td class="tov">${t.tov}</td>
    </tr>
  `;

  return `
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>PTS</th>
            <th>FG</th>
            <th>FG%</th>
            <th>3PT</th>
            <th>3P%</th>
            <th>FT</th>
            <th>FT%</th>
            <th>REB</th>
            <th>AST</th>
            <th>STL</th>
            <th>BLK</th>
            <th>TOV</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${totalsRow}
        </tbody>
      </table>
    </div>
  `;
}
