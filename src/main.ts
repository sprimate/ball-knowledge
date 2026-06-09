import "./styles.css";
import { LEAGUES, POSITIONS, emptyRoster, generatePlayers, rosterCost, buildTierPool, pickCpuTeams } from "./data";
import { loadNBAData, teamAbbr, isNBADataLoaded, getAllDataPlayers, RealPlayer, getNextSeasonPlayer } from "./nbaLoader";
import { Rng } from "./rng";
import { simulateSeason, simulateSeasonPossession } from "./sim";
import { DraftMode, DraftPick, Player, PlayerSeasonLine, Position, Roster, SeasonBoxStats, SeasonRecord, SortKey, Standing, Team } from "./types";

type GameState = {
  seed: string;
  rng: Rng;
  usedNames: Set<string>;
  leagueIndex: number;
  seasonYear: number;
  discountPoints: number;
  budget: number;
  draftMode: DraftMode;
  draftPool: Player[];
  teams: Team[];
  userRoster: Roster;
  pendingPicks: DraftPick[];
  standings: Standing[];
  selectedTeamId: string;
  filter: Position | "ALL";
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  status: string;
  isSimulating: boolean;
  completed: boolean;
  viewMode: "draft" | "standings" | "data";
  draftViewMode: "simple" | "advanced";
  statsMode: "pg" | "p36";
  costFilter: number[];
  multiplier: number;
  selectedPlayerId: string | null;
  seasonHistory: SeasonRecord[];
  pendingResult: SeasonRecord | null;
  lastRecord: { wins: number; losses: number } | null;
  seasonBoxStats: SeasonBoxStats | null;
  teamPopupId: string | null;
  ageUpUsed: boolean;           // one Age Up allowed per free agency period
  selectedRosterSlot: Position | null;  // tracks which roster slot is "selected" for stat display
};

const TEAM_NAMES = [
  "Baltimore Glass", "Tacoma Tempo", "Reno Range", "Albany Five", "Boise Baseline",
  "Omaha Motion", "Tulsa Touch", "Fresno Flight", "Dayton Drop", "Akron Arc",
  "Mesa Mismatch", "Salem Screen", "Toledo Trees", "Boulder Bounce", "Mobile Money",
  "Spokane Switch", "Wichita Wings", "Laredo Lift", "Madison Math", "Hampton Heat",
  "Lincoln Lob", "Trenton Twist", "Eugene Elbow", "Aurora Angle", "Durham Drive",
  "Plano Pace", "Irvine Iron", "Corpus Cut", "Modesto Motion", "Yonkers Yard"
];

let state = newGame(seedFromUrl());

function newGame(seed: string): GameState {
  const rng = new Rng(seed);
  const usedNames = new Set<string>();
  const draftPool = buildTierPool(0, rng);
  return {
    seed,
    rng,
    usedNames,
    leagueIndex: 0,
    seasonYear: 1,
    discountPoints: 0,
    budget: 10,
    draftMode: "initial",
    draftPool,
    teams: [],
    userRoster: emptyRoster(),
    pendingPicks: [],
    standings: [],
    selectedTeamId: "user",
    filter: "ALL",
    sortKey: "normalizedRating",
    sortDirection: "desc",
    status: "Pick exactly 5 players and fit the JV budget.",
    isSimulating: false,
    completed: false,
    viewMode: "draft",
    draftViewMode: "simple",
    statsMode: "pg",
    costFilter: [],
    multiplier: 1,
    selectedPlayerId: null,
    seasonHistory: [],
    pendingResult: null,
    lastRecord: null,
    seasonBoxStats: null,
    teamPopupId: null,
    ageUpUsed: false,
    selectedRosterSlot: null,
  };
}

function seedFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("seed") || Math.random().toString(36).slice(2, 10).toUpperCase();
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const league = LEAGUES[state.leagueIndex];
  const userRank = rankForTeam("user");
  app.innerHTML = `
    <main class="shell">
      <section class="topbar">
        <div>
          <h1>Ball Knowledge</h1>
          <p>${state.completed ? `NBA title won in ${state.seasonYear - 1} seasons.` : state.status}</p>
        </div>
        <div class="meta">
          <span>Seed <b>${state.seed}</b></span>
          <label class="multiplier-label">Multiplier <input id="multiplier" type="number" value="${state.multiplier}" step="0.1" min="0" /></label>
        </div>
        <div class="actions">
          <button id="restart-same">Restart Same</button>
          <button id="restart-new">New Seed</button>
          <button id="toggle-data-view">Data ↗</button>
        </div>
      </section>

      <section class="layout ${state.viewMode === "data" ? "standings" : state.viewMode}">
        ${state.viewMode === "data" ? renderDataView() : ""}
        <div class="panel roster-panel">
          <div class="panel-head roster-head">
            <div class="roster-head-title">
              <h2>Your Team</h2>
              ${(() => {
                const cost = effectiveRosterCost();
                const budget = state.budget;
                const over = cost > budget;
                return `<span class="budget-badge ${over ? "budget-over" : ""}">Budget ${cost}/${budget}${over ? " OVER" : ""}</span>`;
              })()}
              ${state.discountPoints > 0 ? `<span class="budget-badge">Discounts ${state.discountPoints}</span>` : ""}
              ${userRank ? `<span class="budget-badge">Rank ${userRank}/${LEAGUES[state.leagueIndex].teams}</span>` : ""}
              ${state.lastRecord ? `<span class="budget-badge">Record ${state.lastRecord.wins}\u2013${state.lastRecord.losses}</span>` : ""}
            </div>
          ${state.viewMode === "draft" ? `<button id="submit-draft" ${canSubmitDraft() ? "" : "disabled"}>Start Season</button>` : ""}
          </div>
          <div class="slots single-row">${POSITIONS.map((slot) => renderSlot(slot)).join("")}</div>
          <div class="rules compact">
            ${draftRuleText()}
            ${(() => { const used = state.pendingPicks.reduce((t, p) => t + p.discount, 0); return state.discountPoints > 0 ? `<span class="discount-info">Available Discounts: ${state.discountPoints - used}/${state.discountPoints}</span>` : ""; })()}
          </div>
        </div>

        <div class="panel draft-panel">
          <div class="league-ladder">
            <span class="ladder-season">Season ${state.seasonYear}</span>
            ${LEAGUES.map((l, i) => {
              const active = i === state.leagueIndex;
              return `
                ${i > 0 ? `<span class="ladder-line"></span>` : ""}
                <span class="ladder-node ${active ? "ladder-active" : ""}">${l.name}</span>
              `;
            }).join("")}
          </div>
          <div class="panel-head stage-head">
            <div class="draft-head-left">
              <h2>${state.draftMode === "initial" ? "Free Agency" : "Free Agency"}</h2>
              <div class="draft-view-toggle">
                <button class="filter ${state.draftViewMode === "simple" ? "active" : ""}" id="draft-simple-btn">Simple</button>
                <button class="filter ${state.draftViewMode === "advanced" ? "active" : ""}" id="draft-advanced-btn">Detailed</button>
              </div>
              <div class="draft-view-toggle">
                <button class="filter ${state.statsMode === "pg" ? "active" : ""}" id="stats-pg-btn">Per Game</button>
                <button class="filter ${state.statsMode === "p36" ? "active" : ""}" id="stats-p36-btn">Per 36</button>
              </div>
            </div>
            ${state.draftViewMode === "advanced" ? `
              <div class="panel-controls">
                <div class="filters">
                  ${[1, 2, 3, 4, 5].map((c) => `<button class="filter ${state.costFilter.includes(c) ? "active" : ""}" data-cost-filter="${c}">$${c}</button>`).join("")}
                </div>
                <div class="filters">
                  ${["ALL", ...POSITIONS].map((position) => `<button class="filter ${state.filter === position ? "active" : ""}" data-filter="${position}">${position}</button>`).join("")}
                </div>
              </div>
            ` : ""}
          </div>
          ${state.draftMode === "complete"
            ? `<div class="empty-state">Draft locked. Season is simulating.</div>`
            : state.draftViewMode === "simple"
            ? renderSimpleDraft()
            : renderDraftTable()
          }
        </div>

        <div class="panel standings-panel">
          <div class="panel-head">
            <h2>Standings</h2>
            ${!state.isSimulating && !state.completed && !state.pendingResult && state.viewMode === "standings" ? `<button id="next-season">Free Agency →</button>` : ""}
          </div>
          <div class="standings-wrap">
            ${renderStandings()}
          </div>
        </div>
      </section>
      ${state.completed ? renderChampionshipOverlay() : state.pendingResult ? renderSeasonResultOverlay(state.pendingResult) : ""}
      ${state.teamPopupId ? renderTeamPopup(state.teamPopupId) : ""}
    </main>
  `;
  wireEvents();
  if (state.selectedPlayerId) {
    const row = document.querySelector<HTMLElement>(`[data-select-player="${state.selectedPlayerId}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function renderSlot(slot: Position): string {
  const pick = state.pendingPicks.find((item) => item.slot === slot);
  const player = pick?.player ?? state.userRoster[slot];
  const discount = pick?.discount ?? 0;
  const selectedPlayer = state.selectedPlayerId ? state.draftPool.find((p) => p.id === state.selectedPlayerId) : null;
  const canAssign = selectedPlayer && selectedPlayer.positions.includes(slot) && state.draftMode !== "complete";
  const usedDiscounts = state.pendingPicks.reduce((total, item) => total + item.discount, 0);
  const remainingDiscounts = state.discountPoints - usedDiscounts;
  const canToggleOn = discount === 0 && remainingDiscounts > 0 && pick && pick.player.cost > 0;
  const showDiscountToggle = pick && state.discountPoints > 0 && (discount > 0 || canToggleOn);
  const willReset = !!pick && !!state.userRoster[slot];

  // Age Up: available on freeAgency (not initial), not yet used this period,
  // player has a next season in dataset, and the slot isn't already pending replacement.
  const rosterPlayer = state.userRoster[slot];
  const rp = rosterPlayer as unknown as RealPlayer;
  const canAgeUp = state.draftMode === "freeAgency"
    && !state.ageUpUsed
    && !pick                          // no pending replacement for this slot
    && !!rosterPlayer
    && !!rp.bbrefId
    && !!getNextSeasonPlayer(rp, rosterPlayer.cost);

  const isSlotSelected = state.selectedRosterSlot === slot;

  return `
    <div class="slot ${canAssign ? "slot-assignable" : ""} ${player ? "slot-occupied" : ""} ${isSlotSelected ? "slot-selected" : ""}" data-slot-click="${slot}">
      <div class="slot-title">${slot}</div>
      ${
        player
          ? `<div class="slot-player">
              <b>${seasonLabel(player.seasonYear)} ${player.fullName}${(player as unknown as RealPlayer).age != null ? ` (${(player as unknown as RealPlayer).age})` : ""}</b>
              <span>${player.positions.join("/")} | ${player.normalizedRating} OVR | ${discount > 0 ? `<span class="slot-cost-original">$${player.cost}</span> <span class="slot-cost-final">$${Math.max(0, player.cost - discount)}</span>` : `<span class="slot-cost-final">$${player.cost}</span>`}</span>
              <div class="discount-row">
                ${pick && showDiscountToggle ? `<button data-toggle-discount="${slot}">${discount > 0 ? "Remove Discount" : "Apply Discount"}</button>` : ""}
                ${pick ? `<button data-clear-slot="${slot}">${willReset ? "Reset" : "Clear"}</button>` : ""}
                ${canAgeUp ? `<button data-age-up="${slot}" class="age-up-btn">Age Up ➡</button>` : ""}
              </div>
            </div>`
          : `<span class="empty">Open slot</span>`
      }
    </div>
  `;
}

function renderSimpleDraft(): string {
  // The "selected" player can be from the draft pool OR from the user's existing roster.
  const selectedFromPool = state.selectedPlayerId
    ? state.draftPool.find((p) => p.id === state.selectedPlayerId) ?? null
    : null;
  const selectedFromRoster = state.selectedRosterSlot
    ? (state.pendingPicks.find((pk) => pk.slot === state.selectedRosterSlot)?.player
      ?? state.userRoster[state.selectedRosterSlot])
    : null;
  const selectedPlayer = selectedFromPool ?? null;

  const posHeaders = POSITIONS.map((p) => `<div class="sg-pos-header">${p}</div>`).join("");
  const rows = [5, 4, 3, 2, 1].map((cost) => {
    const cells = POSITIONS.map((pos) => {
      const player = state.draftPool.find((p) => p.positions[0] === pos && p.cost === cost);
      if (!player) return `<div class="sg-cell sg-empty">—</div>`;
      const isSelected = state.selectedPlayerId === player.id;
      const isAssigned = state.pendingPicks.some((pk) => pk.player.id === player.id);
      const rp = player as unknown as import("./nbaLoader").RealPlayer;
      const ageStr = rp.age != null ? ` (${rp.age})` : "";
      return `<div class="sg-cell${isSelected ? " sg-selected" : ""}${isAssigned ? " sg-assigned" : ""}" data-select-player="${player.id}"><span class="sg-year">${seasonLabel(player.seasonYear)}${ageStr}</span>${player.fullName}</div>`;
    }).join("");
    return `<div class="sg-cost-label">$${cost}</div>${cells}`;
  }).join("");

  return `
    <div class="simple-draft">
      <div class="simple-grid">
        <div class="sg-corner"></div>
        ${posHeaders}
        ${rows}
      </div>
      ${selectedPlayer
        ? renderPlayerDetail(selectedPlayer)
        : selectedFromRoster
        ? renderPlayerDetail(selectedFromRoster)
        : `<p class="player-detail-hint">Click a player to see stats, then click a slot to assign.</p>`}
    </div>
  `;
}

function renderPlayerDetail(player: Player): string {
  const s = displayStats(player);
  const rp = player as unknown as import("./nbaLoader").RealPlayer;
  const pct = (made: number, att: number) => att > 0 ? (made / att * 100).toFixed(1) : "—";
  return `
    <div class="player-detail">
      <div class="player-detail-name">
        <b>${player.fullName}</b>
        <span>${seasonLabel(player.seasonYear)} · ${teamAbbrForPlayer(player)} · $${player.cost}</span>
      </div>
      <div class="player-detail-stats">
        <div><label>POS</label><span>${player.positions.join("/")}</span></div>
        <div><label>Age</label><span>${rp.age ?? "—"}</span></div>
        <div><label>GP</label><span>${rp.gp ?? "—"}</span></div>
        <div><label>GS</label><span>${rp.gs ?? "—"}</span></div>
        <div><label>MPG</label><span>${rp.mpg ?? "—"}</span></div>
        <div class="stat-sep"></div>
        <div class="stat-dyn"><label>PTS</label><span>${s.pts}</span></div>
        <div class="stat-dyn"><label>FGM</label><span>${s.fgm}</span></div>
        <div class="stat-dyn"><label>FGA</label><span>${s.fga}</span></div>
        <div class="stat-dyn"><label>FG%</label><span>${pct(player.stats.fgm, player.stats.fga)}</span></div>
        <div class="stat-dyn"><label>3PM</label><span>${s.threes}</span></div>
        <div class="stat-dyn"><label>3PA</label><span>${s.threepa}</span></div>
        <div class="stat-dyn"><label>3P%</label><span>${pct(player.stats.threes, player.stats.threepa)}</span></div>
        <div class="stat-dyn"><label>FTM</label><span>${s.ftm}</span></div>
        <div class="stat-dyn"><label>FTA</label><span>${s.fta}</span></div>
        <div class="stat-dyn"><label>FT%</label><span>${pct(player.stats.ftm, player.stats.fta)}</span></div>
        <div class="stat-dyn"><label>ORB</label><span>${s.orb}</span></div>
        <div class="stat-dyn"><label>DRB</label><span>${s.drb}</span></div>
        <div class="stat-dyn"><label>TRB</label><span>${s.reb}</span></div>
        <div class="stat-dyn"><label>AST</label><span>${s.ast}</span></div>
        <div class="stat-dyn"><label>STL</label><span>${s.stl}</span></div>
        <div class="stat-dyn"><label>BLK</label><span>${s.blk}</span></div>
        <div class="stat-dyn"><label>TOV</label><span>${s.tov}</span></div>
      </div>
    </div>
  `;
}

function renderDraftTable(): string {
  const players = sortedPlayers().filter((player) => {
    if (state.filter !== "ALL" && !player.positions.includes(state.filter)) return false;
    if (state.costFilter.length > 0 && !state.costFilter.includes(player.cost)) return false;
    return true;
  });
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${header("fullName", "Player")}
            ${header("seasonYear", "Year")}
            <th>Team</th>
            ${header("positions", "Pos")}
            <th>Age</th>
            ${header("cost", "Cost")}
            ${header("pts", "PTS")}
            ${header("fgm", "FGM")}
            ${header("fga", "FGA")}
            <th>FG%</th>
            ${header("threes", "3PM")}
            ${header("threepa", "3PA")}
            <th>3P%</th>
            ${header("ftm", "FTM")}
            ${header("fta", "FTA")}
            <th>FT%</th>
            ${header("orb", "ORB")}
            ${header("drb", "DRB")}
            ${header("reb", "TRB")}
            ${header("ast", "AST")}
            ${header("stl", "STL")}
            ${header("blk", "BLK")}
            ${header("tov", "TOV")}
          </tr>
        </thead>
        <tbody>${players.map(renderPlayerRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function header(key: SortKey, label: string): string {
  const mark = state.sortKey === key ? (state.sortDirection === "asc" ? "^" : "v") : "";
  return `<th><button class="sort" data-sort="${key}">${label} ${mark}</button></th>`;
}

function renderPlayerRow(player: Player): string {
  const isSelected = state.selectedPlayerId === player.id;
  const isAssigned = state.pendingPicks.some((pick) => pick.player.id === player.id);
  const usedDiscounts = state.pendingPicks.reduce((total, item) => total + item.discount, 0);
  const remainingDiscounts = state.discountPoints - usedDiscounts;
  const budget = LEAGUES[state.leagueIndex].budget;
  const totalCost = effectiveRosterCost();

  let costClass = "";
  if (!isAssigned) {
    const projRoster = projectedRoster();
    const affordablePositions = player.positions.filter((slot) => {
      const occupant = projRoster[slot];
      const occupantPick = state.pendingPicks.find((p) => p.slot === slot);
      const occupantCost = occupant ? Math.max(0, occupant.cost - (occupantPick?.discount ?? 0)) : 0;
      return totalCost - occupantCost + player.cost <= budget;
    });
    const discountAffordable = player.positions.filter((slot) => {
      const occupant = projRoster[slot];
      const occupantPick = state.pendingPicks.find((p) => p.slot === slot);
      const occupantCost = occupant ? Math.max(0, occupant.cost - (occupantPick?.discount ?? 0)) : 0;
      return remainingDiscounts > 0 && totalCost - occupantCost + player.cost - 1 <= budget;
    });
    if (affordablePositions.length === player.positions.length) costClass = "cost-green";
    else if (affordablePositions.length > 0) costClass = "cost-discount";
    else if (discountAffordable.length === player.positions.length) costClass = "cost-discount";
    else if (discountAffordable.length > 0) costClass = "cost-discount";
    else costClass = "cost-over";
  }

  const pct = (made: number, att: number) => att > 0 ? (made / att * 100).toFixed(1) : "—";
  const ds = displayStats(player);
  return `
    <tr class="player-row ${isSelected ? "player-selected" : ""} ${isAssigned ? "player-assigned" : ""}" data-select-player="${player.id}">
      <td><b>${player.fullName}</b></td>
      <td>${seasonLabel(player.seasonYear)}</td>
      <td>${teamAbbrForPlayer(player)}</td>
      <td>${player.positions.join("/")}</td>
      <td>${(player as any).age ?? "—"}</td>
      <td class="${costClass}">${player.cost}</td>
      <td>${ds.pts}</td>
      <td>${ds.fgm}</td>
      <td>${ds.fga}</td>
      <td>${pct(player.stats.fgm, player.stats.fga)}</td>
      <td>${ds.threes}</td>
      <td>${ds.threepa}</td>
      <td>${pct(player.stats.threes, player.stats.threepa)}</td>
      <td>${ds.ftm}</td>
      <td>${ds.fta}</td>
      <td>${pct(player.stats.ftm, player.stats.fta)}</td>
      <td>${ds.orb}</td>
      <td>${ds.drb}</td>
      <td>${ds.reb}</td>
      <td>${ds.ast}</td>
      <td>${ds.stl}</td>
      <td>${ds.blk}</td>
      <td>${ds.tov}</td>
    </tr>
  `;
}

function renderStandings(): string {
  if (state.standings.length === 0) {
    return `<div class="empty-state">Standings appear as the season simulates.</div>`;
  }
  const maxWins = Math.max(...state.standings.map((standing) => standing.wins), 1);
  return `
    <div class="standings">
      ${state.standings.map((standing, index) => {
        const team = state.teams.find((item) => item.id === standing.teamId);
        const width = Math.max(4, (standing.wins / maxWins) * 100);
        return `
          <button class="standing ${standing.teamId === state.selectedTeamId ? "active" : ""}" data-team="${standing.teamId}">
            <span>${index + 1}. ${team?.name ?? "Team"}</span>
            <b>${standing.wins}-${standing.losses}</b>
            <i style="width:${width}%"></i>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderSummary(): string {
  const team = state.teams.find((item) => item.id === state.selectedTeamId) ?? state.teams.find((item) => item.isUser);
  if (!team) return `<div class="empty-state">Pick a team after simulation.</div>`;
  const standing = state.standings.find((item) => item.teamId === team.id);
  return `
    <div class="summary">
      <h3>${team.name}</h3>
      <p>${standing ? `${standing.wins}-${standing.losses} | ${avg(standing.pointsFor, standing)} PF | ${avg(standing.pointsAgainst, standing)} PA` : "Season not simulated yet."}</p>
      <div class="mini-roster">
        ${POSITIONS.map((slot) => {
          const player = team.roster[slot];
          return `<div><b>${slot}</b><span>${player ? `${player.seasonYear} ${player.fullName} (${player.normalizedRating})` : "Empty"}</span></div>`;
        }).join("")}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers for display
// ---------------------------------------------------------------------------

/** Return stats scaled to per-36 minutes if statsMode is p36, otherwise per-game. */
function displayStats(player: Player): typeof player.stats {
  if (state.statsMode === "pg") return player.stats;
  const rp = player as unknown as import("./nbaLoader").RealPlayer;
  const mpg = rp.mpg ?? 0;
  if (mpg <= 0) return player.stats;
  const scale = 36 / mpg;
  const s = player.stats;
  const rd = (v: number) => Math.round(v * scale * 10) / 10;
  return {
    pts:     rd(s.pts),
    threes:  rd(s.threes),
    threepa: rd(s.threepa),
    fga:     rd(s.fga),
    fgm:     rd(s.fgm),
    fta:     rd(s.fta),
    ftm:     rd(s.ftm),
    orb:     rd(s.orb),
    drb:     rd(s.drb),
    reb:     rd(s.reb),
    ast:     rd(s.ast),
    stl:     rd(s.stl),
    blk:     rd(s.blk),
    tov:     rd(s.tov),
  };
}

/** Convert a season-end year to "YY-YY" display.  2010 → "09-10" */
function seasonLabel(year: number): string {
  const end = String(year).slice(2);
  const start = String(year - 1).slice(2);
  return `${start}-${end}`;
}

/** Return the 3-letter team abbreviation for a player, if real data is attached. */
function teamAbbrForPlayer(player: Player): string {
  const rp = player as unknown as RealPlayer;
  if (rp.teamKey) return teamAbbr(rp.teamKey);
  return "—";
}

// ---------------------------------------------------------------------------
// Data inspector view — all players across all tiers, sortable
// ---------------------------------------------------------------------------

type DataSortKey = SortKey | "tier";
let dataSortKey: DataSortKey = "normalizedRating";
let dataSortDir: "asc" | "desc" = "desc";
let dataTierFilter: number | "ALL" = "ALL";
let dataPosFilter: Position | "ALL" = "ALL";

function renderDataView(): string {
  if (!isNBADataLoaded()) {
    return `<div class="panel draft-panel"><div class="empty-state">NBA data not loaded yet.</div></div>`;
  }

  // Collect all players from all tiers via the draft pool builder
  // We access the internal index via a re-export trick — instead just pull from
  // the draft pool across all tiers using buildRealTierPool with perBucket=999
  // to grab everyone.  Simpler: import getAllRealPlayers from nbaLoader.
  // For now call the exported accessor.
  const allPlayers = getAllDataPlayers();

  let filtered = allPlayers;
  if (dataTierFilter !== "ALL") filtered = filtered.filter((p) => (p as any)._tier === dataTierFilter);
  if (dataPosFilter !== "ALL") filtered = filtered.filter((p) => p.positions.includes(dataPosFilter as Position));

  const dir = dataSortDir === "asc" ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (dataSortKey === "tier") {
      av = (a as any)._tier ?? 0;
      bv = (b as any)._tier ?? 0;
    } else if (dataSortKey === "positions") {
      av = a.positions.join("/");
      bv = b.positions.join("/");
    } else if (dataSortKey in (a.stats ?? {})) {
      av = a.stats[dataSortKey as keyof typeof a.stats];
      bv = b.stats[dataSortKey as keyof typeof b.stats];
    } else {
      av = (a as any)[dataSortKey] ?? "";
      bv = (b as any)[dataSortKey] ?? "";
    }
    if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
    return (Number(av) - Number(bv)) * dir;
  });

  function dh(key: DataSortKey, label: string): string {
    const active = dataSortKey === key;
    const arrow = active ? (dataSortDir === "desc" ? " ▼" : " ▲") : "";
    return `<th><button class="sort-btn ${active ? "sort-active" : ""}" data-data-sort="${key}">${label}${arrow}</button></th>`;
  }

  const TIER_NAMES = ["JV", "Varsity", "College", "G League", "NBA"];

  return `
    <div class="panel draft-panel data-view-panel">
      <div class="panel-head">
        <h2>All Players <span class="data-count">(${filtered.length.toLocaleString()})</span></h2>
        <div class="panel-controls">
          <div class="filters">
            ${(["ALL", 4, 3, 2, 1, 0] as (number | "ALL")[]).map((t) =>
              `<button class="filter ${dataTierFilter === t ? "active" : ""}" data-data-tier="${t}">${t === "ALL" ? "ALL" : TIER_NAMES[t as number]}</button>`
            ).join("")}
          </div>
          <div class="filters">
            ${(["ALL", ...POSITIONS] as (Position | "ALL")[]).map((p) =>
              `<button class="filter ${dataPosFilter === p ? "active" : ""}" data-data-pos="${p}">${p}</button>`
            ).join("")}
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${dh("fullName", "Player")}
              ${dh("seasonYear", "Year")}
              <th>Team</th>
              ${dh("tier", "Tier")}
              ${dh("positions", "Pos")}
              ${dh("cost", "Cost")}
              ${dh("normalizedRating", "OVR")}
              ${dh("pts", "PTS")}
              ${dh("threes", "3PM")}
              ${dh("fga", "FGA")}
              ${dh("fgm", "FGM")}
              ${dh("fta", "FTA")}
              ${dh("ftm", "FTM")}
              ${dh("reb", "REB")}
              ${dh("ast", "AST")}
              ${dh("stl", "STL")}
              ${dh("blk", "BLK")}
              ${dh("tov", "TOV")}
            </tr>
          </thead>
          <tbody>
            ${filtered.map((p) => {
              const tier = (p as any)._tier ?? "?";
              return `<tr>
                <td><b>${p.fullName}</b></td>
                <td>${seasonLabel(p.seasonYear)}</td>
                <td>${teamAbbrForPlayer(p)}</td>
                <td>${TIER_NAMES[tier as number] ?? tier}</td>
                <td>${p.positions.join("/")}</td>
                <td>${p.cost}</td>
                <td>${p.normalizedRating}</td>
                <td>${p.stats.pts}</td>
                <td>${p.stats.threes}</td>
                <td>${p.stats.fga}</td>
                <td>${p.stats.fgm}</td>
                <td>${p.stats.fta}</td>
                <td>${p.stats.ftm}</td>
                <td>${p.stats.reb}</td>
                <td>${p.stats.ast}</td>
                <td>${p.stats.stl}</td>
                <td>${p.stats.blk}</td>
                <td>${p.stats.tov}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function wireEvents(): void {
  document.querySelector("#restart-same")?.addEventListener("click", () => {
    state = newGame(state.seed);
    setSeedParam(state.seed);
    render();
  });
  document.querySelector("#restart-new")?.addEventListener("click", () => {
    const seed = Math.random().toString(36).slice(2, 10).toUpperCase();
    state = newGame(seed);
    setSeedParam(seed);
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter as Position | "ALL";
      render();
    });
  });
  document.querySelector("#stats-pg-btn")?.addEventListener("click", () => {
    state.statsMode = "pg";
    render();
  });
  document.querySelector("#stats-p36-btn")?.addEventListener("click", () => {
    state.statsMode = "p36";
    render();
  });
  document.querySelector("#draft-simple-btn")?.addEventListener("click", () => {
    state.draftViewMode = "simple";
    render();
  });
  document.querySelector("#draft-advanced-btn")?.addEventListener("click", () => {
    state.draftViewMode = "advanced";
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-cost-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = Number(btn.dataset.costFilter);
      const idx = state.costFilter.indexOf(c);
      if (idx >= 0) state.costFilter.splice(idx, 1);
      else state.costFilter.push(c);
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort as SortKey;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDirection = key === "fullName" ? "asc" : "desc";
      }
      render();
    });
  });
  document.querySelectorAll<HTMLSelectElement>("[data-player]").forEach((select) => {
    select.addEventListener("change", () => {
      if (!select.value) return;
      draftPlayer(select.dataset.player!, select.value as Position);
    });
  });
  document.querySelectorAll<HTMLTableRowElement>("[data-select-player]").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.selectPlayer!;
      state.selectedPlayerId = state.selectedPlayerId === id ? null : id;
      state.selectedRosterSlot = null;  // clear roster selection when picking from pool
      render();
    });
  });
  document.querySelectorAll<HTMLDivElement>("[data-slot-click]").forEach((slotEl) => {
    slotEl.addEventListener("click", (e) => {
      // Don't intercept clicks on inner buttons (clear, discount, age-up)
      if ((e.target as HTMLElement).closest("button")) return;
      const slot = slotEl.dataset.slotClick as Position;
      const selectedPlayer = state.selectedPlayerId ? state.draftPool.find((p) => p.id === state.selectedPlayerId) : null;
      if (selectedPlayer && selectedPlayer.positions.includes(slot) && state.draftMode !== "complete") {
        // Assign selected pool player to this slot
        state.selectedPlayerId = null;
        state.selectedRosterSlot = null;
        draftPlayer(selectedPlayer.id, slot);
      } else {
        // Select whoever is in this slot to show their stats
        const pick = state.pendingPicks.find((item) => item.slot === slot);
        const existingPlayer = pick?.player ?? state.userRoster[slot];
        if (existingPlayer) {
          const alreadySelected = state.selectedRosterSlot === slot;
          state.selectedRosterSlot = alreadySelected ? null : slot;
          state.selectedPlayerId = null;
          render();
        }
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-age-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = btn.dataset.ageUp as Position;
      const rosterPlayer = state.userRoster[slot] as unknown as RealPlayer;
      if (!rosterPlayer || state.ageUpUsed) return;
      const next = getNextSeasonPlayer(rosterPlayer, rosterPlayer.cost);
      if (!next) return;
      state.userRoster[slot] = next as unknown as Player;
      state.ageUpUsed = true;
      state.selectedRosterSlot = slot;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-clear-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pendingPicks = state.pendingPicks.filter((pick) => pick.slot !== button.dataset.clearSlot);
      state.selectedPlayerId = null;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-toggle-discount]").forEach((button) => {
    button.addEventListener("click", () => toggleDiscount(button.dataset.toggleDiscount as Position));
  });
  document.querySelector("#submit-draft")?.addEventListener("click", submitDraft);
  const multInput = document.querySelector<HTMLInputElement>("#multiplier");
  multInput?.addEventListener("input", () => {
    const v = parseFloat(multInput.value);
    if (!isNaN(v) && v >= 0) state.multiplier = v;
  });
  document.querySelector("#next-season")?.addEventListener("click", () => {
    state.viewMode = "draft";
    render();
  });
  document.querySelector("#toggle-data-view")?.addEventListener("click", () => {
    window.open("./data.html", "_blank");
  });
  document.querySelector("#close-result")?.addEventListener("click", () => {
    state.pendingResult = null;
    render();
  });
  document.querySelector("#continue-to-draft")?.addEventListener("click", () => {
    state.pendingResult = null;
    state.viewMode = "draft";
    render();
  });
  document.querySelector("#champ-restart-same")?.addEventListener("click", () => {
    state = newGame(state.seed);
    setSeedParam(state.seed);
    render();
  });
  document.querySelector("#champ-restart-new")?.addEventListener("click", () => {
    const seed = Math.random().toString(36).slice(2, 10).toUpperCase();
    state = newGame(seed);
    setSeedParam(seed);
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-team]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.team!;
      // If standings view and we have box stats, open popup; always update selected
      if (state.viewMode === "standings" && state.seasonBoxStats) {
        state.teamPopupId = state.teamPopupId === id ? null : id;
      }
      state.selectedTeamId = id;
      render();
    });
  });
  document.querySelector("#close-team-popup")?.addEventListener("click", () => {
    state.teamPopupId = null;
    render();
  });
  document.querySelector("#team-popup-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) { state.teamPopupId = null; render(); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.dataSort as DataSortKey;
      if (dataSortKey === key) dataSortDir = dataSortDir === "asc" ? "desc" : "asc";
      else { dataSortKey = key; dataSortDir = key === "fullName" ? "asc" : "desc"; }
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-data-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.dataTier!;
      dataTierFilter = v === "ALL" ? "ALL" : Number(v);
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-data-pos]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dataPosFilter = btn.dataset.dataPos as Position | "ALL";
      render();
    });
  });
}

