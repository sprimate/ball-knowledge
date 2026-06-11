/**
 * bracketSimulator.ts  —  Single-elimination bracket tournament simulator.
 *
 * Flow:
 *   1. Choose bracket size (2 / 4 / 8 / 16 teams).
 *   2. Click each seed slot to assign a team (franchise + year dropdowns).
 *   3. Optionally use Random Fill (with tier/league filters).
 *   4. Set Best-of-N per round (must be odd).
 *   5. Click Simulate → runs every series, advances winners, shows results.
 */

import { loadNBAData, getAllRealTeams, getTeamLineup, RealTeam } from "./nbaLoader";
import { toSimPlayer, simulateMatchup, SimPlayer } from "./possessionSim";
import { Rng } from "./rng";

// ─── Layout constants ────────────────────────────────────────────────────────

const SLOT_H    = 46;   // px — height of one seed row
const SLOT_W    = 192;  // px — width of a team slot card
const ROUND_GAP = 48;   // px — horizontal gap between rounds (used for SVG connector lines)
const MARGIN    = 20;   // px — outer padding

// ─── League / tier label mapping ─────────────────────────────────────────────

const TIER_NAMES = ["G-League", "NBA", "All Star", "Hall of Fame", "GOAT"];

// ─── State types ─────────────────────────────────────────────────────────────

interface SeriesBoxTotals {
  pts: number; fgm: number; fga: number; fgm3: number; fga3: number;
  ftm: number; fta: number; orb: number; drb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  games: number;
}

interface SeriesResult {
  key1:  string;
  key2:  string;
  wins1: number;
  wins2: number;
  box1:  SeriesBoxTotals;
  box2:  SeriesBoxTotals;
}

interface BracketState {
  numTeams:          2 | 4 | 8 | 16;
  slots:             (string | null)[];   // length = numTeams, teamKey or null
  gamesPerRound:     number[];            // odd, one per sim round (length = log2(numTeams))
  results:           (SeriesResult | null)[][];  // [simRoundIdx][matchupIdx]
  simDone:           boolean;
  activeSlot:        number | null;       // which seed slot is being edited (0-based)
  activeSeriesKey:   string | null;       // "r:m" key of the open stats modal
  fillTiers:         Set<number>;         // tiers enabled for random fill
  allTeams:          RealTeam[];
  pickerFranchise:   string;             // currently selected franchise in the picker
}

// ─── Initial state ───────────────────────────────────────────────────────────

function makeState(numTeams: 2 | 4 | 8 | 16): BracketState {
  const R = Math.log2(numTeams);
  return {
    numTeams,
    slots:           Array(numTeams).fill(null),
    gamesPerRound:   Array(R).fill(5),
    results:         [],
    simDone:         false,
    activeSlot:      null,
    activeSeriesKey: null,
    fillTiers:       new Set([3, 4]),
    allTeams:        [],
    pickerFranchise: "",
  };
}

let state: BracketState = makeState(8);

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

