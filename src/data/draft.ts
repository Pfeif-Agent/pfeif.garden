// World Cup 2026 — The Thread draft. LOCKED DATA. Do not edit values without re-checking the screenshots/odds.
// manager index: 0=Jacob, 1=Taylor, 2=Brad. Colors match the stadium theme.

export interface Manager { name: string; color: string; }
export interface Team {
  name: string;
  code: string;            // lowercase ESPN country abbreviation (e.g. "usa") — builds the flag URL
  group: string; odds: string; oddsValue: number; // oddsValue = decimal-ish X from "X/1" (lower = stronger)
  pick: number;            // overall snake-draft pick number 1..48
  manager: number;         // index into MANAGERS
}

/** ESPN's circular-ready country flag PNG for a team code (or null if unknown). */
export const flagUrl = (code: string | undefined): string | null =>
  code ? `https://a.espncdn.com/i/teamlogos/countries/500/${code}.png` : null;

export const MANAGERS: Manager[] = [
  { name: "Jacob", color: "#FF6B5E" },
  { name: "Taylor", color: "#4EA8FF" },
  { name: "Brad", color: "#B57BFF" }
];

// All 48 teams as drafted (snake order). oddsValue is the numeric title price (e.g. "9/2" -> 4.5).
export const TEAMS: Team[] = [
  { name: "Spain", code: "esp", group: "H", odds: "9/2", oddsValue: 4.5, pick: 1, manager: 1 },
  { name: "Argentina", code: "arg", group: "J", odds: "9/1", oddsValue: 9, pick: 2, manager: 0 },
  { name: "France", code: "fra", group: "I", odds: "5/1", oddsValue: 5, pick: 3, manager: 2 },
  { name: "England", code: "eng", group: "L", odds: "7/1", oddsValue: 7, pick: 4, manager: 2 },
  { name: "Brazil", code: "bra", group: "C", odds: "9/1", oddsValue: 9, pick: 5, manager: 0 },
  { name: "Portugal", code: "por", group: "K", odds: "8/1", oddsValue: 8, pick: 6, manager: 1 },
  { name: "Germany", code: "ger", group: "E", odds: "14/1", oddsValue: 14, pick: 7, manager: 1 },
  { name: "Morocco", code: "mar", group: "C", odds: "40/1", oddsValue: 40, pick: 8, manager: 0 },
  { name: "United States", code: "usa", group: "D", odds: "50/1", oddsValue: 50, pick: 9, manager: 2 },
  { name: "Mexico", code: "mex", group: "A", odds: "66/1", oddsValue: 66, pick: 10, manager: 2 },
  { name: "Japan", code: "jpn", group: "F", odds: "50/1", oddsValue: 50, pick: 11, manager: 0 },
  { name: "Netherlands", code: "ned", group: "F", odds: "20/1", oddsValue: 20, pick: 12, manager: 1 },
  { name: "Belgium", code: "bel", group: "G", odds: "33/1", oddsValue: 33, pick: 13, manager: 1 },
  { name: "Colombia", code: "col", group: "K", odds: "40/1", oddsValue: 40, pick: 14, manager: 0 },
  { name: "Switzerland", code: "sui", group: "B", odds: "66/1", oddsValue: 66, pick: 15, manager: 2 },
  { name: "Canada", code: "can", group: "B", odds: "150/1", oddsValue: 150, pick: 16, manager: 2 },
  { name: "Norway", code: "nor", group: "I", odds: "33/1", oddsValue: 33, pick: 17, manager: 0 },
  { name: "Senegal", code: "sen", group: "I", odds: "66/1", oddsValue: 66, pick: 18, manager: 1 },
  { name: "Croatia", code: "cro", group: "L", odds: "80/1", oddsValue: 80, pick: 19, manager: 1 },
  { name: "South Korea", code: "kor", group: "A", odds: "250/1", oddsValue: 250, pick: 20, manager: 0 },
  { name: "Uruguay", code: "uru", group: "H", odds: "66/1", oddsValue: 66, pick: 21, manager: 2 },
  { name: "Türkiye", code: "tur", group: "D", odds: "66/1", oddsValue: 66, pick: 22, manager: 2 },
  { name: "Ecuador", code: "ecu", group: "E", odds: "80/1", oddsValue: 80, pick: 23, manager: 0 },
  { name: "Egypt", code: "egy", group: "G", odds: "250/1", oddsValue: 250, pick: 24, manager: 1 },
  { name: "Algeria", code: "alg", group: "J", odds: "250/1", oddsValue: 250, pick: 25, manager: 1 },
  { name: "Sweden", code: "swe", group: "F", odds: "100/1", oddsValue: 100, pick: 26, manager: 0 },
  { name: "Scotland", code: "sco", group: "C", odds: "250/1", oddsValue: 250, pick: 27, manager: 2 },
  { name: "Austria", code: "aut", group: "J", odds: "150/1", oddsValue: 150, pick: 28, manager: 2 },
  { name: "Ivory Coast", code: "civ", group: "E", odds: "200/1", oddsValue: 200, pick: 29, manager: 0 },
  { name: "Bosnia & Herzegovina", code: "bih", group: "B", odds: "250/1", oddsValue: 250, pick: 30, manager: 1 },
  { name: "Paraguay", code: "par", group: "D", odds: "250/1", oddsValue: 250, pick: 31, manager: 1 },
  { name: "Czechia", code: "cze", group: "A", odds: "250/1", oddsValue: 250, pick: 32, manager: 0 },
  { name: "Australia", code: "aus", group: "D", odds: "500/1", oddsValue: 500, pick: 33, manager: 2 },
  { name: "DR Congo", code: "cod", group: "K", odds: "750/1", oddsValue: 750, pick: 34, manager: 2 },
  { name: "Qatar", code: "qat", group: "B", odds: "1000/1", oddsValue: 1000, pick: 35, manager: 0 },
  { name: "Iran", code: "irn", group: "G", odds: "500/1", oddsValue: 500, pick: 36, manager: 1 },
  { name: "Ghana", code: "gha", group: "L", odds: "500/1", oddsValue: 500, pick: 37, manager: 1 },
  { name: "Haiti", code: "hai", group: "C", odds: "2500/1", oddsValue: 2500, pick: 38, manager: 0 },
  { name: "Tunisia", code: "tun", group: "F", odds: "500/1", oddsValue: 500, pick: 39, manager: 2 },
  { name: "Saudi Arabia", code: "ksa", group: "H", odds: "1000/1", oddsValue: 1000, pick: 40, manager: 2 },
  { name: "Panama", code: "pan", group: "L", odds: "1000/1", oddsValue: 1000, pick: 41, manager: 0 },
  { name: "Cape Verde", code: "cpv", group: "H", odds: "1000/1", oddsValue: 1000, pick: 42, manager: 1 },
  { name: "New Zealand", code: "nzl", group: "G", odds: "1000/1", oddsValue: 1000, pick: 43, manager: 1 },
  { name: "Iraq", code: "irq", group: "I", odds: "1000/1", oddsValue: 1000, pick: 44, manager: 0 },
  { name: "Jordan", code: "jor", group: "J", odds: "1000/1", oddsValue: 1000, pick: 45, manager: 2 },
  { name: "Uzbekistan", code: "uzb", group: "K", odds: "1000/1", oddsValue: 1000, pick: 46, manager: 2 },
  { name: "Curaçao", code: "cuw", group: "E", odds: "2500/1", oddsValue: 2500, pick: 47, manager: 0 },
  { name: "South Africa", code: "rsa", group: "A", odds: "1000/1", oddsValue: 1000, pick: 48, manager: 1 }
];

// Scoring ladder ("B+2"). Points go to whoever drafted the team.
// Knockout winner decided by penalties if needed. Third-place playoff scores nothing.
export const SCORING = {
  groupWin: 3,
  groupDraw: 1,
  advanceToR32: 2,   // bonus for escaping the group (reaching the Round of 32)
  winR32: 4,
  winR16: 6,
  winQF: 8,
  winSF: 10,
  winFinal: 12,
  thirdPlacePlayoff: 0,
} as const;
// Max for a group-winning champion: 9 (group) + 2 + 4+6+8+10+12 = 51.

// ESPN / openfootball name -> our roster spelling.
export const ALIASES: Record<string,string> = {
  "Czech Republic": "Czechia",
  "Turkey": "Türkiye",
  "USA": "United States",
  "Bosnia-Herzegovina": "Bosnia & Herzegovina", // ESPN fifa.world spelling
  "Congo DR": "DR Congo",                        // ESPN fifa.world spelling
};

export const TEAM_BY_NAME: Record<string, Team> =
  Object.fromEntries(TEAMS.map(t => [t.name, t]));
export const managerOf = (teamName: string): number | null =>
  TEAM_BY_NAME[teamName]?.manager ?? null;