function draftPlayer(playerId: string, slot: Position): void {
  const player = state.draftPool.find((item) => item.id === playerId);
  if (!player || !player.positions.includes(slot)) return;
  state.pendingPicks = state.pendingPicks.filter((pick) => pick.slot !== slot && pick.player.id !== player.id);
  state.pendingPicks.push({ slot, player, discount: 0 });
  render();
}

function toggleDiscount(slot: Position): void {
  state.pendingPicks = state.pendingPicks.map((pick) => {
    if (pick.slot !== slot) return pick;
    if (pick.discount > 0) return { ...pick, discount: 0 };
    const usedOther = state.pendingPicks.filter((p) => p.slot !== slot).reduce((t, p) => t + p.discount, 0);
    if (usedOther < state.discountPoints && pick.player.cost > 0) return { ...pick, discount: 1 };
    return pick;
  });
  render();
}

function canAddDiscount(slot: Position): boolean {
  const pick = state.pendingPicks.find((item) => item.slot === slot);
  if (!pick) return false;
  const used = state.pendingPicks.reduce((total, item) => total + item.discount, 0);
  return pick.discount < 1 && used < state.discountPoints && pick.player.cost - pick.discount > 0;
}

function canSubmitDraft(): boolean {
  if (state.isSimulating || state.completed || state.draftMode === "complete") return false;
  if (state.draftMode === "initial" && state.pendingPicks.length !== 5) return false;
  return effectiveRosterCost() <= state.budget && POSITIONS.every((slot) => projectedRoster()[slot]);
}

