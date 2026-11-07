// Pure functions on tracker state. They never mutate their input and never touch the DOM.
import { TrackerRow, TrackerState } from './types';

export const STATE_VERSION = 1;

let idCounter = 0;
/** Short unique id for a row. */
export function makeId(): string {
  idCounter += 1;
  return 'r' + idCounter.toString(36) + Math.random().toString(36).slice(2, 7);
}

/** How many empty rows a new or cleared encounter starts with, as on the first tracker. */
export const BLANK_ROWS = 5;

function blankRows(): TrackerRow[] {
  return Array.from({ length: BLANK_ROWS }, () => ({
    id: makeId(),
    name: '',
    initiative: 0,
    initiativeBonus: 0,
    hp: 0,
    maxHp: 0,
    ac: 0,
  }));
}

/** A new encounter: round 1 and five empty rows to type into. */
export function createState(): TrackerState {
  return { version: STATE_VERSION, name: 'New encounter', round: 1, turn: 0, rows: blankRows() };
}

/** True for a row nobody has filled in yet (no name, no numbers, not linked). */
export function isBlankRow(row: TrackerRow): boolean {
  return (
    !row.name.trim() &&
    !row.link &&
    !row.monsterId &&
    !row.initiative &&
    !row.initiativeBonus &&
    !row.hp &&
    !row.maxHp &&
    !row.ac
  );
}

/** True when the encounter has something worth keeping: at least one filled-in row. */
export function hasContent(state: TrackerState): boolean {
  return state.rows.some((r) => !isBlankRow(r));
}

/**
 * The state without its empty rows, as it is kept in a saved encounter (the first tracker kept
 * only filled-in rows too). The creature whose turn it is stays active.
 */
export function withoutBlankRows(state: TrackerState): TrackerState {
  const rows = state.rows.filter((r) => !isBlankRow(r));
  if (rows.length === state.rows.length) return state;
  return { ...state, rows, turn: turnOf(rows, activeId(state), 0) };
}

function activeId(state: TrackerState): string | undefined {
  return state.rows[state.turn] && state.rows[state.turn].id;
}

function turnOf(rows: TrackerRow[], id: string | undefined, fallback: number): number {
  const at = rows.findIndex((r) => r.id === id);
  if (at >= 0) return at;
  return Math.min(Math.max(fallback, 0), Math.max(rows.length - 1, 0));
}

/**
 * Highest initiative first; empty rows go to the bottom. Ties go to the higher bonus, then to
 * the row that was earlier.
 * Before combat has started (round 1, first turn) the turn goes back to the top row;
 * mid-combat the creature whose turn it is stays active.
 */
export function sortByInitiative(state: TrackerState): TrackerState {
  const sorted = state.rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(isBlankRow(a.row)) - Number(isBlankRow(b.row)) ||
        b.row.initiative - a.row.initiative ||
        b.row.initiativeBonus - a.row.initiativeBonus ||
        a.index - b.index,
    )
    .map((x) => x.row);
  const started = state.round > 1 || state.turn > 0;
  return {
    ...state,
    rows: sorted,
    turn: started ? turnOf(sorted, activeId(state), 0) : 0,
  };
}

/**
 * Moves to the next creature, skipping empty rows. After the last one it wraps to the first and
 * the round goes up. With nothing filled in, it steps through the rows as they are.
 */
export function nextTurn(state: TrackerState): TrackerState {
  const n = state.rows.length;
  if (n === 0) return state;
  const filled = state.rows.some((r) => !isBlankRow(r));
  let turn = state.turn;
  let round = state.round;
  for (let step = 0; step < n; step++) {
    turn += 1;
    if (turn >= n) {
      turn = 0;
      round += 1;
    }
    if (!filled || !isBlankRow(state.rows[turn])) break;
  }
  return { ...state, turn, round };
}

export function resetRound(state: TrackerState): TrackerState {
  return { ...state, round: 1, turn: 0 };
}

/** d20 + bonus. `rng` returns [0, 1) like Math.random. */
export function rollInitiative(bonus: number, rng: () => number = Math.random): number {
  const die = Math.min(20, Math.floor(rng() * 20) + 1);
  return die + (Number(bonus) || 0);
}

export function addRow(
  state: TrackerState,
  init: Partial<TrackerRow> = {},
  id: string = makeId(),
): TrackerState {
  const row: TrackerRow = {
    id,
    name: '',
    initiative: 0,
    initiativeBonus: 0,
    hp: 0,
    maxHp: 0,
    ac: 0,
    ...init,
  };
  return { ...state, rows: [...state.rows, row] };
}

export function removeRow(state: TrackerState, id: string): TrackerState {
  const at = state.rows.findIndex((r) => r.id === id);
  if (at < 0) return state;
  const rows = state.rows.filter((r) => r.id !== id);
  let turn = state.turn;
  if (at < turn) turn -= 1;
  // The next creature inherits the turn when the active one leaves; past the end wraps to 0.
  if (turn >= rows.length) turn = 0;
  return { ...state, rows, turn };
}