(async () => {
  app.innerHTML = `<div class="loading">Loading NBA data…</div>`;
  try { await loadNBAData(); } catch { /* use empty */ }
  state.allTeams = getAllRealTeams();
  renderPage();
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function franchiseName(key: string): string {
  return key.replace(/^\d{4}\s+/, "");
}

function teamYear(key: string): number {
  return parseInt(key.match(/^(\d{4})/)?.[1] ?? "0", 10);
}

/** "1997 Chicago Bulls" → "Chicago Bulls '97" */
function shortLabel(key: string): string {
  const y = teamYear(key);
  return `${franchiseName(key)} '${String(y).slice(2)}`;
}

function numRounds(n: number): number {
  return Math.log2(n);
}

function winnerKey(r: SeriesResult): string {
  return r.wins1 >= r.wins2 ? r.key1 : r.key2;
}

function roundName(roundIdx: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return "Finals";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${roundIdx + 1}`;
}

// ─── Bracket slot helpers ─────────────────────────────────────────────────────

/**
 * Get the two team keys competing in a given sim round at a given matchup index.
 * Uses `allResults` so it can run in order during simulation.
 */
function matchupKeys(
  simRound: number,
  matchupIdx: number,
  allResults: (SeriesResult | null)[][],
): [string | null, string | null] {
  if (simRound === 0) {
    return [
      state.slots[matchupIdx * 2] ?? null,
      state.slots[matchupIdx * 2 + 1] ?? null,
    ];
  }
  const prev = allResults[simRound - 1];
  if (!prev) return [null, null];
  const r1 = prev[matchupIdx * 2];
  const r2 = prev[matchupIdx * 2 + 1];
  return [r1 ? winnerKey(r1) : null, r2 ? winnerKey(r2) : null];
}

/**
 * Get the displayed team key for a given display round + slot index.
 * displayRound 0 = seeds, displayRound R = champion.
 */
function displayKey(displayRound: number, slotIdx: number): string | null {
  if (displayRound === 0) return state.slots[slotIdx] ?? null;
  const simRound = displayRound - 1;
  if (!state.simDone || !state.results[simRound]) return null;
  const r = state.results[simRound][slotIdx];
  return r ? winnerKey(r) : null;
}

/**
 * Get the two pre-simulation team keys that WILL compete in a display result slot.
 * Used to show "A vs B" before simulation runs.
 */
function pendingMatchupKeys(displayRound: number, slotIdx: number): [string | null, string | null] {
  if (displayRound === 0) return [null, null]; // not applicable for seeds
  // The two slots from the previous display round that feed this slot
  return [
    displayKey(displayRound - 1, slotIdx * 2),
    displayKey(displayRound - 1, slotIdx * 2 + 1),
  ];
}

// ─── Simulation ──────────────────────────────────────────────────────────────

function buildLineup(teamKey: string): SimPlayer[] {
  const players = getTeamLineup(teamKey);
  return players.map((p) =>
    toSimPlayer({
      id: p.id,
      fullName: p.fullName,
      positions: p.positions,
      teamLabel: shortLabel(teamKey),
      per100: p.per100,
      orb_pct: p.orb_pct,
      drb_pct: p.drb_pct,
      ast_pct: p.ast_pct,
      ftr: p.ftr,
    })
  );
}

function zeroBox(): SeriesBoxTotals {
  return { pts:0, fgm:0, fga:0, fgm3:0, fga3:0, ftm:0, fta:0, orb:0, drb:0, ast:0, stl:0, blk:0, tov:0, pf:0, games:0 };
}

function addToBox(acc: SeriesBoxTotals, src: { pts:number; fgm:number; fga:number; fgm3:number; fga3:number; ftm:number; fta:number; orb:number; drb:number; ast:number; stl:number; blk:number; tov:number; pf:number }): void {
  acc.pts += src.pts; acc.fgm += src.fgm; acc.fga += src.fga;
  acc.fgm3 += src.fgm3; acc.fga3 += src.fga3;
  acc.ftm += src.ftm; acc.fta += src.fta;
  acc.orb += src.orb; acc.drb += src.drb;
  acc.ast += src.ast; acc.stl += src.stl; acc.blk += src.blk;
  acc.tov += src.tov; acc.pf += src.pf;
}

function simulateSeries(
  key1: string,
  key2: string,
  seriesLen: number,
  rng: Rng,
): SeriesResult {
  const lineup1 = buildLineup(key1);
  const lineup2 = buildLineup(key2);
  const needed  = Math.ceil(seriesLen / 2);
  let wins1 = 0, wins2 = 0, game = 0;
  const box1 = zeroBox();
  const box2 = zeroBox();

  while (wins1 < needed && wins2 < needed) {
    // 2-2-1-1-1 home-court pattern: team1 home for games 1,2,5,7; team2 for 3,4,6
    const t1IsHome = game < 2 || game === 4 || game === 6;
    const [home, away] = t1IsHome ? [lineup1, lineup2] : [lineup2, lineup1];
    const result = simulateMatchup(home, away, rng, 75);
    const homeWon = result.home.pts > result.away.pts;
    if (homeWon ? t1IsHome : !t1IsHome) wins1++; else wins2++;
    const t1side = t1IsHome ? result.home : result.away;
    const t2side = t1IsHome ? result.away : result.home;
    addToBox(box1, t1side); box1.games++;
    addToBox(box2, t2side); box2.games++;
    game++;
  }

  return { key1, key2, wins1, wins2, box1, box2 };
}

function runSimulation(): void {
  const R   = numRounds(state.numTeams);
  const rng = new Rng(Date.now().toString());
  const allResults: (SeriesResult | null)[][] = [];

  for (let r = 0; r < R; r++) {
    const count      = state.numTeams / Math.pow(2, r + 1);
    const seriesLen  = state.gamesPerRound[r] ?? 5;
    const roundRes: (SeriesResult | null)[] = [];

    for (let m = 0; m < count; m++) {
      const [k1, k2] = matchupKeys(r, m, allResults);
      if (k1 && k2) {
        roundRes.push(simulateSeries(k1, k2, seriesLen, rng));
      } else {
        roundRes.push(null);
      }
    }
    allResults.push(roundRes);
  }

  state.results = allResults;
  state.simDone = true;
}

// ─── Bracket layout math ─────────────────────────────────────────────────────

function slotCY(displayRound: number, slotIdx: number): number {
  const blockH = SLOT_H * Math.pow(2, displayRound);
  return MARGIN + slotIdx * blockH + blockH / 2;
}

function roundX(displayRound: number): number {
  return MARGIN + displayRound * (SLOT_W + ROUND_GAP);
}

function bracketWidth(): number {
  const R = numRounds(state.numTeams);
  // R+1 display columns (seeds + R result rounds including champion)
  return MARGIN * 2 + (R + 1) * SLOT_W + R * ROUND_GAP;
}

function bracketHeight(): number {
  return MARGIN * 2 + state.numTeams * SLOT_H;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderPage(): void {
  const R  = numRounds(state.numTeams);
  const bw = bracketWidth();
  const bh = bracketHeight();

  // ── Franchise list ──
  const franchises = [...new Set(state.allTeams.map((t) => franchiseName(t.key)))].sort();
  const selFranchise = state.pickerFranchise || franchises[0] || "";
  const years = state.allTeams
    .filter((t) => franchiseName(t.key) === selFranchise)
    .map((t) => teamYear(t.key))
    .sort((a, b) => b - a);

  // ── Bracket slots + SVG lines ──
  const slotDivs: string[]  = [];
  const svgLines: string[]  = [];

  for (let dr = 0; dr <= R; dr++) {
    const numSlots = state.numTeams / Math.pow(2, dr);
    const x = roundX(dr);
    const isChampRound = dr === R;

    for (let s = 0; s < numSlots; s++) {
      const cy  = slotCY(dr, s);
      const top = cy - SLOT_H / 2;
      const key = displayKey(dr, s);

      if (dr === 0) {
        // ── Seed slot (clickable) ──
        const active = state.activeSlot === s;
        const cls = `bslot seed-slot${key ? " assigned" : ""}${active ? " active" : ""}`;
        slotDivs.push(
          `<div class="${cls}" style="top:${top}px;left:${x}px;width:${SLOT_W}px;height:${SLOT_H}px;" data-seed="${s}">` +
          `<span class="seed-num">#${s + 1}</span>` +
          `<span class="slot-label">${esc(key ? shortLabel(key) : "Assign team")}</span>` +
          `</div>`
        );
      } else if (isChampRound) {
        // ── Champion slot ──
        const cls = `bslot champ-slot${key ? " has-winner" : ""}`;
        slotDivs.push(
          `<div class="${cls}" style="top:${cy - SLOT_H}px;left:${x}px;width:${SLOT_W}px;height:${SLOT_H * 2}px;">` +
          (key ? `<span class="champ-crown">🏆</span><span class="champ-label">${esc(shortLabel(key))}</span>` : `<span class="champ-label tbd">Champion</span>`) +
          `</div>`
        );
      } else {
        // ── Result slot ──
        const simRound  = dr - 1;
        const seriesRes = state.simDone ? (state.results[simRound]?.[s] ?? null) : null;
        let inner = "";

        if (seriesRes) {
          const w    = winnerKey(seriesRes);
          const ww   = w === seriesRes.key1 ? seriesRes.wins1 : seriesRes.wins2;
          const lw   = w === seriesRes.key1 ? seriesRes.wins2 : seriesRes.wins1;
          inner =
            `<span class="slot-label winner-label">${esc(shortLabel(w))}</span>` +
            `<span class="series-score">${ww}–${lw}</span>`;
        } else {
          const [pk1, pk2] = pendingMatchupKeys(dr, s);
          if (pk1 && pk2) {
            inner = `<span class="slot-label vs-label">${esc(shortLabel(pk1))} <em>vs</em> ${esc(shortLabel(pk2))}</span>`;
          } else {
            inner = `<span class="slot-label tbd">TBD</span>`;
          }
        }

        const seriesAttr = seriesRes ? ` data-series="${dr - 1}:${s}"` : "";
        const cls = `bslot result-slot${seriesRes ? " has-result clickable-result" : ""}`;
        slotDivs.push(
          `<div class="${cls}" style="top:${top}px;left:${x}px;width:${SLOT_W}px;height:${SLOT_H}px;"${seriesAttr}>` +
          inner +
          `</div>`
        );
      }

      // ── SVG connector lines (draw for each pair in this display round) ──
      if (dr < R && s % 2 === 0) {
        const cy2  = slotCY(dr, s + 1);
        const midX = x + SLOT_W + ROUND_GAP / 2;
        const midY = (cy + cy2) / 2;
        const nx   = roundX(dr + 1);

        // Horizontal arms right from each slot
        svgLines.push(`<line x1="${x + SLOT_W}" y1="${cy}"  x2="${midX}" y2="${cy}"  />`);
        svgLines.push(`<line x1="${x + SLOT_W}" y1="${cy2}" x2="${midX}" y2="${cy2}" />`);
        // Vertical connector
        svgLines.push(`<line x1="${midX}" y1="${cy}" x2="${midX}" y2="${cy2}" />`);
        // Horizontal arm to next round slot
        if (dr + 1 < R) {
          svgLines.push(`<line x1="${midX}" y1="${midY}" x2="${nx}" y2="${midY}" />`);
        } else {
          // Final round → connect to champion slot center
          const champCY = slotCY(R, 0);
          svgLines.push(`<line x1="${midX}" y1="${champCY}" x2="${nx}" y2="${champCY}" />`);
        }
      }
    }
  }

  // ── Series-length selects ──
  const seriesInputsHtml = Array.from({ length: R }, (_, i) =>
    `<div class="series-group">
      <label class="series-label">${roundName(i, R)}</label>
      <select id="gpr-${i}" class="gpr-sel">
        ${[1, 3, 5, 7].map((g) =>
          `<option value="${g}"${state.gamesPerRound[i] === g ? " selected" : ""}>Best of ${g}</option>`
        ).join("")}
      </select>
    </div>`
  ).join("");

  // ── Tier checkboxes ──
  const tierCheckboxHtml = TIER_NAMES.map((name, i) =>
    `<label class="tier-cb">
      <input type="checkbox" data-tier="${i}"${state.fillTiers.has(i) ? " checked" : ""}> ${esc(name)}
    </label>`
  ).join("");

  // ── Team picker panel ──
  const pickerHtml = state.activeSlot !== null
    ? renderPicker(state.activeSlot, franchises, selFranchise, years)
    : "";

  // ── Simulate button state ──
  const allAssigned = state.slots.every((k) => k !== null);
  const simBtnAttrs = allAssigned ? "" : " disabled";

  // ── Results panel ──
  const resultsPanelHtml = state.simDone ? renderResultsPanel(R) : "";

  // ── Series stats modal ──
  const modalHtml = state.activeSeriesKey !== null ? renderSeriesModal(state.activeSeriesKey) : "";

  app.innerHTML = `
<header>
  <a href="/">← Home</a>
  <h1>Bracket Simulator</h1>
  <button id="simBtn" class="btn-sim"${simBtnAttrs}>▶ Simulate</button>
</header>

<div class="toolbar">
  <div class="toolbar-section">
    <span class="tlabel">Teams</span>
    <div class="btn-group">
      ${([2, 4, 8, 16] as const).map((n) =>
        `<button class="btn-n${state.numTeams === n ? " on" : ""}" data-n="${n}">${n}</button>`
      ).join("")}
    </div>
  </div>

  <div class="toolbar-section series-section">
    <span class="tlabel">Series Length</span>
    <div class="series-inputs">${seriesInputsHtml}</div>
  </div>

  <div class="toolbar-section fill-section">
    <span class="tlabel">Random Fill</span>
    <div class="tier-filters">${tierCheckboxHtml}</div>
    <button id="fillBtn" class="btn-fill">Fill Empty</button>
  </div>
</div>

<div class="bracket-scroll">
  <div class="bracket-area" style="width:${bw}px;height:${bh}px;position:relative;flex-shrink:0;">
    <svg class="bracket-svg" width="${bw}" height="${bh}" style="position:absolute;top:0;left:0;pointer-events:none;">
      <g stroke="#353535" stroke-width="2" fill="none">${svgLines.join("")}</g>
    </svg>
    ${slotDivs.join("")}
  </div>
</div>

${pickerHtml}
${resultsPanelHtml}
${modalHtml}
`;

  bindEvents();
}