function submitDraft(): void {
  if (!canSubmitDraft()) return;
  state.userRoster = projectedRoster();
  state.draftPool = state.draftPool.filter((player) => !state.pendingPicks.some((pick) => pick.player.id === player.id));
  if (state.draftMode === "initial") {
    createInitialTeams();
  } else {
    const userTeam = state.teams.find((team) => team.isUser);
    if (userTeam) userTeam.roster = state.userRoster;
  }
  state.pendingPicks = [];
  state.discountPoints = 0;
  state.draftMode = "complete";
  state.status = "Simulating season...";
  render();
  runSimulation();
}

function createInitialTeams(): void {
  const league = LEAGUES[state.leagueIndex];
  const cpuTeams = pickCpuTeams(state.leagueIndex, league.teams - 1, state.rng, state.draftPool);
  state.teams = [{ id: "user", name: "Your Team", isUser: true, roster: state.userRoster }, ...cpuTeams];
}

function autoRoster(pool: Player[], budget: number, rng: Rng): Roster {
  const attemptPool = [...pool];
  for (let attempt = 0; attempt < 700; attempt += 1) {
    const roster = buildUniqueRoster(attemptPool, budget, rng);
    if (!roster) continue;
    consumeRosterPlayers(pool, roster);
    return roster;
  }

  const fallback = buildFallbackRoster(attemptPool, budget);
  consumeRosterPlayers(pool, fallback);
  return fallback;
}

