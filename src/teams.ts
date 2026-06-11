import { HistoricalTeam, HistoricalPlayer, Position, Stats } from "./types";

// ---------------------------------------------------------------------------
// Compact authoring format
// ---------------------------------------------------------------------------
// Each player is described as [name, positions, talent] where talent is 0-1.
// Stats are generated deterministically from (positions, talent, tier) so the
// raw data stays small and easy to replace with real figures later.
// ---------------------------------------------------------------------------

type CP = [string, Position[], number]; // [fullName, positions, talent 0–1]
type CT = { franchise: string; year: number; tier: number; p: CP[] };

function r(v: number): number { return Math.round(v * 10) / 10; }

function makeStats(positions: Position[], talent: number, tier: number): Stats {
  // tierBase: 0.50 (JV) → 0.98 (NBA)
  const tb = 0.50 + tier * 0.12;
  const t  = talent * tb;
  const big   = positions.some(p => p === "PF" || p === "C");
  const guard = positions.some(p => p === "PG" || p === "SG");
  const pts  = r(6  + t * 26);
  const fga  = r(pts / (0.41 + t * 0.10));
  const fgm  = r(fga * (0.40 + t * 0.12));
  const fta  = r(1   + t * 8);
  const ftm  = r(fta * (0.62 + t * 0.25));
  return {
    pts,
    threes: r(guard ? t * 4.5  : t * 1.2),
    threepa: r(guard ? t * 9.5 : t * 3.0),
    fga, fgm, fta, ftm,
    orb:  r(big   ? 1 + t * 3.5 : 0.3 + t * 1.2),
    drb:  r(big   ? 2 + t * 8   : 1.5 + t * 4.5),
    reb:  r(big   ? 3 + t * 12 : 2 + t * 6),
    ast:  r(guard ? 2 + t * 8  : 0.5 + t * 3),
    stl:  r(0.3 + t * 2.1),
    blk:  r(big   ? 0.4 + t * 3.2 : 0.1 + t * 1.1),
    tov:  r(0.8 + t * 3.8),
    pf:   r(1.0 + t * 3.5),
  };
}

function buildTeam(ct: CT): HistoricalTeam {
  const slug = ct.franchise.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const id   = `${ct.year}-${slug}`;
  const season = `${ct.year - 1}-${String(ct.year).slice(2)}`;
  const players: HistoricalPlayer[] = ct.p.map(([name, positions, talent], i) => ({
    id: `${id}-${i}`,
    fullName: name,
    seasonYear: ct.year,
    positions,
    stats: makeStats(positions, talent, ct.tier),
  }));
  return { id, franchise: ct.franchise, displayName: `${ct.year} ${ct.franchise}`, year: ct.year, season, wins: 0, losses: 82, tier: ct.tier, players };
}

// ---------------------------------------------------------------------------
// Raw team data — TODO: replace with real per-season NBA roster data
// Tiers: 0=JV  1=Varsity  2=College  3=G League  4=NBA
// ---------------------------------------------------------------------------

