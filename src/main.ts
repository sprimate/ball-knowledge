import "./styles.css";
import { LEAGUES, POSITIONS, emptyRoster, generatePlayers, rosterCost, buildTierPool, pickCpuTeams } from "./data";
import { loadNBAData, teamAbbr, isNBADataLoaded, getAllDataPlayers, RealPlayer, getNextSeasonPlayer, getTierWinPctRanges } from "./nbaLoader";
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
  agedUpSlots: Set<Position>;   // slots that have been aged up this free agency period
  pendingLeagueChange: boolean;
  showOvr: boolean;
  maxHandicap: number;
  championOverlayDismissed: boolean;
  helpOpen: boolean;
  helpPage: 1 | 2 | 3;
  timerStartWall: number;
  timerPausedMs: number;
  timerPauseStartWall: number | null;
  timerFinalMs: number | null;
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
    status: "Pick exactly 5 players and fit the G-League budget.",
    isSimulating: false,
    completed: false,
    viewMode: "draft",
    draftViewMode: "simple",
    statsMode: "pg",
    costFilter: [],
    multiplier: 0,
    selectedPlayerId: null,
    seasonHistory: [],
    pendingResult: null,
    lastRecord: null,
    seasonBoxStats: null,
    teamPopupId: null,
    ageUpUsed: false,
    selectedRosterSlot: null,
    agedUpSlots: new Set<Position>(),
    pendingLeagueChange: false,
    showOvr: localStorage.getItem("showOvr") === "1",
    maxHandicap: 0,
    championOverlayDismissed: false,
    helpOpen: localStorage.getItem("helpSeen") !== "1",
    helpPage: 1 as 1 | 2 | 3,
    timerStartWall: Date.now(),
    timerPausedMs: 0,
    timerPauseStartWall: localStorage.getItem("helpSeen") !== "1" ? Date.now() : null,
    timerFinalMs: null,
  };
}

function seedFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("seed") || Math.random().toString(36).slice(2, 10).toUpperCase();
}

const TIMER_MAX_MS = 999 * 60000 + 59000;

function getTimerMs(): number {
  const pauseActive = state.timerPauseStartWall != null ? Date.now() - state.timerPauseStartWall : 0;
  const elapsed = Date.now() - state.timerStartWall - state.timerPausedMs - pauseActive;
  return Math.min(Math.max(elapsed, 0), TIMER_MAX_MS);
}