/** Removes every creature and starts again at round 1 with five empty rows. Keeps the name. */
export function clear(state: TrackerState): TrackerState {
  return { ...state, rows: blankRows(), round: 1, turn: 0 };
}

export function updateRow(
  state: TrackerState,
  id: string,
  patch: Partial<TrackerRow>,
): TrackerState {
  return { ...state, rows: state.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Ties `link` to a row, so a prepared encounter can be matched up with what is on the table: the
 * row that already has the link, else the first unlinked row with the same name, else the first
 * empty row, else a new row. `id` is used for a new row.
 */
export function linkRow(
  state: TrackerState,
  link: string,
  fields: Partial<TrackerRow> = {},
  id: string = makeId(),
): TrackerState {
  const target =
    state.rows.find((r) => r.link === link) ||
    state.rows.find((r) => !r.link && sameName(r.name, fields.name || '')) ||
    state.rows.find(isBlankRow);
  if (!target) return addRow(state, { ...fields, link }, id);
  // A row that already has a name keeps it: that may be how the table knows this creature.
  const name = target.name.trim() ? target.name : fields.name || '';
  return updateRow(state, target.id, { ...fields, name, link });
}

/** Moves a row up (-1) or down (+1). The active creature stays active. */
export function moveRow(state: TrackerState, id: string, delta: number): TrackerState {
  const from = state.rows.findIndex((r) => r.id === id);
  return moveRowTo(state, id, from + delta);
}

/** Moves a row to a given index (clamped). The active creature stays active. */
export function moveRowTo(state: TrackerState, id: string, to: number): TrackerState {
  const from = state.rows.findIndex((r) => r.id === id);
  const target = Math.min(Math.max(to, 0), state.rows.length - 1);
  if (from < 0 || target === from) return state;
  const rows = state.rows.slice();
  const [row] = rows.splice(from, 1);
  rows.splice(target, 0, row);
  return { ...state, rows, turn: turnOf(rows, activeId(state), state.turn) };
}

export interface HpResult {
  hp: number;
  maxHp: number;
}

/**
 * Adds `delta` (negative for damage) to HP: never below 0, and never above max HP when a max is
 * set. Used by both the typed "-5" / "+3" and the - / + buttons, so they follow the same rules.
 */
export function changeHp(hp: number, maxHp: number, delta: number): number {
  let next = Math.max(0, hp + (Number(delta) || 0));
  if (maxHp > 0) next = Math.min(next, maxHp);
  return next;
}

/**
 * Applies what was typed in the HP field. "-5" and "+3" change the current value (see
 * `changeHp`). A plain number sets the value; it also raises max HP if it is higher. Anything
 * else leaves HP unchanged.
 */
export function applyHpInput(text: string, hp: number, maxHp: number): HpResult {
  const t = String(text).trim().replace(/−/g, '-');
  if (/^[+-]\s*\d+$/.test(t)) {
    return { hp: changeHp(hp, maxHp, parseInt(t.replace(/\s+/g, ''), 10)), maxHp };
  }
  if (/^\d+$/.test(t)) {
    const next = parseInt(t, 10);
    return { hp: next, maxHp: Math.max(maxHp, next) };
  }
  return { hp, maxHp };
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && isFinite(n) ? Math.trunc(n) : fallback;
}

/** Turns whatever was saved (any version, maybe damaged) into a valid current-version state. */
export function migrate(input: unknown): TrackerState {
  if (!input || typeof input !== 'object') return createState();
  const raw = input as Record<string, unknown>;
  const seen = new Set<string>();
  const rows: TrackerRow[] = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter((r) => r && typeof r === 'object')
    .map((r: Record<string, unknown>) => {
      let id = typeof r.id === 'string' && r.id ? r.id : makeId();
      while (seen.has(id)) id = makeId();
      seen.add(id);
      const hp = Math.max(0, int(r.hp, 0));
      const row: TrackerRow = {
        id,
        name: typeof r.name === 'string' ? r.name : '',
        initiative: int(r.initiative, 0),
        initiativeBonus: int(r.initiativeBonus, 0),
        hp,
        maxHp: Math.max(0, int(r.maxHp, hp)),
        ac: Math.max(0, int(r.ac, 10)),
      };
      if (typeof r.monsterId === 'string' && r.monsterId) row.monsterId = r.monsterId;
      if (typeof r.link === 'string' && r.link) row.link = r.link;
      return row;
    });
  const turn = Math.min(Math.max(int(raw.turn, 0), 0), Math.max(rows.length - 1, 0));
  const state: TrackerState = {
    version: STATE_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'New encounter',
    round: Math.max(1, int(raw.round, 1)),
    turn,
    rows,
  };
  if (typeof raw.encounterId === 'string' && raw.encounterId) state.encounterId = raw.encounterId;
  return state;
}
