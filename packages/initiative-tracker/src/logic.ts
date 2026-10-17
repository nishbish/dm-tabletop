// Pure functions on tracker state. They never mutate their input and never touch the DOM.
import { TrackerRow, TrackerState } from './types';

export const STATE_VERSION = 1;

let idCounter = 0;
/** Short unique id for a row. */
export function makeId(): string {
  idCounter += 1;
  return 'r' + idCounter.toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createState(): TrackerState {
  return { version: STATE_VERSION, name: 'New encounter', round: 1, turn: 0, rows: [] };
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
 * Highest initiative first. Ties go to the higher bonus, then to the row that was earlier.
 * Before combat has started (round 1, first turn) the turn goes back to the top row;
 * mid-combat the creature whose turn it is stays active.
 */
export function sortByInitiative(state: TrackerState): TrackerState {
  const sorted = state.rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
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

/** Moves to the next row. After the last row it wraps to the first and the round goes up. */
export function nextTurn(state: TrackerState): TrackerState {
  if (state.rows.length === 0) return state;
  const next = state.turn + 1;
  if (next >= state.rows.length) return { ...state, turn: 0, round: state.round + 1 };
  return { ...state, turn: next };
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
    ac: 10,
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

/** Removes every row and starts again at round 1. Keeps the encounter name. */
export function clear(state: TrackerState): TrackerState {
  return { ...state, rows: [], round: 1, turn: 0 };
}

export function updateRow(
  state: TrackerState,
  id: string,
  patch: Partial<TrackerRow>,
): TrackerState {
  return { ...state, rows: state.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
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
 * Applies what was typed in the HP field. "-5" and "+3" change the current value (never below 0,
 * and never above max HP when a max is set). A plain number sets the value; it also raises max
 * HP if it is higher. Anything else leaves HP unchanged.
 */
export function applyHpInput(text: string, hp: number, maxHp: number): HpResult {
  const t = String(text).trim().replace(/−/g, '-');
  if (/^[+-]\s*\d+$/.test(t)) {
    let next = hp + parseInt(t.replace(/\s+/g, ''), 10);
    next = Math.max(0, next);
    if (maxHp > 0) next = Math.min(next, maxHp);
    return { hp: next, maxHp };
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
      return row;
    });
  const turn = Math.min(Math.max(int(raw.turn, 0), 0), Math.max(rows.length - 1, 0));
  return {
    version: STATE_VERSION,
    name: typeof raw.name === 'string' ? raw.name : createState().name,
    round: Math.max(1, int(raw.round, 1)),
    turn,
    rows,
  };
}