function buildUniqueRoster(pool: Player[], budget: number, rng: Rng): Roster | null {
  const available = rng.shuffle(pool);
  const roster = emptyRoster();
  let spent = 0;

  for (const slot of POSITIONS) {
    const candidates = available.filter((player) => player.positions.includes(slot));
    const affordable = candidates.filter((player) => spent + player.cost <= budget);
    const pick = affordable[0] ?? candidates[0];
    if (!pick) return null;
    roster[slot] = pick;
    spent += pick.cost;
    available.splice(available.findIndex((player) => player.id === pick.id), 1);
  }

  return spent <= budget ? roster : null;
}

function buildFallbackRoster(pool: Player[], budget: number): Roster {
  const available = [...pool];
  const roster = emptyRoster();
  let spent = 0;

  for (const slot of POSITIONS) {
    const candidates = available
      .filter((player) => player.positions.includes(slot))
      .sort((a, b) => a.cost - b.cost || b.normalizedRating - a.normalizedRating);
    const affordable = candidates.find((player) => spent + player.cost <= budget);
    const pick = affordable ?? candidates[0] ?? null;
    if (!pick) continue;
    roster[slot] = pick;
    spent += pick.cost;
    available.splice(available.findIndex((player) => player.id === pick.id), 1);
  }

  return roster;
}