// ─── Team picker ─────────────────────────────────────────────────────────────

function renderPicker(
  slotIdx: number,
  franchises: string[],
  selFranchise: string,
  years: number[],
): string {
  const currentKey  = state.slots[slotIdx];
  const currentYear = currentKey ? teamYear(currentKey) : (years[0] ?? 0);

  return `
<div class="picker-panel">
  <div class="picker-title">Assign Seed #${slotIdx + 1}</div>
  <div class="picker-row">
    <select id="franchise-sel" class="picker-sel">
      ${franchises.map((f) =>
        `<option value="${esc(f)}"${f === selFranchise ? " selected" : ""}>${esc(f)}</option>`
      ).join("")}
    </select>
    <select id="year-sel" class="picker-sel year-sel">
      ${years.map((y) =>
        `<option value="${y}"${y === currentYear ? " selected" : ""}>${y}</option>`
      ).join("")}
    </select>
    <button id="assignBtn" class="btn-assign">Assign</button>
    ${currentKey ? `<button id="clearBtn" class="btn-clear">Clear</button>` : ""}
    <button id="cancelBtn" class="btn-cancel">✕</button>
  </div>
</div>`;
}

// ─── Series stats modal ─────────────────────────────────────────────────────

function fmt1(n: number): string {
  return n.toFixed(1);
}

