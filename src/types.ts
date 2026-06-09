export type Position = "PG" | "SG" | "SF" | "PF" | "C";

export type Stats = {
  pts: number;
  threes: number;
  threepa: number;
  fga: number;
  fgm: number;
  fta: number;
  ftm: number;
  orb: number;
  drb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
};

export type Player = {
  id: string;
  fullName: string;
  seasonYear: number;
  positions: Position[];
  stats: Stats;
  fantasyScore: number;
  normalizedRating: number;
  cost: number;
};

export type Slot = Position;
export type Roster = Record<Slot, Player | null>;

export type Team = {
  id: string;
  name: string;
  isUser: boolean;
  roster: Roster;
};

export type League = {
  name: string;
  teams: number;
  budget: number;
};

export type Standing = {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

export type DraftMode = "initial" | "freeAgency" | "complete";

export type DraftPick = {
  slot: Slot;
  player: Player;
  discount: number;
};

export type SortKey =
  | "fullName"
  | "seasonYear"
  | "positions"
  | "cost"
  | "normalizedRating"
  | keyof Stats;

// ── Historical (real-data) types ──────────────────────────────────────────────
// When real NBA data is loaded, HistoricalPlayer maps 1-to-1 with a player's
// stats for a specific season on a specific team. For now all values are
// generated from compact dummy descriptors in teams.ts.

export type HistoricalPlayer = {
  id: string;
  fullName: string;
  seasonYear: number;
  positions: Position[];
  stats: Stats;
};

export type HistoricalTeam = {
  /** Unique key: e.g. "1986-boston-celtics" */
  id: string;
  /** Franchise name used for uniqueness-per-season checks, e.g. "Boston Celtics" */
  franchise: string;
  /** Display label shown in UI, e.g. "1986 Boston Celtics" */
  displayName: string;
  year: number;
  season: string;      // "1985-86"
  wins: number;
  losses: number;
  /** 0 = JV  1 = Varsity  2 = College  3 = G League  4 = NBA */
  tier: number;
  players: HistoricalPlayer[];
};

export type SeasonRecord = {
  year: number;
  leagueName: string;
  leagueIndex: number;
  wins: number;
  losses: number;
  rank: number;
  totalTeams: number;
  outcome: "promoted" | "demoted" | "stayed" | "champion";
  roster: Roster;
};

/** Accumulated box score totals for one player across an entire simulated season. */
export type PlayerSeasonLine = {
  playerId: string;
  fullName: string;
  gp: number;
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
};

/** Season box totals keyed by teamId. */
export type SeasonBoxStats = Map<string, PlayerSeasonLine[]>;
