import { loadNBAData, getAllDataPlayers, teamAbbr, RealPlayer } from "./nbaLoader";
import { fantasyScore } from "./data";
import type { Position } from "./types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const TIER_NAMES = ["JV", "Varsity", "College", "G League", "NBA"];

type SortKey = "name" | "year" | "age" | "team" | "tier" | "pos" | "cost" | "ovr"
  | "fantasy" | "gamescore" | "mpg"
  | "pts" | "threes" | "fga" | "fgm" | "fta" | "ftm"
  | "reb" | "ast" | "stl" | "blk" | "tov";

type Row = {
  name: string;
  year: string;       // "09-10"
  age: number | string;
  team: string;       // "CHI"
  tier: number;
  tierName: string;
  pos: string;
  cost: number;
  ovr: number;
  fantasy: number;
  gamescore: number;
  mpg: number;
  pts: number;
  threes: number;
  fga: number;
  fgm: number;
  fta: number;
  ftm: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
};

let allRows: Row[] = [];
let sortKey: SortKey = "ovr";
let sortDir: "asc" | "desc" = "desc";
let posFilter: Position | "ALL" = "ALL";
let nameFilter = "";

function seasonLabel(year: number): string {
  return `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
}

function gameScore(s: RealPlayer["stats"]): number {
  const ftMissed = (s.fta ?? 0) - (s.ftm ?? 0);
  return Math.round((
    (s.pts ?? 0)
    + 0.4  * (s.fgm ?? 0)
    + 0.7  * (s.orb ?? 0)
    + 0.3  * (s.drb ?? 0)
    +        (s.stl ?? 0)
    + 0.7  * (s.ast ?? 0)
    + 0.7  * (s.blk ?? 0)
    - 0.7  * (s.fga ?? 0)
    - 0.4  * ftMissed
    -        (s.tov ?? 0)
  ) * 10) / 10;
}

function buildRows(players: (RealPlayer & { _tier: number })[]): Row[] {
  return players.map((p) => ({
    name:   p.fullName,
    year:   seasonLabel(p.seasonYear),
    age:    p.age ?? "—",
    team:   p.teamKey ? teamAbbr(p.teamKey) : "—",
    tier:   p._tier,
    tierName: TIER_NAMES[p._tier] ?? String(p._tier),
    pos:    p.positions.join("/"),
    cost:   p.cost,
    ovr:    p.normalizedRating,
    fantasy: Math.round(fantasyScore(p.stats) * 10) / 10,
    gamescore: gameScore(p.stats),
    mpg:    p.mpg,
    pts:    p.stats.pts,
    threes: p.stats.threes,
    fga:    p.stats.fga,
    fgm:    p.stats.fgm,
    fta:    p.stats.fta,
    ftm:    p.stats.ftm,
    reb:    p.stats.reb,
    ast:    p.stats.ast,
    stl:    p.stats.stl,
    blk:    p.stats.blk,
    tov:    p.stats.tov,
  }));
}

function filtered(): Row[] {
  let rows = allRows;
  if (posFilter !== "ALL") rows = rows.filter((r) => r.pos.split("/").includes(posFilter as string));
  if (nameFilter) {
    const q = nameFilter.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" || typeof bv === "string")
      return String(av).localeCompare(String(bv)) * dir;
    return (Number(av) - Number(bv)) * dir;
  });
}

function render(): void {
  const rows = filtered();

  const th = (key: SortKey, label: string) => {
    const active = sortKey === key;
    const arrow  = active ? (sortDir === "desc" ? " ▼" : " ▲") : "";
    return `<th><button data-sort="${key}">${label}${arrow}</button></th>`;
  };

  const posBtns = (["ALL", ...POSITIONS] as (Position | "ALL")[])
    .map((p) => `<button class="f${posFilter === p ? " on" : ""}" data-pos="${p}">${p}</button>`)
    .join("");

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <header>
      <a href="/">← Game</a>
      <h1>Player Data <span class="count">${rows.length.toLocaleString()} players</span></h1>
      <div class="filters">
        <div class="fgroup">${posBtns}</div>
        <input id="name-search" type="search" placeholder="Search player…" value="${nameFilter}" />
      </div>
    </header>
    <div class="wrap">
      <table>
        <thead><tr>
          <th class="th-num">#</th>
          ${th("name",   "Player")}
          ${th("year",   "Year")}
          ${th("age",    "Age")}
          ${th("team",   "Team")}
          ${th("pos",    "Pos")}
          ${th("cost",   "Cost")}
          ${th("ovr",    "OVR")}
          ${th("fantasy", "FPTS")}
          ${th("gamescore", "GmSc")}
          ${th("mpg",    "MIN")}
          ${th("pts",    "PTS")}
          ${th("threes", "3PM")}
          ${th("fga",    "FGA")}
          ${th("fgm",    "FGM")}
          ${th("fta",    "FTA")}
          ${th("ftm",    "FTM")}
          ${th("reb",    "REB")}
          ${th("ast",    "AST")}
          ${th("stl",    "STL")}
          ${th("blk",    "BLK")}
          ${th("tov",    "TOV")}
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr>
            <td class="td-num">${i + 1}</td>
            <td><b>${r.name}</b></td>
            <td>${r.year}</td>
            <td>${r.age}</td>
            <td>${r.team}</td>
            <td>${r.pos}</td>
            <td>${r.cost}</td>
            <td>${r.ovr}</td>
            <td>${r.fantasy}</td>
            <td>${r.gamescore}</td>
            <td>${r.mpg}</td>
            <td>${r.pts}</td>
            <td>${r.threes}</td>
            <td>${r.fga}</td>
            <td>${r.fgm}</td>
            <td>${r.fta}</td>
            <td>${r.ftm}</td>
            <td>${r.reb}</td>
            <td>${r.ast}</td>
            <td>${r.stl}</td>
            <td>${r.blk}</td>
            <td>${r.tov}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort as SortKey;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = key === "name" || key === "team" || key === "pos" || key === "year" ? "asc" : "desc"; }
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-pos]").forEach((btn) => {
    btn.addEventListener("click", () => {
      posFilter = btn.dataset.pos as Position | "ALL";
      render();
    });
  });
  const searchInput = document.querySelector<HTMLInputElement>("#name-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      nameFilter = searchInput.value;
      render();
    });
    // Preserve focus/cursor position across re-renders
    searchInput.focus();
    const len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML =
    `<div class="loading">Loading NBA data…</div>`;
  await loadNBAData();
  allRows = buildRows(getAllDataPlayers());
  render();
})();