function pct(made: number, att: number): string {
  return att > 0 ? (made / att * 100).toFixed(1) + "%" : "—";
}

function renderSeriesModal(seriesKey: string): string {
  const [ri, mi] = seriesKey.split(":").map(Number);
  const result = state.results[ri]?.[mi];
  if (!result) return "";

  const g1 = result.box1.games || 1;
  const g2 = result.box2.games || 1;
  const b1 = result.box1;
  const b2 = result.box2;

  const w  = winnerKey(result);
  const ww = w === result.key1 ? result.wins1 : result.wins2;
  const lw = w === result.key1 ? result.wins2 : result.wins1;

  type StatRow = { label: string; v1: string; v2: string; highlight?: boolean };
  const rows: StatRow[] = [
    { label: "PTS",   v1: fmt1(b1.pts/g1),  v2: fmt1(b2.pts/g2),  highlight: true },
    { label: "FGM",   v1: fmt1(b1.fgm/g1),  v2: fmt1(b2.fgm/g2) },
    { label: "FGA",   v1: fmt1(b1.fga/g1),  v2: fmt1(b2.fga/g2) },
    { label: "FG%",   v1: pct(b1.fgm, b1.fga),   v2: pct(b2.fgm, b2.fga) },
    { label: "3PM",   v1: fmt1(b1.fgm3/g1), v2: fmt1(b2.fgm3/g2) },
    { label: "3PA",   v1: fmt1(b1.fga3/g1), v2: fmt1(b2.fga3/g2) },
    { label: "3P%",   v1: pct(b1.fgm3, b1.fga3),  v2: pct(b2.fgm3, b2.fga3) },
    { label: "FTM",   v1: fmt1(b1.ftm/g1),  v2: fmt1(b2.ftm/g2) },
    { label: "FTA",   v1: fmt1(b1.fta/g1),  v2: fmt1(b2.fta/g2) },
    { label: "FT%",   v1: pct(b1.ftm, b1.fta),    v2: pct(b2.ftm, b2.fta) },
    { label: "ORB",   v1: fmt1(b1.orb/g1),  v2: fmt1(b2.orb/g2) },
    { label: "DRB",   v1: fmt1(b1.drb/g1),  v2: fmt1(b2.drb/g2) },
    { label: "AST",   v1: fmt1(b1.ast/g1),  v2: fmt1(b2.ast/g2) },
    { label: "STL",   v1: fmt1(b1.stl/g1),  v2: fmt1(b2.stl/g2) },
    { label: "BLK",   v1: fmt1(b1.blk/g1),  v2: fmt1(b2.blk/g2) },
    { label: "TOV",   v1: fmt1(b1.tov/g1),  v2: fmt1(b2.tov/g2) },
    { label: "PF",    v1: fmt1(b1.pf/g1),   v2: fmt1(b2.pf/g2) },
  ];

  const tableRows = rows.map((r) => {
    const cls = r.highlight ? " class=\"sm-pts\"" : "";
    return `<tr${cls}><td class="sm-v">${r.v1}</td><td class="sm-lbl">${r.label}</td><td class="sm-v">${r.v2}</td></tr>`;
  }).join("");

  return `
<div class="series-modal-backdrop" id="seriesModalBackdrop">
  <div class="series-modal">
    <div class="sm-header">
      <div class="sm-team${w === result.key1 ? " sm-winner" : ""}">${esc(shortLabel(result.key1))}<span class="sm-wins">${result.wins1}</span></div>
      <div class="sm-vs">vs<br><span class="sm-games">${g1} game${g1 !== 1 ? "s" : ""}</span></div>
      <div class="sm-team${w === result.key2 ? " sm-winner" : ""}">${esc(shortLabel(result.key2))}<span class="sm-wins">${result.wins2}</span></div>
      <button class="sm-close" id="seriesModalClose">✕</button>
    </div>
    <div class="sm-series-score">${esc(shortLabel(w))} wins ${ww}–${lw}</div>
    <div class="sm-sub">Per-game averages</div>
    <div class="sm-table-wrap">
      <table class="sm-table">
        <thead><tr>
          <th>${esc(shortLabel(result.key1))}</th>
          <th></th>
          <th>${esc(shortLabel(result.key2))}</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </div>
</div>`;
}