function consumeRosterPlayers(pool: Player[], roster: Roster): void {
  for (const player of Object.values(roster)) {
    if (!player) continue;
    const index = pool.findIndex((candidate) => candidate.id === player.id);
    if (index >= 0) pool.splice(index, 1);
  }
}

async function runSimulation(): Promise<void> {
  if (state.draftMode !== "complete" || state.isSimulating) return;
  state.isSimulating = true;
  state.viewMode = "standings";
  state.status = "Simulating 82 games per team...";
  render();
  const { standings, boxStats } = await simulateSeasonPossession(
    state.teams,
    state.rng.fork(`season-${state.seasonYear}`),
    state.multiplier,
    (progress) => {
      state.standings = progress.standings;
      state.status = `Simulating ${progress.gamesPlayed}/${progress.totalGames} games...`;
      render();
    }
  );
  state.standings = standings;
  state.seasonBoxStats = boxStats;
  finishSeason();
  render();
}

function finishSeason(): void {
  state.isSimulating = false;
  const rank = rankForTeam("user") ?? LEAGUES[state.leagueIndex].teams;
  const totalTeams = LEAGUES[state.leagueIndex].teams;
  const userStanding = state.standings.find((s) => s.teamId === "user");

  const isChampion = state.leagueIndex === LEAGUES.length - 1 && rank === 1;
  const outcome: SeasonRecord["outcome"] = isChampion
    ? "champion"
    : rank <= 4
    ? "promoted"
    : rank > totalTeams - 4 && state.leagueIndex > 0
    ? "demoted"
    : "stayed";

  const record: SeasonRecord = {
    year: state.seasonYear,
    leagueName: LEAGUES[state.leagueIndex].name,
    leagueIndex: state.leagueIndex,
    wins: userStanding?.wins ?? 0,
    losses: userStanding?.losses ?? 0,
    rank,
    totalTeams,
    outcome,
    roster: { ...state.userRoster },
  };
  state.seasonHistory.push(record);
  state.pendingResult = record;
  state.lastRecord = { wins: record.wins, losses: record.losses };

  if (isChampion) {
    state.completed = true;
    state.status = `Championship won in ${state.seasonYear} seasons.`;
    return;
  }

  state.discountPoints = rank === 1 ? 2 : rank === 2 ? 1 : 0;
  // Budget: +1 every season, +1 extra on promotion, never goes down
  const promoted = outcome === "promoted";
  state.budget = Math.min(25, state.budget + 1 + (promoted ? 1 : 0));
  const oldLeague = state.leagueIndex;
  if (promoted) state.leagueIndex = Math.min(LEAGUES.length - 1, state.leagueIndex + 1);
  else if (outcome === "demoted") state.leagueIndex = Math.max(0, state.leagueIndex - 1);
  const changedLeague = oldLeague !== state.leagueIndex;
  state.seasonYear += 1;
  state.draftMode = "freeAgency";
  state.ageUpUsed = false;
  // Fork the rng by season/league so each free agency draws from a fresh shuffle
  // of the full player pool — prevents the same players showing every season.
  state.draftPool = buildTierPool(state.leagueIndex, state.rng.fork(`fa-${state.leagueIndex}-${state.seasonYear}`), 999);
  state.pendingPicks = [];
  state.status = `${outcome === "promoted" ? "Promoted" : outcome === "demoted" ? "Demoted" : "Stayed put"} in ${LEAGUES[state.leagueIndex].name}. Sign new players or keep your roster.`;
  if (changedLeague) updateCpuRosters();
}