/* eslint-disable prettier/prettier */
const RAW: CT[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 0 — JV  (historically weak / rebuilding teams)
  // ═══════════════════════════════════════════════════════════════════════════
  { franchise: "Cleveland Cavaliers", year: 1981, tier: 0, p: [
    ["Bobby Dawes",     ["PG"],       0.28],
    ["Earl Simmons",    ["SG"],       0.31],
    ["Calvin Porter",   ["SF"],       0.35],
    ["Dennis Gaines",   ["PF"],       0.22],
    ["Marcus Hull",     ["C"],        0.30],
  ]},
  { franchise: "Dallas Mavericks", year: 1983, tier: 0, p: [
    ["Richie Cross",    ["PG"],       0.25],
    ["Terry Nash",      ["SG"],       0.29],
    ["Andre Spears",    ["SF", "PF"], 0.38],
    ["Jerome Butts",    ["PF"],       0.20],
    ["Leon Garner",     ["C"],        0.27],
  ]},
  { franchise: "Sacramento Kings", year: 1985, tier: 0, p: [
    ["Nate Rollins",    ["PG"],       0.30],
    ["Ray Foster",      ["SG"],       0.27],
    ["Scott Mays",      ["SF"],       0.33],
    ["Grant Owens",     ["PF"],       0.24],
    ["Harold Tatum",    ["C"],        0.32],
  ]},
  { franchise: "Los Angeles Clippers", year: 1987, tier: 0, p: [
    ["Jimmy Dunn",      ["PG", "SG"], 0.26],
    ["Derek Webb",      ["SG"],       0.28],
    ["Alvin Stone",     ["SF"],       0.24],
    ["Nelson Cruz",     ["PF"],       0.21],
    ["Curtis Page",     ["C"],        0.35],
  ]},
  { franchise: "Miami Heat", year: 1989, tier: 0, p: [
    ["Ronnie Vance",    ["PG"],       0.27],
    ["Chad Willis",     ["SG"],       0.31],
    ["Greg Monroe",     ["SF"],       0.29],
    ["Victor Ross",     ["PF", "C"],  0.34],
    ["Darnell King",    ["C"],        0.23],
  ]},
  { franchise: "Minnesota Timberwolves", year: 1993, tier: 0, p: [
    ["Carey Hunt",      ["PG"],       0.22],
    ["Blake West",      ["SG"],       0.25],
    ["Tony Fleming",    ["SF"],       0.30],
    ["Wayne Briggs",    ["PF"],       0.26],
    ["Mason Drake",     ["C"],        0.29],
  ]},
  { franchise: "Denver Nuggets", year: 1995, tier: 0, p: [
    ["Damon Pratt",     ["PG"],       0.32],
    ["Eric Beal",       ["SG"],       0.24],
    ["Reggie Thorn",    ["SF", "PF"], 0.28],
    ["Kelvin Marsh",    ["PF"],       0.22],
    ["Orlando Fitch",   ["C"],        0.31],
  ]},
  { franchise: "Vancouver Grizzlies", year: 1997, tier: 0, p: [
    ["Freddie Sims",    ["PG"],       0.20],
    ["Dean Gibbs",      ["SG"],       0.23],
    ["Kyle Harmon",     ["SF"],       0.27],
    ["Travis Odom",     ["PF"],       0.25],
    ["Hank Flowers",    ["C"],        0.28],
  ]},
  { franchise: "Chicago Bulls", year: 1999, tier: 0, p: [
    ["Peter Lomax",     ["PG"],       0.24],
    ["Gilbert Dukes",   ["SG"],       0.20],
    ["Francis Moon",    ["SF"],       0.22],
    ["Archie Teal",     ["PF"],       0.19],
    ["Russell Hines",   ["C"],        0.26],
  ]},
  { franchise: "Atlanta Hawks", year: 2001, tier: 0, p: [
    ["Lorenzo Kane",    ["PG"],       0.28],
    ["Monte Slade",     ["SG"],       0.26],
    ["Jerome Fry",      ["SF"],       0.32],
    ["Samuel Cross",    ["PF"],       0.24],
    ["Virgil Park",     ["C"],        0.21],
  ]},
  { franchise: "Toronto Raptors", year: 2003, tier: 0, p: [
    ["Darius Coles",    ["PG"],       0.30],
    ["Keith Ramos",     ["SG"],       0.28],
    ["Irving Mack",     ["SF"],       0.33],
    ["Roland Day",      ["PF"],       0.27],
    ["Stevie Dumont",   ["C"],        0.24],
  ]},
  { franchise: "Charlotte Bobcats", year: 2006, tier: 0, p: [
    ["Clint Bales",     ["PG"],       0.26],
    ["Otto Ware",       ["SG"],       0.22],
    ["Floyd Carr",      ["SF", "SG"], 0.35],
    ["Bruno Mills",     ["PF"],       0.20],
    ["Rex Sutton",      ["C"],        0.29],
  ]},
  { franchise: "New York Knicks", year: 2008, tier: 0, p: [
    ["Tremaine Day",    ["PG"],       0.29],
    ["Dion Stafford",   ["SG"],       0.25],
    ["Marcus Keane",    ["SF"],       0.31],
    ["Dorian Fields",   ["PF"],       0.23],
    ["Everett Pope",    ["C"],        0.27],
  ]},
  { franchise: "Philadelphia 76ers", year: 2015, tier: 0, p: [
    ["Spencer Holt",    ["PG"],       0.18],
    ["Chester Burke",   ["SG"],       0.21],
    ["Quinton Shaw",    ["SF"],       0.29],
    ["Malcolm Webb",    ["PF"],       0.24],
    ["Jensen Cole",     ["C"],        0.40],
  ]},

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1 — Varsity  (below-average but competitive)
  // ═══════════════════════════════════════════════════════════════════════════
  { franchise: "Indiana Pacers", year: 1982, tier: 1, p: [
    ["Clarence Bell",   ["PG"],       0.38],
    ["Merle Fox",       ["SG"],       0.41],
    ["Aubrey Grant",    ["SF"],       0.45],
    ["Roosevelt Quinn", ["PF"],       0.33],
    ["Emmett Hoover",   ["C"],        0.38],
  ]},
  { franchise: "Washington Bullets", year: 1984, tier: 1, p: [
    ["Chester Young",   ["PG"],       0.42],
    ["Leroy Baines",    ["SG", "SF"], 0.46],
    ["Terrence Lane",   ["SF"],       0.40],
    ["Oliver Marsh",    ["PF"],       0.35],
    ["Augustus Webb",   ["C"],        0.43],
  ]},
  { franchise: "Houston Rockets", year: 1988, tier: 1, p: [
    ["Dominic Frazier", ["PG"],       0.44],
    ["Sylvester Page",  ["SG"],       0.40],
    ["Bernard Owens",   ["SF"],       0.48],
    ["Winston Clarke",  ["PF"],       0.37],
    ["Lamont Gray",     ["C"],        0.50],
  ]},
  { franchise: "Sacramento Kings", year: 1990, tier: 1, p: [
    ["Garfield Park",   ["PG"],       0.36],
    ["Edmund Watts",    ["SG"],       0.43],
    ["Lenny Briggs",    ["SF", "PF"], 0.47],
    ["Conrad Beck",     ["PF"],       0.38],
    ["Willard Stone",   ["C"],        0.41],
  ]},
  { franchise: "Charlotte Hornets", year: 1991, tier: 1, p: [
    ["Nestor Craig",    ["PG"],       0.50],
    ["Frankie Wade",    ["SG"],       0.42],
    ["Glen Norris",     ["SF"],       0.44],
    ["Hector Morse",    ["PF"],       0.36],
    ["Tyrone Best",     ["C"],        0.39],
  ]},
  { franchise: "Dallas Mavericks", year: 1996, tier: 1, p: [
    ["Perry Leon",      ["PG"],       0.46],
    ["Elroy Hubbard",   ["SG"],       0.44],
    ["Willis Carson",   ["SF"],       0.48],
    ["Alberto Fox",     ["PF", "C"],  0.40],
    ["Magnus Wade",     ["C"],        0.37],
  ]},
  { franchise: "Golden State Warriors", year: 1998, tier: 1, p: [
    ["Anton Perry",     ["PG"],       0.45],
    ["Benny Steele",    ["SG"],       0.47],
    ["Darrell Hicks",   ["SF"],       0.52],
    ["Theron Austin",   ["PF"],       0.38],
    ["Jasper Collins",  ["C"],        0.44],
  ]},
  { franchise: "Memphis Grizzlies", year: 2001, tier: 1, p: [
    ["Sheldon Bass",    ["PG"],       0.40],
    ["Irving Mann",     ["SG"],       0.43],
    ["Rufus Palmer",    ["SF"],       0.46],
    ["Preston Frank",   ["PF"],       0.39],
    ["Clifford Moon",   ["C"],        0.41],
  ]},
  { franchise: "New York Knicks", year: 2002, tier: 1, p: [
    ["Tyrell Gibson",   ["PG"],       0.44],
    ["Earnest Knox",    ["SG"],       0.48],
    ["Mortimer Byrd",   ["SF"],       0.42],
    ["Desmond Payne",   ["PF"],       0.36],
    ["Wendell Steele",  ["C"],        0.50],
  ]},
  { franchise: "Milwaukee Bucks", year: 2004, tier: 1, p: [
    ["Roderick Lowe",   ["PG"],       0.48],
    ["Delbert Moss",    ["SG"],       0.44],
    ["Kenyon Watts",    ["SF"],       0.50],
    ["Prescott Davis",  ["PF"],       0.42],
    ["Ambrose King",    ["C"],        0.45],
  ]},
  { franchise: "Toronto Raptors", year: 2007, tier: 1, p: [
    ["Beaumont Hall",   ["PG"],       0.52],
    ["Cornell Hayes",   ["SG", "SF"], 0.55],
    ["Gilberto Cross",  ["SF"],       0.48],
    ["Santos Webb",     ["PF"],       0.43],
    ["Leander Cole",    ["C"],        0.46],
  ]},
  { franchise: "Detroit Pistons", year: 2010, tier: 1, p: [
    ["Reginald Dunn",   ["PG"],       0.46],
    ["Sylvio Farrow",   ["SG"],       0.49],
    ["Isadore Long",    ["SF"],       0.45],
    ["Leonard Booth",   ["PF"],       0.40],
    ["Nathaniel King",  ["C"],        0.47],
  ]},
  { franchise: "New Orleans Pelicans", year: 2014, tier: 1, p: [
    ["Thaddeus Vance",  ["PG"],       0.50],
    ["Cornelius Price", ["SG"],       0.53],
    ["Edison Brooks",   ["SF"],       0.55],
    ["Maurice Paige",   ["PF"],       0.44],
    ["Hubert Lloyd",    ["C"],        0.48],
  ]},
  { franchise: "Phoenix Suns", year: 2016, tier: 1, p: [
    ["Darnell Cobb",    ["PG"],       0.53],
    ["Aloysius Dean",   ["SG"],       0.48],
    ["Bradford Hart",   ["SF"],       0.52],
    ["Oswald Riley",    ["PF"],       0.45],
    ["Rutherford Knox", ["C"],        0.42],
  ]},
  { franchise: "Chicago Bulls", year: 2019, tier: 1, p: [
    ["Emmett Bright",   ["PG"],       0.49],
    ["Clyde Chase",     ["SG"],       0.47],
    ["Archie Dunn",     ["SF"],       0.51],
    ["Quinton Lowe",    ["PF"],       0.43],
    ["Burt Wade",       ["C"],        0.44],
  ]},
  { franchise: "San Antonio Spurs", year: 2021, tier: 1, p: [
    ["Lenny Craft",     ["PG"],       0.52],
    ["Foster Moody",    ["SG"],       0.45],
    ["Weston Dukes",    ["SF"],       0.50],
    ["Aldo Pearce",     ["PF"],       0.42],
    ["Sterling Bond",   ["C"],        0.46],
  ]},
  { franchise: "Washington Wizards", year: 2023, tier: 1, p: [
    ["Jarvis Odom",     ["PG"],       0.46],
    ["Keaton Wise",     ["SG"],       0.50],
    ["Wilton Hurd",     ["SF"],       0.48],
    ["Raphael Downs",   ["PF"],       0.40],
    ["Clem Barker",     ["C"],        0.43],
  ]},
  { franchise: "Orlando Magic", year: 2024, tier: 1, p: [
    ["Ezra Moon",       ["PG"],       0.55],
    ["Myron Hale",      ["SG"],       0.52],
    ["Fletcher Sims",   ["SF"],       0.50],
    ["Gilbert Voss",    ["PF"],       0.47],
    ["Linus Bowen",     ["C"],        0.54],
  ]},

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2 — College  (solid teams, occasional playoff runs)
  // ═══════════════════════════════════════════════════════════════════════════
  { franchise: "New York Knicks", year: 1984, tier: 2, p: [
    ["Randolph Elms",   ["PG"],       0.52],
    ["Vincent Ray",     ["SG"],       0.58],
    ["Barnard Kirk",    ["SF"],       0.60],
    ["Elton Gibbs",     ["PF"],       0.48],
    ["Patrick Boone",   ["C"],        0.66],
  ]},
  { franchise: "Detroit Pistons", year: 1987, tier: 2, p: [
    ["Amos Doyle",      ["PG"],       0.54],
    ["Wallace Prince",  ["SG"],       0.62],
    ["Darnell Rowe",    ["SF", "PF"], 0.55],
    ["Henry Lott",      ["PF"],       0.50],
    ["Cassius Ford",    ["C"],        0.57],
  ]},
  { franchise: "Atlanta Hawks", year: 1989, tier: 2, p: [
    ["Devon Whitley",   ["PG"],       0.56],
    ["Marcus Doss",     ["SG"],       0.68],
    ["Stuart Cole",     ["SF"],       0.58],
    ["Cedric Vaughn",   ["PF"],       0.52],
    ["Ronnie Kirby",    ["C"],        0.54],
  ]},
  { franchise: "Utah Jazz", year: 1991, tier: 2, p: [
    ["Arden Cross",     ["PG"],       0.62],
    ["Trenton Byrd",    ["SG"],       0.55],
    ["Horace Vernon",   ["SF"],       0.57],
    ["Leroy Blackwell", ["PF"],       0.60],
    ["Conrad Malone",   ["C"],        0.65],
  ]},
  { franchise: "Seattle SuperSonics", year: 1993, tier: 2, p: [
    ["Lamar Finch",     ["PG"],       0.60],
    ["Derrick Cain",    ["SG"],       0.64],
    ["Nelson Booker",   ["SF", "SG"], 0.66],
    ["Thurman Blake",   ["PF"],       0.55],
    ["Antoine Dix",     ["C"],        0.58],
  ]},
  { franchise: "Miami Heat", year: 1997, tier: 2, p: [
    ["Danny Reese",     ["PG"],       0.58],
    ["Calvin Terry",    ["SG"],       0.60],
    ["Floyd Grant",     ["SF"],       0.55],
    ["Tyrone Marsh",    ["PF"],       0.52],
    ["Arnold Stokes",   ["C"],        0.62],
  ]},
  { franchise: "Indiana Pacers", year: 1999, tier: 2, p: [
    ["Reggie Craft",    ["PG", "SG"], 0.72],
    ["Douglas Fenn",    ["SG"],       0.57],
    ["Jermaine Frost",  ["SF", "PF"], 0.62],
    ["Samuel Oakes",    ["PF"],       0.55],
    ["Ezekiel Brown",   ["C"],        0.58],
  ]},
  { franchise: "Milwaukee Bucks", year: 2001, tier: 2, p: [
    ["Allen Hardy",     ["PG"],       0.62],
    ["Vernon Holt",     ["SG"],       0.66],
    ["Ray Penn",        ["SF"],       0.70],
    ["Clinton Foote",   ["PF"],       0.57],
    ["Mervin Bass",     ["C"],        0.60],
  ]},
  { franchise: "New Orleans Hornets", year: 2004, tier: 2, p: [
    ["Christoph Ames",  ["PG"],       0.68],
    ["Elmore Pike",     ["SG"],       0.60],
    ["Randall Booth",   ["SF"],       0.62],
    ["Stanley Dunn",    ["PF"],       0.55],
    ["Garth Powell",    ["C"],        0.58],
  ]},
  { franchise: "Cleveland Cavaliers", year: 2006, tier: 2, p: [
    ["Leonard Barlow",  ["PG"],       0.55],
    ["Keith Norris",    ["SG"],       0.60],
    ["Maxwell James",   ["SF"],       0.75],
    ["Graham Purcell",  ["PF"],       0.52],
    ["Otis Crane",      ["C"],        0.57],
  ]},
  { franchise: "Toronto Raptors", year: 2009, tier: 2, p: [
    ["Nathan Rhodes",   ["PG"],       0.60],
    ["Ambrose Craig",   ["SG"],       0.62],
    ["Bernard Dukes",   ["SF"],       0.65],
    ["Corwin Lester",   ["PF"],       0.54],
    ["Delbert Lang",    ["C"],        0.58],
  ]},
  { franchise: "Oklahoma City Thunder", year: 2010, tier: 2, p: [
    ["Darius Hobbs",    ["PG"],       0.58],
    ["Oliver Penn",     ["SG"],       0.64],
    ["Frankie Starks",  ["SF"],       0.70],
    ["Marcellus King",  ["PF"],       0.56],
    ["Cornelius Tate",  ["C"],        0.58],
  ]},
  { franchise: "Chicago Bulls", year: 2013, tier: 2, p: [
    ["Lamont Rudd",     ["PG"],       0.68],
    ["Phillip Pratt",   ["SG"],       0.60],
    ["Clayton Webb",    ["SF"],       0.65],
    ["Bertram Fox",     ["PF"],       0.57],
    ["Silas Grant",     ["C"],        0.55],
  ]},
  { franchise: "Washington Wizards", year: 2015, tier: 2, p: [
    ["Alton Branch",    ["PG"],       0.65],
    ["Emmett Hicks",    ["SG"],       0.70],
    ["Darrell Bates",   ["SF"],       0.62],
    ["Leon Pope",       ["PF"],       0.56],
    ["Sampson Cross",   ["C"],        0.60],
  ]},
  { franchise: "Indiana Pacers", year: 2017, tier: 2, p: [
    ["Trevor Combs",    ["PG"],       0.64],
    ["Byron Mack",      ["SG"],       0.66],
    ["Lucas Gibbs",     ["SF"],       0.60],
    ["Raymond Frost",   ["PF"],       0.55],
    ["Doyle Hudson",    ["C"],        0.58],
  ]},
  { franchise: "Utah Jazz", year: 2019, tier: 2, p: [
    ["Marco Haynes",    ["PG"],       0.62],
    ["Prescott Eaton",  ["SG"],       0.58],
    ["Willis Norris",   ["SF", "PF"], 0.68],
    ["Elmer Owens",     ["PF"],       0.55],
    ["Chester Ruiz",    ["C"],        0.62],
  ]},
  { franchise: "New York Knicks", year: 2021, tier: 2, p: [
    ["Otto Lamb",       ["PG"],       0.60],
    ["Dion Pryor",      ["SG"],       0.63],
    ["Harvey Cole",     ["SF"],       0.65],
    ["Fletcher Dunn",   ["PF"],       0.57],
    ["Solomon Webb",    ["C"],        0.59],
  ]},
  { franchise: "Portland Trail Blazers", year: 1990, tier: 2, p: [
    ["Wade Eliot",      ["PG"],       0.66],
    ["Dustin Lowe",     ["SG"],       0.68],
    ["Chandler Rose",   ["SF", "SG"], 0.72],
    ["Elbert Cross",    ["PF"],       0.60],
    ["Nolan Drake",     ["C"],        0.64],
  ]},
  { franchise: "New York Knicks", year: 1994, tier: 2, p: [
    ["Perry Combs",     ["PG"],       0.64],
    ["Lloyd Ash",       ["SG"],       0.62],
    ["Stuart Quinn",    ["SF"],       0.66],
    ["Harvey White",    ["PF"],       0.70],
    ["Amos Drake",      ["C"],        0.67],
  ]},
  { franchise: "Cleveland Cavaliers", year: 2007, tier: 2, p: [
    ["Dennis Stout",    ["PG"],       0.55],
    ["Roland Nix",      ["SG"],       0.60],
    ["Curtis Benton",   ["SF"],       0.78],
    ["Solomon Park",    ["PF"],       0.52],
    ["Hector Floyd",    ["C"],        0.55],
  ]},
  { franchise: "Dallas Mavericks", year: 2022, tier: 2, p: [
    ["Luther Pope",     ["PG"],       0.58],
    ["Weston Dukes",    ["SG"],       0.62],
    ["Beaumont Hall",   ["SF"],       0.60],
    ["Kirk Stone",      ["PF"],       0.66],
    ["Olin Yates",      ["C"],        0.55],
  ]},
  { franchise: "Charlotte Hornets", year: 2016, tier: 2, p: [
    ["Jarvis Penn",     ["PG"],       0.62],
    ["Orlando Bass",    ["SG"],       0.60],
    ["Griffin Hale",    ["SF"],       0.64],
    ["Barrett Mays",    ["PF"],       0.55],
    ["Dex Parrish",     ["C"],        0.58],
  ]},

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3 — G League  (serious playoff contenders)
  // ═══════════════════════════════════════════════════════════════════════════
  { franchise: "Philadelphia 76ers", year: 1981, tier: 3, p: [
    ["Maurice Stokes",  ["PG"],       0.72],
    ["Julius Erving",   ["SG", "SF"], 0.90],
    ["Andrew Toney",    ["SF"],       0.70],
    ["Bobby Nash",      ["PF"],       0.75],
    ["Darryl Holt",     ["C"],        0.78],
  ]},
  { franchise: "Los Angeles Lakers", year: 1984, tier: 3, p: [
    ["Earvin Johnson",  ["PG"],       0.92],
    ["Byron Scott",     ["SG"],       0.72],
    ["James Worthy",    ["SF"],       0.82],
    ["Jamaal Wilkes",   ["PF", "SF"], 0.74],
    ["Kareem Abdul",    ["C"],        0.88],
  ]},
  { franchise: "Detroit Pistons", year: 1988, tier: 3, p: [
    ["Isiah Thomas",    ["PG"],       0.88],
    ["Joe Dumars",      ["SG"],       0.80],
    ["Adrian Dantley",  ["SF"],       0.78],
    ["Dennis Rodman",   ["PF"],       0.72],
    ["Bill Laimbeer",   ["C"],        0.75],
  ]},
  { franchise: "Portland Trail Blazers", year: 1992, tier: 3, p: [
    ["Terry Porter",    ["PG"],       0.74],
    ["Clyde Drexler",   ["SG"],       0.88],
    ["Jerome Kersey",   ["SF"],       0.72],
    ["Buck Williams",   ["PF"],       0.76],
    ["Kevin Duckworth", ["C"],        0.70],
  ]},
  { franchise: "Phoenix Suns", year: 1993, tier: 3, p: [
    ["Kevin Johnson",   ["PG"],       0.80],
    ["Dan Majerle",     ["SG"],       0.74],
    ["Charles Barkley", ["SF", "PF"], 0.92],
    ["Cedric Ceballos", ["PF"],       0.70],
    ["Mark West",       ["C"],        0.65],
  ]},
  { franchise: "Indiana Pacers", year: 1995, tier: 3, p: [
    ["Mark Jackson",    ["PG"],       0.72],
    ["Reggie Miller",   ["SG"],       0.86],
    ["Derrick McKey",   ["SF"],       0.70],
    ["Dale Davis",      ["PF"],       0.72],
    ["Rik Smits",       ["C"],        0.74],
  ]},
  { franchise: "Utah Jazz", year: 1998, tier: 3, p: [
    ["John Stockton",   ["PG"],       0.88],
    ["Jeff Hornacek",   ["SG"],       0.74],
    ["Bryon Russell",   ["SF"],       0.64],
    ["Karl Malone",     ["PF"],       0.90],
    ["Greg Ostertag",   ["C"],        0.62],
  ]},
  { franchise: "Sacramento Kings", year: 2002, tier: 3, p: [
    ["Mike Bibby",      ["PG"],       0.76],
    ["Peja Stojakovic", ["SG", "SF"], 0.84],
    ["Doug Christie",   ["SF"],       0.70],
    ["Chris Webber",    ["PF"],       0.88],
    ["Vlade Divac",     ["C"],        0.72],
  ]},
  { franchise: "Minnesota Timberwolves", year: 2004, tier: 3, p: [
    ["Sam Cassell",     ["PG"],       0.78],
    ["Latrell Sprewell",["SG", "SF"], 0.76],
    ["Trenton Hassell", ["SF"],       0.62],
    ["Kevin Garnett",   ["PF"],       0.92],
    ["Ervin Johnson",   ["C"],        0.62],
  ]},
  { franchise: "Dallas Mavericks", year: 2006, tier: 3, p: [
    ["Devin Harris",    ["PG"],       0.72],
    ["Jerry Stackhouse",["SG"],       0.70],
    ["Josh Howard",     ["SF"],       0.74],
    ["Dirk Nowitzki",   ["PF"],       0.90],
    ["Erick Dampier",   ["C"],        0.65],
  ]},
  { franchise: "Boston Celtics", year: 2008, tier: 3, p: [
    ["Rajon Rondo",     ["PG"],       0.80],
    ["Ray Allen",       ["SG"],       0.82],
    ["Paul Pierce",     ["SF"],       0.84],
    ["Kevin Garnett",   ["PF"],       0.86],
    ["Kendrick Perkins",["C"],        0.68],
  ]},
  { franchise: "Cleveland Cavaliers", year: 2009, tier: 3, p: [
    ["Mo Williams",     ["PG"],       0.72],
    ["Delonte West",    ["SG"],       0.65],
    ["LeBron James",    ["SF"],       0.94],
    ["Antawn Jamison",  ["PF"],       0.70],
    ["Zydrunas Ilgauskas",["C"],      0.68],
  ]},
  { franchise: "Indiana Pacers", year: 2013, tier: 3, p: [
    ["George Hill",     ["PG"],       0.72],
    ["Lance Stephenson",["SG", "SF"], 0.74],
    ["Paul George",     ["SF"],       0.86],
    ["David West",      ["PF"],       0.74],
    ["Roy Hibbert",     ["C"],        0.72],
  ]},
  { franchise: "Toronto Raptors", year: 2016, tier: 3, p: [
    ["Kyle Lowry",      ["PG"],       0.82],
    ["DeMar DeRozan",   ["SG"],       0.84],
    ["DeMarre Carroll", ["SF"],       0.66],
    ["Patrick Patterson",["PF"],      0.64],
    ["Jonas Valanciunas",["C"],       0.72],
  ]},
  { franchise: "Houston Rockets", year: 2018, tier: 3, p: [
    ["Chris Paul",      ["PG"],       0.84],
    ["James Harden",    ["SG"],       0.94],
    ["Trevor Ariza",    ["SF"],       0.66],
    ["P.J. Tucker",     ["PF"],       0.64],
    ["Clint Capela",    ["C"],        0.72],
  ]},
  { franchise: "Philadelphia 76ers", year: 2019, tier: 3, p: [
    ["Ben Simmons",     ["PG", "SF"], 0.78],
    ["Josh Richardson", ["SG"],       0.68],
    ["Jimmy Butler",    ["SF"],       0.86],
    ["Tobias Harris",   ["PF"],       0.78],
    ["Joel Embiid",     ["C"],        0.90],
  ]},
  { franchise: "Utah Jazz", year: 2021, tier: 3, p: [
    ["Mike Conley",     ["PG"],       0.74],
    ["Donovan Mitchell",["SG"],       0.88],
    ["Bojan Bogdanovic",["SF"],       0.72],
    ["Royce O\'Neale", ["PF"],       0.64],
    ["Rudy Gobert",     ["C"],        0.84],
  ]},
  { franchise: "Miami Heat", year: 2022, tier: 3, p: [
    ["Kyle Lowry",      ["PG"],       0.74],
    ["Tyler Herro",     ["SG"],       0.78],
    ["Jimmy Butler",    ["SF"],       0.88],
    ["P.J. Tucker",     ["PF"],       0.66],
    ["Bam Adebayo",     ["C"],        0.82],
  ]},
  { franchise: "Boston Celtics", year: 1984, tier: 3, p: [
    ["Dennis Johnson",  ["PG"],       0.76],
    ["Danny Ainge",     ["SG"],       0.74],
    ["Larry Bird",      ["SF"],       0.94],
    ["Kevin McHale",    ["PF"],       0.88],
    ["Robert Parish",   ["C"],        0.84],
  ]},
  { franchise: "Houston Rockets", year: 1994, tier: 3, p: [
    ["Kenny Smith",     ["PG"],       0.68],
    ["Vernon Maxwell",  ["SG"],       0.70],
    ["Robert Horry",    ["SF"],       0.72],
    ["Otis Thorpe",     ["PF"],       0.70],
    ["Hakeem Olajuwon", ["C"],        0.94],
  ]},
  { franchise: "Seattle SuperSonics", year: 1997, tier: 3, p: [
    ["Gary Payton",     ["PG"],       0.88],
    ["Hersey Hawkins",  ["SG"],       0.72],
    ["Detlef Schrempf", ["SF"],       0.74],
    ["Vin Baker",       ["PF"],       0.76],
    ["Jim McIlvaine",   ["C"],        0.64],
  ]},
  { franchise: "Phoenix Suns", year: 2005, tier: 3, p: [
    ["Steve Nash",      ["PG"],       0.90],
    ["Raja Bell",       ["SG"],       0.68],
    ["Shawn Marion",    ["SF", "PF"], 0.80],
    ["Amare Stoudemire",["PF"],       0.88],
    ["Boris Diaw",      ["C"],        0.72],
  ]},
  { franchise: "Oklahoma City Thunder", year: 2012, tier: 3, p: [
    ["Russell Westbrook",["PG"],      0.88],
    ["James Harden",    ["SG"],       0.82],
    ["Kevin Durant",    ["SF"],       0.94],
    ["Serge Ibaka",     ["PF"],       0.76],
    ["Kendrick Perkins",["C"],        0.64],
  ]},
  { franchise: "Brooklyn Nets", year: 2013, tier: 3, p: [
    ["Deron Williams",  ["PG"],       0.80],
    ["Joe Johnson",     ["SG"],       0.78],
    ["Paul Pierce",     ["SF"],       0.80],
    ["Kevin Garnett",   ["PF"],       0.82],
    ["Brook Lopez",     ["C"],        0.74],
  ]},
  { franchise: "Denver Nuggets", year: 2023, tier: 3, p: [
    ["Jamal Murray",    ["PG"],       0.82],
    ["Kentavious Pope", ["SG"],       0.66],
    ["Michael Porter",  ["SF"],       0.76],
    ["Aaron Gordon",    ["PF"],       0.72],
    ["Nikola Jokic",    ["C"],        0.96],
  ]},
  { franchise: "Los Angeles Clippers", year: 2020, tier: 3, p: [
    ["Patrick Beverley",["PG"],       0.66],
    ["Kawhi Leonard",   ["SG", "SF"], 0.92],
    ["Paul George",     ["SF"],       0.84],
    ["Marcus Morris",   ["PF"],       0.70],
    ["Ivica Zubac",     ["C"],        0.72],
  ]},

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 4 — NBA  (championship-caliber / all-time elite)
  // ═══════════════════════════════════════════════════════════════════════════
  { franchise: "Boston Celtics", year: 1986, tier: 4, p: [
    ["Dennis Johnson",  ["PG"],       0.78],
    ["Danny Ainge",     ["SG"],       0.75],
    ["Larry Bird",      ["SF"],       0.98],
    ["Kevin McHale",    ["PF"],       0.93],
    ["Robert Parish",   ["C"],        0.86],
  ]},
  { franchise: "Los Angeles Lakers", year: 1987, tier: 4, p: [
    ["Magic Johnson",   ["PG"],       0.98],
    ["Byron Scott",     ["SG"],       0.74],
    ["James Worthy",    ["SF"],       0.86],
    ["A.C. Green",      ["PF"],       0.70],
    ["Kareem Abdul",    ["C"],        0.90],
  ]},
  { franchise: "Detroit Pistons", year: 1989, tier: 4, p: [
    ["Isiah Thomas",    ["PG"],       0.90],
    ["Joe Dumars",      ["SG"],       0.83],
    ["Mark Aguirre",    ["SF"],       0.76],
    ["Dennis Rodman",   ["PF"],       0.78],
    ["Bill Laimbeer",   ["C"],        0.76],
  ]},
  { franchise: "Chicago Bulls", year: 1991, tier: 4, p: [
    ["John Paxson",     ["PG"],       0.68],
    ["Michael Jordan",  ["SG"],       1.00],
    ["Scottie Pippen",  ["SF"],       0.90],
    ["Horace Grant",    ["PF"],       0.74],
    ["Will Perdue",     ["C"],        0.62],
  ]},
  { franchise: "Chicago Bulls", year: 1992, tier: 4, p: [
    ["John Paxson",     ["PG"],       0.68],
    ["Michael Jordan",  ["SG"],       1.00],
    ["Scottie Pippen",  ["SF"],       0.91],
    ["Horace Grant",    ["PF"],       0.76],
    ["Bill Cartwright", ["C"],        0.64],
  ]},
  { franchise: "Chicago Bulls", year: 1993, tier: 4, p: [
    ["B.J. Armstrong",  ["PG"],       0.72],
    ["Michael Jordan",  ["SG"],       0.99],
    ["Scottie Pippen",  ["SF"],       0.91],
    ["Horace Grant",    ["PF"],       0.76],
    ["Bill Cartwright", ["C"],        0.64],
  ]},
  { franchise: "Houston Rockets", year: 1995, tier: 4, p: [
    ["Kenny Smith",     ["PG"],       0.68],
    ["Clyde Drexler",   ["SG"],       0.86],
    ["Robert Horry",    ["SF"],       0.74],
    ["Charles Barkley", ["PF"],       0.90],
    ["Hakeem Olajuwon", ["C"],        0.96],
  ]},
  { franchise: "Chicago Bulls", year: 1996, tier: 4, p: [
    ["Ron Harper",      ["PG", "SG"], 0.70],
    ["Michael Jordan",  ["SG"],       1.00],
    ["Scottie Pippen",  ["SF"],       0.92],
    ["Dennis Rodman",   ["PF"],       0.80],
    ["Luc Longley",     ["C"],        0.68],
  ]},
  { franchise: "Chicago Bulls", year: 1997, tier: 4, p: [
    ["Ron Harper",      ["PG", "SG"], 0.70],
    ["Michael Jordan",  ["SG"],       0.99],
    ["Scottie Pippen",  ["SF"],       0.91],
    ["Dennis Rodman",   ["PF"],       0.80],
    ["Luc Longley",     ["C"],        0.68],
  ]},
  { franchise: "Chicago Bulls", year: 1998, tier: 4, p: [
    ["Ron Harper",      ["PG", "SG"], 0.70],
    ["Michael Jordan",  ["SG"],       0.98],
    ["Scottie Pippen",  ["SF"],       0.90],
    ["Dennis Rodman",   ["PF"],       0.78],
    ["Luc Longley",     ["C"],        0.66],
  ]},
  { franchise: "San Antonio Spurs", year: 1999, tier: 4, p: [
    ["Avery Johnson",   ["PG"],       0.74],
    ["Jaren Jackson",   ["SG"],       0.68],
    ["Sean Elliott",    ["SF"],       0.72],
    ["Tim Duncan",      ["PF"],       0.94],
    ["David Robinson",  ["C"],        0.88],
  ]},
  { franchise: "Los Angeles Lakers", year: 2000, tier: 4, p: [
    ["Derek Fisher",    ["PG"],       0.70],
    ["Kobe Bryant",     ["SG"],       0.92],
    ["Glen Rice",       ["SF"],       0.76],
    ["A.C. Green",      ["PF"],       0.66],
    ["Shaquille O\'Neal",["C"],      0.98],
  ]},
  { franchise: "Los Angeles Lakers", year: 2001, tier: 4, p: [
    ["Derek Fisher",    ["PG"],       0.70],
    ["Kobe Bryant",     ["SG"],       0.93],
    ["Rick Fox",        ["SF"],       0.72],
    ["Robert Horry",    ["PF"],       0.72],
    ["Shaquille O\'Neal",["C"],      0.98],
  ]},
  { franchise: "Los Angeles Lakers", year: 2002, tier: 4, p: [
    ["Derek Fisher",    ["PG"],       0.70],
    ["Kobe Bryant",     ["SG"],       0.94],
    ["Rick Fox",        ["SF"],       0.72],
    ["Robert Horry",    ["PF"],       0.73],
    ["Shaquille O\'Neal",["C"],      0.97],
  ]},
  { franchise: "San Antonio Spurs", year: 2003, tier: 4, p: [
    ["Tony Parker",     ["PG"],       0.82],
    ["Manu Ginobili",   ["SG"],       0.86],
    ["Stephen Jackson", ["SF"],       0.70],
    ["Tim Duncan",      ["PF"],       0.96],
    ["David Robinson",  ["C"],        0.80],
  ]},
  { franchise: "Detroit Pistons", year: 2004, tier: 4, p: [
    ["Chauncey Billups",["PG"],       0.86],
    ["Richard Hamilton",["SG"],       0.82],
    ["Tayshaun Prince", ["SF"],       0.74],
    ["Rasheed Wallace", ["PF"],       0.82],
    ["Ben Wallace",     ["C"],        0.80],
  ]},
  { franchise: "San Antonio Spurs", year: 2005, tier: 4, p: [
    ["Tony Parker",     ["PG"],       0.84],
    ["Manu Ginobili",   ["SG"],       0.88],
    ["Bruce Bowen",     ["SF"],       0.68],
    ["Tim Duncan",      ["PF"],       0.95],
    ["Nazr Mohammed",   ["C"],        0.68],
  ]},
  { franchise: "Miami Heat", year: 2006, tier: 4, p: [
    ["Jason Williams",  ["PG"],       0.72],
    ["Dwyane Wade",     ["SG"],       0.94],
    ["Gary Payton",     ["SF"],       0.70],
    ["Udonis Haslem",   ["PF"],       0.70],
    ["Shaquille O\'Neal",["C"],      0.90],
  ]},
  { franchise: "San Antonio Spurs", year: 2007, tier: 4, p: [
    ["Tony Parker",     ["PG"],       0.88],
    ["Manu Ginobili",   ["SG"],       0.88],
    ["Bruce Bowen",     ["SF"],       0.68],
    ["Tim Duncan",      ["PF"],       0.94],
    ["Francisco Elson", ["C"],        0.64],
  ]},
  { franchise: "Los Angeles Lakers", year: 2010, tier: 4, p: [
    ["Derek Fisher",    ["PG"],       0.68],
    ["Kobe Bryant",     ["SG"],       0.94],
    ["Ron Artest",      ["SF"],       0.78],
    ["Pau Gasol",       ["PF"],       0.88],
    ["Andrew Bynum",    ["C"],        0.76],
  ]},
  { franchise: "Dallas Mavericks", year: 2011, tier: 4, p: [
    ["Jason Kidd",      ["PG"],       0.74],
    ["Jason Terry",     ["SG"],       0.76],
    ["Shawn Marion",    ["SF"],       0.74],
    ["Dirk Nowitzki",   ["PF"],       0.96],
    ["Tyson Chandler",  ["C"],        0.78],
  ]},
  { franchise: "Miami Heat", year: 2012, tier: 4, p: [
    ["Mario Chalmers",  ["PG"],       0.68],
    ["Dwyane Wade",     ["SG"],       0.90],
    ["LeBron James",    ["SF"],       0.98],
    ["Chris Bosh",      ["PF"],       0.84],
    ["Udonis Haslem",   ["C"],        0.68],
  ]},
  { franchise: "Miami Heat", year: 2013, tier: 4, p: [
    ["Mario Chalmers",  ["PG"],       0.68],
    ["Dwyane Wade",     ["SG"],       0.88],
    ["LeBron James",    ["SF"],       0.99],
    ["Chris Bosh",      ["PF"],       0.84],
    ["Chris Andersen",  ["C"],        0.70],
  ]},
  { franchise: "San Antonio Spurs", year: 2014, tier: 4, p: [
    ["Tony Parker",     ["PG"],       0.84],
    ["Manu Ginobili",   ["SG"],       0.82],
    ["Kawhi Leonard",   ["SF"],       0.86],
    ["Tim Duncan",      ["PF"],       0.88],
    ["Boris Diaw",      ["C"],        0.76],
  ]},
  { franchise: "Golden State Warriors", year: 2015, tier: 4, p: [
    ["Stephen Curry",   ["PG"],       0.98],
    ["Klay Thompson",   ["SG"],       0.88],
    ["Harrison Barnes", ["SF"],       0.72],
    ["Draymond Green",  ["PF"],       0.84],
    ["Andrew Bogut",    ["C"],        0.74],
  ]},
  { franchise: "Cleveland Cavaliers", year: 2016, tier: 4, p: [
    ["Kyrie Irving",    ["PG"],       0.88],
    ["J.R. Smith",      ["SG"],       0.72],
    ["LeBron James",    ["SF"],       0.99],
    ["Kevin Love",      ["PF"],       0.82],
    ["Tristan Thompson",["C"],        0.74],
  ]},
  { franchise: "Golden State Warriors", year: 2017, tier: 4, p: [
    ["Stephen Curry",   ["PG"],       0.98],
    ["Klay Thompson",   ["SG"],       0.90],
    ["Kevin Durant",    ["SF"],       0.98],
    ["Draymond Green",  ["PF"],       0.86],
    ["Zaza Pachulia",   ["C"],        0.68],
  ]},
  { franchise: "Golden State Warriors", year: 2018, tier: 4, p: [
    ["Stephen Curry",   ["PG"],       0.97],
    ["Klay Thompson",   ["SG"],       0.90],
    ["Kevin Durant",    ["SF"],       0.98],
    ["Draymond Green",  ["PF"],       0.86],
    ["Kevon Looney",    ["C"],        0.70],
  ]},
  { franchise: "Toronto Raptors", year: 2019, tier: 4, p: [
    ["Kyle Lowry",      ["PG"],       0.82],
    ["Danny Green",     ["SG"],       0.70],
    ["Kawhi Leonard",   ["SF"],       0.96],
    ["Pascal Siakam",   ["PF"],       0.82],
    ["Marc Gasol",      ["C"],        0.78],
  ]},
  { franchise: "Milwaukee Bucks", year: 2021, tier: 4, p: [
    ["Jrue Holiday",    ["PG"],       0.82],
    ["Khris Middleton", ["SG"],       0.84],
    ["Giannis Antetokounmpo",["SF","PF"],0.98],
    ["P.J. Tucker",     ["PF"],       0.66],
    ["Brook Lopez",     ["C"],        0.76],
  ]},
  { franchise: "Golden State Warriors", year: 2022, tier: 4, p: [
    ["Stephen Curry",   ["PG"],       0.96],
    ["Klay Thompson",   ["SG"],       0.84],
    ["Andrew Wiggins",  ["SF"],       0.76],
    ["Draymond Green",  ["PF"],       0.82],
    ["Kevon Looney",    ["C"],        0.72],
  ]},
  { franchise: "Denver Nuggets", year: 2023, tier: 4, p: [
    ["Jamal Murray",    ["PG"],       0.86],
    ["Michael Porter",  ["SG", "SF"], 0.80],
    ["Kentavious Caldwell-Pope",["SF"],0.70],
    ["Aaron Gordon",    ["PF"],       0.74],
    ["Nikola Jokic",    ["C"],        0.98],
  ]},
  { franchise: "Boston Celtics", year: 2024, tier: 4, p: [
    ["Jrue Holiday",    ["PG"],       0.80],
    ["Jaylen Brown",    ["SG"],       0.88],
    ["Jayson Tatum",    ["SF"],       0.94],
    ["Al Horford",      ["PF"],       0.76],
    ["Kristaps Porzingis",["C"],      0.82],
  ]},
  { franchise: "Los Angeles Lakers", year: 1985, tier: 4, p: [
    ["Magic Johnson",   ["PG"],       0.97],
    ["Byron Scott",     ["SG"],       0.73],
    ["James Worthy",    ["SF"],       0.84],
    ["Kurt Rambis",     ["PF"],       0.68],
    ["Kareem Abdul",    ["C"],        0.91],
  ]},
  { franchise: "Philadelphia 76ers", year: 1983, tier: 4, p: [
    ["Mo Cheeks",       ["PG"],       0.80],
    ["Andrew Toney",    ["SG"],       0.82],
    ["Julius Erving",   ["SF"],       0.92],
    ["Marc Iavaroni",   ["PF"],       0.66],
    ["Moses Malone",    ["C"],        0.94],
  ]},
];
/* eslint-enable prettier/prettier */

export const HISTORICAL_TEAMS: HistoricalTeam[] = RAW.map(buildTeam);