// ─── Results panel ────────────────────────────────────────────────────────────

function renderResultsPanel(R: number): string {
  const rows: string[] = [];

  for (let r = 0; r < R; r++) {
    rows.push(`<div class="res-round-label">${roundName(r, R)}</div>`);
    for (const result of state.results[r] ?? []) {
      if (!result) continue;
      const w  = winnerKey(result);
      const l  = w === result.key1 ? result.key2 : result.key1;
      const ww = w === result.key1 ? result.wins1 : result.wins2;
      const lw = w === result.key1 ? result.wins2 : result.wins1;
      rows.push(
        `<div class="res-row">` +
        `<span class="res-winner">${esc(shortLabel(w))}</span>` +
        `<span class="res-score">${ww}–${lw}</span>` +
        `<span class="res-loser">${esc(shortLabel(l))}</span>` +
        `</div>`
      );
    }
  }

  const champ = winnerKey(state.results[R - 1]?.[0]!);
  if (champ) {
    rows.push(`<div class="res-champion">🏆 Champion: ${esc(shortLabel(champ))}</div>`);
  }

  return `<div class="results-panel"><div class="res-inner">${rows.join("")}</div></div>`;
}

// ─── Random fill ─────────────────────────────────────────────────────────────

function randomFill(): void {
  const eligible = state.allTeams.filter((t) => state.fillTiers.has(t.tier));
  if (eligible.length === 0) return;

  const rng     = new Rng(Date.now().toString());
  const pool    = rng.shuffle([...eligible]);
  const used    = new Set(state.slots.filter(Boolean) as string[]);
  let pickIdx   = 0;

  for (let i = 0; i < state.slots.length; i++) {
    if (state.slots[i] !== null) continue;
    while (pickIdx < pool.length && used.has(pool[pickIdx].key)) pickIdx++;
    if (pickIdx >= pool.length) break;
    state.slots[i] = pool[pickIdx].key;
    used.add(pool[pickIdx].key);
    pickIdx++;
  }

  state.simDone = false;
  state.results = [];
}