function updateCpuRosters(): void {
  const league = LEAGUES[state.leagueIndex];
  const cpuTeams = pickCpuTeams(state.leagueIndex, league.teams - 1, state.rng, state.draftPool);
  state.teams = [{ id: "user", name: "Your Team", isUser: true, roster: state.userRoster }, ...cpuTeams];
  state.selectedTeamId = "user";
}

function projectedRoster(): Roster {
  const roster = { ...state.userRoster };
  for (const pick of state.pendingPicks) roster[pick.slot] = pick.player;
  return roster;
}

function effectiveRosterCost(): number {
  const roster = projectedRoster();
  const discountsByPlayer = new Map(state.pendingPicks.map((pick) => [pick.player.id, pick.discount]));
  return Object.values(roster).reduce((total, player) => {
    if (!player) return total;
    return total + Math.max(0, player.cost - (discountsByPlayer.get(player.id) ?? 0));
  }, 0);
}

function sortedPlayers(): Player[] {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return [...state.draftPool].sort((a, b) => {
    const av = valueForSort(a, state.sortKey);
    const bv = valueForSort(b, state.sortKey);
    if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * direction;
    return (Number(av) - Number(bv)) * direction;
  });
}

function valueForSort(player: Player, key: SortKey): string | number {
  if (key === "positions") return player.positions.join("/");
  if (key in player.stats) return player.stats[key as keyof Player["stats"]];
  return player[key as keyof Player] as string | number;
}

function draftRuleText(): string {
  if (state.draftMode === "initial") return "Opening free agency: select exactly 5 players, one per slot. Costs must fit the budget.";
  if (state.draftMode === "freeAgency") return "Free agency: keep your roster or swap any players. Max 1 discount per pick; unused discounts disappear.";
  return "Season roster is locked.";
}

function renderSeasonResultOverlay(record: SeasonRecord): string {
  const medal = record.rank === 1 ? "🥇" : record.rank === 2 ? "🥈" : "";
  const outcomeMap: Record<SeasonRecord["outcome"], string> = {
    promoted: "⬆ PROMOTED",
    demoted: "⬇ DEMOTED",
    stayed: "— STAYED",
    champion: "🏆 CHAMPION",
  };
  const outcomeLabel = outcomeMap[record.outcome];
  return `
    <div class="overlay-backdrop" id="season-result-overlay">
      <div class="result-card">
        <div class="result-header">
          <span class="result-league-badge">${record.leagueName}</span>
          <span class="result-season-label">Season ${record.year}</span>
        </div>
        <div class="result-record">${record.wins}–${record.losses}</div>
        <div class="result-rank">${medal} #${record.rank} <span class="result-rank-of">of ${record.totalTeams}</span></div>
        <div class="result-outcome outcome-${record.outcome}">${outcomeLabel}</div>
        <button class="result-continue" id="close-result">Close</button>
      </div>
    </div>
  `;
}