function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.min(Math.floor(totalSec / 60), 999);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
          <p>${state.completed ? `GOAT status achieved in ${state.seasonYear - 1} seasons.` : state.status}</p>
        </div>
        <div class="meta">
          <span id="timer-display" class="timer-display">${formatTimer(getTimerMs())}</span>
          <span>Seed <b>${state.seed}</b></span>
          <label class="multiplier-label">Handicap <input id="multiplier" type="number" value="${state.multiplier}" step="1" min="0" /></label>
          <label class="multiplier-label"><input id="show-ovr" type="checkbox" ${state.showOvr ? "checked" : ""} /> Show OVR</label>
        </div>
        <div class="actions">
          <a id="restart-same" class="btn" href="?seed=${state.seed}">Restart Same</a>
          <a id="restart-new" class="btn" href="${location.pathname}">New Seed</a>
          <button id="help-btn" class="help-btn" title="How to play">?</button>
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
              ${(() => {
                const used = state.pendingPicks.reduce((t, p) => t + p.discount, 0);
                const available = state.discountPoints - used;
                return state.discountPoints > 0 ? `<span class="budget-badge">Discounts ${available}/${state.discountPoints}</span>` : "";
              })()}
              ${userRank ? `<span class="budget-badge">Rank ${userRank}/${LEAGUES[state.leagueIndex].teams}</span>` : ""}
              ${state.lastRecord ? `<span class="budget-badge">Record ${state.lastRecord.wins}\u2013${state.lastRecord.losses}</span>` : ""}
            </div>
          ${state.viewMode === "draft" ? `<button id="submit-draft" ${canSubmitDraft() ? "" : "disabled"}>Start Season</button>` : ""}
          </div>
          <div class="slots single-row">${POSITIONS.map((slot) => renderSlot(slot)).join("")}</div>
          <div class="rules compact">
            ${draftRuleText()}
            ${(() => { const used = state.pendingPicks.reduce((t, p) => t + p.discount, 0); const available = state.discountPoints - used; return state.discountPoints > 0 ? `<span class="discount-info">Available Discounts: ${available}/${state.discountPoints}</span>` : ""; })()}
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
            <h2>${(() => {
              const pastLeague = state.seasonHistory.length > 0
                ? state.seasonHistory[state.seasonHistory.length - 1].leagueName
                : LEAGUES[state.leagueIndex].name;
              return `${pastLeague} Standings`;
            })()}</h2>
            ${!state.isSimulating && !state.completed && !state.pendingResult && state.viewMode === "standings" ? `<button id="next-season">Free Agency →</button>` : ""}
          </div>
          <div class="standings-wrap">
            ${renderStandings()}
          </div>
        </div>
      </section>
      ${state.completed && !state.championOverlayDismissed ? renderChampionshipOverlay() : state.pendingResult ? renderSeasonResultOverlay(state.pendingResult) : ""}
      ${state.teamPopupId ? renderTeamPopup(state.teamPopupId) : ""}
      ${state.helpOpen ? renderHelpPanel() : ""}
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
    && !state.agedUpSlots.has(slot)     // not already aged up this period
    && !pick                            // no pending replacement for this slot
    && !!rosterPlayer
    && !!rp.bbrefId
    && !!getNextSeasonPlayer(rp, rosterPlayer.cost);

  const isSlotSelected = state.selectedRosterSlot === slot;
  // Show a Replace button when a pool player is selected and can fill this slot
  const canReplace = !!selectedPlayer && selectedPlayer.positions.includes(slot) && state.draftMode !== "complete";

  return `
    <div class="slot ${player ? "slot-occupied" : ""} ${isSlotSelected ? "slot-selected" : ""}" data-slot-click="${slot}">
      <div class="slot-title">${slot}</div>
      ${
        player
          ? `<div class="slot-player">
              <b>${seasonLabel(player.seasonYear)} ${player.fullName}${(player as unknown as RealPlayer).age != null ? ` (${(player as unknown as RealPlayer).age})` : ""}</b>
              <span>${player.positions.join("/")}${state.showOvr ? ` | ${player.normalizedRating} OVR` : ""} | ${discount > 0 ? `<span class="slot-cost-original">$${player.cost}</span> <span class="slot-cost-final">$${Math.max(0, player.cost - discount)}</span>` : (() => {
                const nat = (player as any).naturalCost;
                if (nat != null) {
                  const cheaper = player.cost < nat;
                  return `<span class="slot-cost-original">$${nat}</span> <span class="slot-cost-final ${cheaper ? 'cost-green' : 'cost-red'}">$${player.cost}</span>`;
                }
                return `<span class="slot-cost-final">$${player.cost}</span>`;
              })()}</span>
              <div class="discount-row">
                ${pick && showDiscountToggle ? `<button data-toggle-discount="${slot}">${discount > 0 ? "Remove Discount" : "Apply Discount"}</button>` : ""}
                ${pick ? `<button data-clear-slot="${slot}">${willReset ? "Reset" : "Clear"}</button>` : ""}
                ${canReplace ? `<button data-replace-slot="${slot}" class="replace-btn">Replace</button>` : ""}
                ${canAgeUp ? `<button data-age-up="${slot}" class="age-up-btn">Age Up ➡</button>` : ""}
              </div>
            </div>`
          : `<div class="slot-player slot-empty-assign">
              <span class="empty">Open slot</span>
              ${canReplace ? `<div class="discount-row"><button data-replace-slot="${slot}" class="replace-btn">Assign</button></div>` : ""}
            </div>`
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
      const ovrStr = state.showOvr ? `<span class="sg-ovr">${player.normalizedRating}</span>` : "";
      return `<div class="sg-cell${isSelected ? " sg-selected" : ""}${isAssigned ? " sg-assigned" : ""}" data-select-player="${player.id}"><span class="sg-year">${seasonLabel(player.seasonYear)}${ageStr}</span>${player.fullName}${ovrStr}</div>`;
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

  const TIER_NAMES = ["G-League", "NBA", "All Star", "Hall of Fame", "GOAT"];

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

function renderHelpPanel(): string {
  const p = state.helpPage;
  const page1 = `
    <div class="help-page">
      <h2>How to Play</h2>
      <div class="help-section">
        <h3>🏆 Goal</h3>
        <p>Climb from the bottom league all the way up to the <strong>GOAT</strong> tier and win a championship there — in as few seasons as possible.</p>
      </div>
      <div class="help-section">
        <h3>🏅 Leagues &amp; Promotion</h3>
        <p>There are five leagues: <strong>G-League → NBA → All Star → Hall of Fame → GOAT</strong>. Each season you compete against <strong>real historical NBA teams</strong> drawn from the record books. Finish in the <strong>top 4</strong> to promote to the next league. Finish in the <strong>bottom 4</strong> and you'll be demoted. Win the championship in the GOAT league and the game is complete.</p>
      </div>
      <div class="help-section">
        <h3>💰 Budget</h3>
        <p>Each player has a <strong>cost</strong>. Your roster must fit within your <strong>Budget</strong>. The budget increases as you rise through leagues. Going over budget means you can't start the season — you'll need to swap players.</p>
      </div>
      <div class="help-section">
        <h3>🧩 Free Agency (Picking Players)</h3>
        <p>Before each season, browse the player pool and select a player, then slot them into one of your five roster positions (PG, SG, SF, PF, C). Once all five spots are filled within your budget, you can start the season.</p>
      </div>
      <div class="help-section">
        <h3>📈 Season Results</h3>
        <p>After each season you'll see your record, standing, and any <strong>Budget</strong> or <strong>Discount</strong> rewards earned. Promoting earns +2 budget and discounts. Staying earns +1 budget. Demotion earns nothing.</p>
      </div>
    </div>
  `;
  const page2 = `
    <div class="help-page">
      <h2>Specifics</h2>
      <div class="help-section">
        <h3>⬆️ Age Up</h3>
        <p>Once per offseason, you can <strong>Age Up</strong> a player — advancing them to a later point in their real career. Their cost is locked to whatever it was when you first signed them, so you can end up with a player performing well above their price. The catch: you won't see their updated stats before committing, and there's no guarantee they improve. Careers peak and fade — age someone past their prime and they may come back worse. It's a permanent decision, so use it wisely if you don't know their history.</p>
      </div>
      <div class="help-section">
        <h3>🏷️ Discounts</h3>
        <p>Discounts let you reduce a player's cost by 1 when you sign them during free agency. You earn discounts by finishing <strong>1st or 2nd in any league</strong> at the end of a season. You can apply at most one discount per pick, and once applied the reduced cost is locked in permanently for that player.</p>
      </div>
      <div class="help-section">
        <h3>🎯 Handicap</h3>
        <p>The <strong>Handicap</strong> adds bonus points to your team's score after each simulated game — for win/loss purposes only. It doesn't affect your stats. Use it if you want an easier experience. Your highest handicap used is tracked and shown when you win.</p>
      </div>
      <div class="help-section">
        <h3>👁️ Show OVR</h3>
        <p>Toggling <strong>Show OVR</strong> displays each player's overall rating badge. Useful for quick comparisons without opening the detailed stats view.</p>
      </div>
      <div class="help-section">
        <h3>🔁 Seed</h3>
        <p>Every game run uses a <strong>seed</strong> — a code that determines which players appear and how opposing rosters are built. Use <strong>Restart Same</strong> to replay the exact same run, or <strong>New Seed</strong> for a fresh random game.</p>
      </div>
    </div>
  `;
  const page3 = `
    <div class="help-page">
      <h2>Under the Hood</h2>
      <div class="help-section">
        <h3>🎲 Simulation</h3>
        <p>Each game is simulated possession-by-possession — <strong>75 possessions per side</strong> — in a full round-robin schedule across all teams in the league. Every possession resolves using each player's real statistical profile: shooting percentages, assist rate, turnover rate, rebounding, blocks, steals, and free throw rate all factor into the outcome.</p>
      </div>
      <div class="help-section">
        <h3>⭐ OVR Rating</h3>
        <p>Player ratings are derived from <strong>John Hollinger's Game Score formula</strong>, scaled to a <strong>55–99</strong> range across all player seasons in the database. This gives a single number that reflects a player's overall contribution relative to the full historical pool.</p>
      </div>
      <div class="help-section">
        <h3>📅 Player Pool</h3>
        <p>All players and opposing teams are drawn from <strong>NBA seasons from 1979 onward</strong> — the year the three-point line was introduced. This ensures every team in the database played under the same fundamental rules.</p>
      </div>
      <div class="help-section">
        <h3>🗂️ League Assignment</h3>
        <p>Teams are not randomly distributed across leagues. Every team-season in the database is ranked by historical win percentage and split into five tiers from worst to best. Each season, a random sample of teams is drawn from that tier's pool. The table below shows how many are sampled per league, the estimated pool size, and the win percentage range for each tier.</p>
        ${(() => {
          const ranges = getTierWinPctRanges();
          const rows = LEAGUES.map((l, i) => {
            const r = ranges.get(i);
            const winRange = r ? `${(r.min * 100).toFixed(1)}% \u2013 ${(r.max * 100).toFixed(1)}%` : "\u2014";
            return `<tr><td>${l.name}</td><td>${l.teams} of ~252</td><td>${winRange}</td></tr>`;
          }).join("");
          return `<table class="help-table">
            <thead><tr><th>League</th><th>Sampled / Pool</th><th>Win %</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
        })()}
      </div>
    </div>
  `;

  return `
    <div class="help-backdrop" id="help-backdrop">
      <div class="help-panel">
        <div class="help-header">
          <span class="help-title">Ball Knowledge — Help</span>
          <button class="help-close" id="help-close">✕</button>
        </div>
        <div class="help-body">
          ${p === 1 ? page1 : p === 2 ? page2 : page3}
        </div>
        <div class="help-footer">
          <button class="help-page-btn ${p === 1 ? "active" : ""}" id="help-page-1">1 · Basics</button>
          <button class="help-page-btn ${p === 2 ? "active" : ""}" id="help-page-2">2 · Specifics</button>
          <button class="help-page-btn ${p === 3 ? "active" : ""}" id="help-page-3">3 · Details</button>
          <span class="help-footer-gap"></span>
          <button class="help-done" id="help-done">Got it</button>
        </div>
      </div>
    </div>
  `;
}

function wireEvents(): void {

  // Help panel
  document.querySelector("#help-btn")?.addEventListener("click", () => {
    if (state.timerPauseStartWall == null) {
      state.timerPauseStartWall = Date.now();
    }
    state.helpOpen = true;
    state.helpPage = 1;
    render();
  });
  const closeHelp = () => {
    if (state.timerPauseStartWall != null) {
      state.timerPausedMs += Date.now() - state.timerPauseStartWall;
      state.timerPauseStartWall = null;
    }
    state.helpOpen = false;
    localStorage.setItem("helpSeen", "1");
    render();
  };
  document.querySelector("#help-close")?.addEventListener("click", closeHelp);
  document.querySelector("#help-done")?.addEventListener("click", closeHelp);
  document.querySelector("#help-backdrop")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "help-backdrop") closeHelp();
  });
  document.querySelector("#help-page-1")?.addEventListener("click", () => {
    state.helpPage = 1; render();
  });
  document.querySelector("#help-page-2")?.addEventListener("click", () => {
    state.helpPage = 2; render();
  });
  document.querySelector("#help-page-3")?.addEventListener("click", () => {
    state.helpPage = 3; render();
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
      // Don't intercept clicks on inner buttons (clear, discount, age-up, replace)
      if ((e.target as HTMLElement).closest("button")) return;
      const slot = slotEl.dataset.slotClick as Position;
      const pick = state.pendingPicks.find((item) => item.slot === slot);
      const existingPlayer = pick?.player ?? state.userRoster[slot];
      const selectedPlayer = state.selectedPlayerId ? state.draftPool.find((p) => p.id === state.selectedPlayerId) : null;
      if (!existingPlayer) {
        // Empty slot: do nothing on bare click; use the Assign button instead
      } else if (existingPlayer) {
        // Occupied slot: toggle stat view
        const alreadySelected = state.selectedRosterSlot === slot;
        state.selectedRosterSlot = alreadySelected ? null : slot;
        state.selectedPlayerId = null;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-replace-slot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = btn.dataset.replaceSlot as Position;
      const selectedPlayer = state.selectedPlayerId ? state.draftPool.find((p) => p.id === state.selectedPlayerId) : null;
      if (selectedPlayer && selectedPlayer.positions.includes(slot) && state.draftMode !== "complete") {
        state.selectedPlayerId = null;
        state.selectedRosterSlot = null;
        draftPlayer(selectedPlayer.id, slot);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-age-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = btn.dataset.ageUp as Position;
      const rosterPlayer = state.userRoster[slot] as unknown as RealPlayer;
      if (!rosterPlayer || state.agedUpSlots.has(slot)) return;
      const next = getNextSeasonPlayer(rosterPlayer, rosterPlayer.cost);
      if (!next) return;
      state.userRoster[slot] = next as unknown as Player;
      state.agedUpSlots.add(slot);
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
  document.querySelector<HTMLInputElement>("#show-ovr")?.addEventListener("change", (e) => {
    state.showOvr = (e.target as HTMLInputElement).checked;
    localStorage.setItem("showOvr", state.showOvr ? "1" : "0");
    render();
  });
  document.querySelector("#next-season")?.addEventListener("click", () => {
    if (state.pendingLeagueChange) { updateCpuRosters(); state.pendingLeagueChange = false; }
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
    if (state.pendingLeagueChange) { updateCpuRosters(); state.pendingLeagueChange = false; }
    state.pendingResult = null;
    state.viewMode = "draft";
    render();
  });
  document.querySelector("#tl-roster-toggle")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const rows = document.querySelectorAll<HTMLElement>(".tl-roster-row");
    const showing = btn.dataset.open === "1";
    rows.forEach((r) => { r.style.display = showing ? "none" : "flex"; });
    btn.dataset.open = showing ? "0" : "1";
    btn.textContent = showing ? "Show Rosters ▾" : "Hide Rosters ▴";
  });
  document.querySelector("#champ-close")?.addEventListener("click", () => {
    state.championOverlayDismissed = true;
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
  // Burn any discounts permanently into each player's cost so they persist into future seasons.
  const committedRoster = projectedRoster();
  for (const pick of state.pendingPicks) {
    if (pick.discount > 0) {
      const p = committedRoster[pick.slot];
      if (p) committedRoster[pick.slot] = { ...p, cost: Math.max(0, p.cost - pick.discount) };
    }
  }
  state.userRoster = committedRoster;
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
  if (state.multiplier > state.maxHandicap) state.maxHandicap = state.multiplier;

  if (isChampion) {
    state.completed = true;
    state.status = `GOAT status achieved in ${state.seasonYear} seasons.`;
    state.timerFinalMs = getTimerMs();
    return;
  }

  state.discountPoints = rank === 1 ? 2 : rank === 2 ? 1 : 0;
  // Budget: demoted=+0, stayed=+1, promoted=+2
  const promoted = outcome === "promoted";
  state.budget = Math.min(25, state.budget + (promoted ? 2 : outcome === "demoted" ? 0 : 1));
  const oldLeague = state.leagueIndex;
  if (promoted) state.leagueIndex = Math.min(LEAGUES.length - 1, state.leagueIndex + 1);
  else if (outcome === "demoted") state.leagueIndex = Math.max(0, state.leagueIndex - 1);
  const changedLeague = oldLeague !== state.leagueIndex;
  state.seasonYear += 1;
  state.draftMode = "freeAgency";
  state.agedUpSlots = new Set<Position>();
  state.pendingLeagueChange = changedLeague;
  // Fork the rng by season/league so each free agency draws from a fresh shuffle
  // of the full player pool — prevents the same players showing every season.
  state.draftPool = buildTierPool(state.leagueIndex, state.rng.fork(`fa-${state.leagueIndex}-${state.seasonYear}`), 999);
  state.pendingPicks = [];
  state.status = `${outcome === "promoted" ? "Promoted" : outcome === "demoted" ? "Demoted" : "Stayed put"} in ${LEAGUES[state.leagueIndex].name}. Sign new players or keep your roster.`;
  // updateCpuRosters is deferred to when the user actually enters free agency
  // so that standings team popups still work on the post-season screen.
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
  const budgetGained = record.outcome === "promoted" ? 2 : record.outcome === "demoted" ? 0 : 1;
  const discountsGained = record.rank === 1 ? 2 : record.rank === 2 ? 1 : 0;
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
        <div class="result-rewards">
          <span class="result-reward">Budget +${budgetGained}</span>
          <span class="result-reward">Discounts +${discountsGained}</span>
        </div>
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
    .sort((a, b) => {
      const posOrder: Record<string, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
      const aPos = (state.teams.find((t) => t.id === teamId)?.roster["PG"]?.id === a.playerId ? "PG"
        : state.teams.find((t) => t.id === teamId)?.roster["SG"]?.id === a.playerId ? "SG"
        : state.teams.find((t) => t.id === teamId)?.roster["SF"]?.id === a.playerId ? "SF"
        : state.teams.find((t) => t.id === teamId)?.roster["PF"]?.id === a.playerId ? "PF"
        : state.teams.find((t) => t.id === teamId)?.roster["C"]?.id === a.playerId ? "C" : "C");
      const bPos = (state.teams.find((t) => t.id === teamId)?.roster["PG"]?.id === b.playerId ? "PG"
        : state.teams.find((t) => t.id === teamId)?.roster["SG"]?.id === b.playerId ? "SG"
        : state.teams.find((t) => t.id === teamId)?.roster["SF"]?.id === b.playerId ? "SF"
        : state.teams.find((t) => t.id === teamId)?.roster["PF"]?.id === b.playerId ? "PF"
        : state.teams.find((t) => t.id === teamId)?.roster["C"]?.id === b.playerId ? "C" : "C");
      return (posOrder[aPos] ?? 9) - (posOrder[bPos] ?? 9);
    })
    .map((l) => {
      const team = state.teams.find((t) => t.id === teamId);
      const pos = team ? (POSITIONS.find((p) => team.roster[p]?.id === l.playerId) ?? "—") : "—";
      return `
      <tr>
        <td class="pop-pos">${pos}</td>
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
    `;
    }).join("");

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
      <td></td>
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
                  <th>Pos</th><th>Player</th><th>GP</th><th>PTS</th>
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
          ${state.timerFinalMs != null ? `<div class="champion-stat"><span>${formatTimer(state.timerFinalMs)}</span><label>Time</label></div>` : ""}
          ${state.timerFinalMs != null && state.timerPausedMs >= 1000 ? `<div class="champion-stat champ-stat-dim"><span>${formatTimer(state.timerPausedMs)}</span><label>Paused</label></div>` : ""}
          ${goldCount > 0 ? `<div class="champion-stat"><span>🥇 ×${goldCount}</span><label>Gold Seasons</label></div>` : ""}
          ${silverCount > 0 ? `<div class="champion-stat"><span>🥈 ×${silverCount}</span><label>Silver Seasons</label></div>` : ""}
          ${state.maxHandicap > 0 ? `<div class="champion-stat"><span>+${state.maxHandicap}</span><label>Max Handicap</label></div>` : ""}
        </div>

        <div class="champion-timeline-wrap">
          <div class="tl-header">
            <h2>Season Timeline</h2>
            <button class="tl-toggle" id="tl-roster-toggle">Show Rosters ▾</button>
          </div>
          <div class="champion-timeline" id="champion-timeline">
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
                <div class="timeline-roster tl-roster-row" style="display:none">${POSITIONS.map((slot) => {
                  const p = r.roster[slot];
                  if (!p) return "";
                  const rp = p as unknown as import("./nbaLoader").RealPlayer;
                  const age = rp.age != null ? ` (${rp.age})` : "";
                  const yr = String(p.seasonYear).slice(2) + "-" + String(p.seasonYear + 1).slice(2);
                  return `<span class="tl-rplayer"><b>${slot}</b> ${yr} ${p.fullName}${age} – ${p.normalizedRating} OVR</span>`;
                }).filter(Boolean).join("")}</div>
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
          <button id="champ-close">✕ View Standings</button>
          <a id="champ-restart-same" class="btn" href="?seed=${state.seed}">↩ Restart Same Seed</a>
          <a id="champ-restart-new" class="btn" href="${location.pathname}">✦ New Seed</a>
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

  // Tick timer every second using wall-clock math so tab-switch pauses don't skew it
  setInterval(() => {
    const el = document.querySelector<HTMLElement>("#timer-display");
    if (el) el.textContent = formatTimer(getTimerMs());
  }, 1000);

  render();
})();