// ─── Event wiring ────────────────────────────────────────────────────────────

function bindEvents(): void {
  // Simulate
  document.getElementById("simBtn")?.addEventListener("click", () => {
    runSimulation();
    renderPage();
  });

  // Number of teams
  document.querySelectorAll<HTMLElement>(".btn-n").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = parseInt(btn.dataset.n ?? "8") as 2 | 4 | 8 | 16;
      const prev = { fillTiers: state.fillTiers, allTeams: state.allTeams };
      state = makeState(n);
      state.fillTiers = prev.fillTiers;
      state.allTeams  = prev.allTeams;
      renderPage();
    });
  });

  // Series length selects
  document.querySelectorAll<HTMLSelectElement>(".gpr-sel").forEach((sel) => {
    sel.addEventListener("change", () => {
      const idx = parseInt(sel.id.replace("gpr-", ""), 10);
      state.gamesPerRound[idx] = parseInt(sel.value, 10);
    });
  });

  // Tier checkboxes
  document.querySelectorAll<HTMLInputElement>("input[data-tier]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const tier = parseInt(cb.dataset.tier ?? "0", 10);
      if (cb.checked) state.fillTiers.add(tier); else state.fillTiers.delete(tier);
    });
  });

  // Random fill
  document.getElementById("fillBtn")?.addEventListener("click", () => {
    randomFill();
    renderPage();
  });

  // Seed slot click — open / close picker
  document.querySelectorAll<HTMLElement>(".seed-slot").forEach((slot) => {
    slot.addEventListener("click", () => {
      const seed = parseInt(slot.dataset.seed ?? "0", 10);
      if (state.activeSlot === seed) {
        state.activeSlot = null;
      } else {
        state.activeSlot = seed;
        if (!state.pickerFranchise) {
          const franchises = [...new Set(state.allTeams.map((t) => franchiseName(t.key)))].sort();
          state.pickerFranchise = franchises[0] ?? "";
        }
      }
      renderPage();
    });
  });

  // Franchise dropdown → re-render picker with new years
  document.getElementById("franchise-sel")?.addEventListener("change", (e) => {
    state.pickerFranchise = (e.target as HTMLSelectElement).value;
    renderPage();
  });

  // Assign button
  document.getElementById("assignBtn")?.addEventListener("click", () => {
    if (state.activeSlot === null) return;
    const franchise = (document.getElementById("franchise-sel") as HTMLSelectElement)?.value;
    const year      = (document.getElementById("year-sel") as HTMLSelectElement)?.value;
    if (franchise && year) {
      state.slots[state.activeSlot] = `${year} ${franchise}`;
      state.simDone  = false;
      state.results  = [];
      state.activeSlot = null;
      renderPage();
    }
  });

  // Clear slot
  document.getElementById("clearBtn")?.addEventListener("click", () => {
    if (state.activeSlot === null) return;
    state.slots[state.activeSlot] = null;
    state.simDone  = false;
    state.results  = [];
    state.activeSlot = null;
    renderPage();
  });

  // Cancel picker
  document.getElementById("cancelBtn")?.addEventListener("click", () => {
    state.activeSlot = null;
    renderPage();
  });

  // Result slot click → open series modal
  document.querySelectorAll<HTMLElement>(".clickable-result").forEach((el) => {
    el.addEventListener("click", () => {
      state.activeSeriesKey = el.dataset.series ?? null;
      renderPage();
    });
  });

  // Close series modal
  const closeModal = () => { state.activeSeriesKey = null; renderPage(); };
  document.getElementById("seriesModalClose")?.addEventListener("click", closeModal);
  document.getElementById("seriesModalBackdrop")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "seriesModalBackdrop") closeModal();
  });
}