function renderTeamPopup(teamId: string): string {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return "";
  const standing = state.standings.find((s) => s.teamId === teamId);
  const lines = state.seasonBoxStats?.get(teamId) ?? [];

  const pct = (m: number, a: number) => a > 0 ? (m / a * 100).toFixed(1) + "%" : "—";
  const pg  = (v: number, gp: number) => gp > 0 ? (v / gp).toFixed(1) : "0.0";

  const rows = lines
    .filter((l) => l.gp > 0)
    .sort((a, b) => b.pts - a.pts)
    .map((l) => `
      <tr>
        <td class="pop-name">${l.fullName}</td>
        <td>${l.gp}</td>
        <td class="pop-pts">${pg(l.pts, l.gp)}</td>
        <td>${pg(l.fgm, l.gp)}-${pg(l.fga, l.gp)}</td>
        <td class="pop-dim">${pct(l.fgm, l.fga)}</td>
        <td>${pg(l.fgm3, l.gp)}-${pg(l.fga3, l.gp)}</td>
        <td class="pop-dim">${pct(l.fgm3, l.fga3)}</td>
        <td>${pg(l.ftm, l.gp)}-${pg(l.fta, l.gp)}</td>
        <td class="pop-dim">${pct(l.ftm, l.fta)}</td>
        <td>${pg(l.orb + l.drb, l.gp)}</td>
        <td>${pg(l.ast, l.gp)}</td>
        <td>${pg(l.stl, l.gp)}</td>
        <td>${pg(l.blk, l.gp)}</td>
        <td class="pop-tov">${pg(l.tov, l.gp)}</td>
      </tr>
    `).join("");

  const totGP  = Math.max(...lines.map((l) => l.gp), 1);
  const tot    = lines.reduce((acc, l) => ({
    pts: acc.pts + l.pts, fgm: acc.fgm + l.fgm, fga: acc.fga + l.fga,
    fgm3: acc.fgm3 + l.fgm3, fga3: acc.fga3 + l.fga3,
    ftm: acc.ftm + l.ftm, fta: acc.fta + l.fta,
    orb: acc.orb + l.orb, drb: acc.drb + l.drb,
    ast: acc.ast + l.ast, stl: acc.stl + l.stl, blk: acc.blk + l.blk, tov: acc.tov + l.tov,
  }), { pts:0,fgm:0,fga:0,fgm3:0,fga3:0,ftm:0,fta:0,orb:0,drb:0,ast:0,stl:0,blk:0,tov:0 });

  const totRow = `
    <tr class="pop-totals">
      <td>TEAM / G</td>
      <td>${totGP}</td>
      <td class="pop-pts">${pg(tot.pts, totGP)}</td>
      <td>${pg(tot.fgm, totGP)}-${pg(tot.fga, totGP)}</td>
      <td class="pop-dim">${pct(tot.fgm, tot.fga)}</td>
      <td>${pg(tot.fgm3, totGP)}-${pg(tot.fga3, totGP)}</td>
      <td class="pop-dim">${pct(tot.fgm3, tot.fga3)}</td>
      <td>${pg(tot.ftm, totGP)}-${pg(tot.fta, totGP)}</td>
      <td class="pop-dim">${pct(tot.ftm, tot.fta)}</td>
      <td>${pg(tot.orb + tot.drb, totGP)}</td>
      <td>${pg(tot.ast, totGP)}</td>
      <td>${pg(tot.stl, totGP)}</td>
      <td>${pg(tot.blk, totGP)}</td>
      <td class="pop-tov">${pg(tot.tov, totGP)}</td>
    </tr>
  `;

  return `
    <div class="team-popup-backdrop" id="team-popup-backdrop">
      <div class="team-popup">
        <div class="team-popup-header">
          <div>
            <div class="team-popup-name">${team.name}</div>
            ${standing ? `<div class="team-popup-record">${standing.wins}–${standing.losses} · ${avg(standing.pointsFor, standing)} PPG · ${avg(standing.pointsAgainst, standing)} OPP</div>` : ""}
          </div>
          <button class="team-popup-close" id="close-team-popup">✕</button>
        </div>
        <div class="team-popup-body">
          <div class="pop-table-wrap">
            <table class="pop-table">
              <thead>
                <tr>
                  <th>Player</th><th>GP</th><th>PTS</th>
                  <th>FG</th><th>FG%</th>
                  <th>3PT</th><th>3P%</th>
                  <th>FT</th><th>FT%</th>
                  <th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th>
                </tr>
              </thead>
              <tbody>${rows}${totRow}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderChampionshipOverlay(): string {  const totalWins = state.seasonHistory.reduce((t, r) => t + r.wins, 0);
  const totalLosses = state.seasonHistory.reduce((t, r) => t + r.losses, 0);
  const goldCount = state.seasonHistory.filter((r) => r.rank === 1 && r.outcome !== "champion").length;
  const silverCount = state.seasonHistory.filter((r) => r.rank === 2).length;
  const finalRoster = state.seasonHistory[state.seasonHistory.length - 1]?.roster ?? state.userRoster;

  return `
    <div class="overlay-backdrop overlay-champion">
      <div class="champion-screen">
        <div class="champion-header">
          <div class="champion-trophy">🏆</div>
          <h1>CHAMPION</h1>
          <p class="champion-subtitle">Completed in ${state.seasonHistory.length} season${state.seasonHistory.length !== 1 ? "s" : ""}</p>
        </div>

        <div class="champion-stats">
          <div class="champion-stat"><span>${totalWins}–${totalLosses}</span><label>All-Time Record</label></div>
          <div class="champion-stat"><span>${state.seasonHistory.length}</span><label>Seasons</label></div>
          ${goldCount > 0 ? `<div class="champion-stat"><span>🥇 ×${goldCount}</span><label>Gold Seasons</label></div>` : ""}
          ${silverCount > 0 ? `<div class="champion-stat"><span>🥈 ×${silverCount}</span><label>Silver Seasons</label></div>` : ""}
        </div>

        <div class="champion-timeline-wrap">
          <h2>Season Timeline</h2>
          <div class="champion-timeline">
            ${state.seasonHistory.map((r) => {
              const medal = r.rank === 1 && r.outcome !== "champion" ? "🥇" : r.rank === 2 ? "🥈" : "";
              const outcomeMap: Record<SeasonRecord["outcome"], string> = {
                promoted: "⬆ Promoted",
                demoted: "⬇ Demoted",
                stayed: "— Stayed",
                champion: "🏆 Champion",
              };
              return `
                <div class="timeline-row outcome-${r.outcome}">
                  <span class="tl-season">S${r.year}</span>
                  <span class="tl-league">${r.leagueName}</span>
                  <span class="tl-record">${r.wins}–${r.losses}</span>
                  <span class="tl-rank">${medal}${r.rank}/${r.totalTeams}</span>
                  <span class="tl-outcome">${outcomeMap[r.outcome]}</span>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <div class="champion-roster-wrap">
          <h2>Championship Roster</h2>
          <div class="champion-roster">
            ${POSITIONS.map((slot) => {
              const player = finalRoster[slot];
              return `<div class="champion-slot">
                <b>${slot}</b>
                <span>${player ? `${player.seasonYear} ${player.fullName}` : "Empty"}</span>
                <em>${player ? `${player.normalizedRating} OVR` : ""}</em>
              </div>`;
            }).join("")}
          </div>
        </div>

        <div class="champion-actions">
          <button id="champ-restart-same">↩ Restart Same Seed</button>
          <button id="champ-restart-new">✦ New Seed</button>
        </div>
      </div>
    </div>
  `;
}

function rankForTeam(teamId: string): number | null {
  const index = state.standings.findIndex((standing) => standing.teamId === teamId);
  return index >= 0 ? index + 1 : null;
}

function avg(total: number, standing: Standing): string {
  return (total / Math.max(1, standing.wins + standing.losses)).toFixed(1);
}

function setSeedParam(seed: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState(null, "", url);
}

// ---------------------------------------------------------------------------
// Async bootstrap — load NBA data first, then start the game
// ---------------------------------------------------------------------------

(async () => {
  // Show a loading state while JSON is being fetched
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) {
    app.innerHTML = `<main class="shell"><section class="topbar"><div><h1>Ball Knowledge</h1><p>Loading NBA data…</p></div></section></main>`;
  }

  try {
    await loadNBAData();
  } catch (err) {
    console.warn("Could not load NBA data, using synthetic fallback:", err);
  }

  // Re-build initial draft pool now that real data is available
  state.draftPool = buildTierPool(state.leagueIndex, state.rng.fork(`fa-${state.leagueIndex}-${state.seasonYear}`), 999);

  render();
})();
