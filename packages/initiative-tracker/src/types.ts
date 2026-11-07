import type { Monster } from './statblock';

// Plain interfaces for the tracker's state and options. The state is JSON-serialisable and
// versioned (`version`) so saved encounters can be migrated when the shape changes.

export interface TrackerRow {
  id: string;
  name: string;
  initiative: number;
  /** Added to the d20 when rolling initiative. */
  initiativeBonus: number;
  hp: number;
  maxHp: number;
  ac: number;
  /** Id of the creature template this row was filled from, if any. */
  monsterId?: string;
  /**
   * Ties the row to something outside the tracker, such as a token on a map. The tracker only
   * stores it; the host app decides what it means (see `linkRow` and `onRowEdit`).
   */
  link?: string;
}

export interface TrackerState {
  version: number;
  name: string;
  /** Starts at 1. */
  round: number;
  /** Index into `rows` of the creature whose turn it is. */
  turn: number;
  rows: TrackerRow[];
  /**
   * Only in the autosaved last session: the id of the saved encounter it is a copy of, so the
   * tracker carries on saving into that encounter after a reload.
   */
  encounterId?: string;
}

/** A creature the name field can autocomplete. */
export interface CreatureTemplate {
  id: string;
  name: string;
  ac: number;
  hp: number;
  hitDice?: string;
  /** Dexterity score; the initiative bonus is floor((dex - 10) / 2). */
  dex?: number;
  /** Used instead of `dex` when given. */
  initiativeBonus?: number;
  cr?: number;
  /** Creature level, for game systems that use levels (Pathfinder). */
  level?: number;
  /**
   * A short tag for the game system, e.g. "5e" or "PF2e". When the list mixes systems, each
   * suggestion shows it as a small badge in front of the name.
   */
  ruleset?: string;
}

export interface EncounterSummary {
  id: string;
  name: string;
}

/**
 * Where saved encounters (and the autosaved "last session") live. All methods are async so a
 * host can back it with a server. Every encounter with something in it is saved on its own:
 * `save(null, state)` creates it and resolves to its id, later changes call `save(id, state)`.
 * A host that wants to cap how many encounters a user may keep rejects `save` with an error
 * whose `code` is 'LIMIT'; the tracker then calls `onLimit` and shows a short message. A
 * rejection with `status` 404 or `code` 'NOT_FOUND' (the encounter was deleted elsewhere) makes
 * the tracker save it again as a new one.
 */
export interface EncounterStorage {
  list(): Promise<EncounterSummary[]>;
  load(id: string): Promise<TrackerState | null>;
  save(id: string | null, state: TrackerState): Promise<string>;
  remove(id: string): Promise<void>;
}

export interface TrackerOptions {
  /** Encounter storage. Defaults to localStorage when available; `null` turns storage off. */
  storage?: EncounterStorage | null;
  /**
   * Autocomplete list. Replaces the built-in list (`defaultCreatures`: `srdCreatures` then
   * `pf2eCreatures`); spread those into yours to extend it.
   */
  creatures?: CreatureTemplate[];
  /** Random source returning [0, 1). Defaults to Math.random. */
  rng?: () => number;
  /** Called after every change the user makes (not after `setState`). */
  onChange?: (state: TrackerState) => void;
  /** Called when the user changes the HP, max HP or AC of a linked row. */
  onRowEdit?: (row: TrackerRow) => void;
  /** Called after an encounter was opened or the last session restored. */
  onLoad?: (state: TrackerState) => void;
  /** When given, linked rows show a button that calls this. */
  onLinkClick?: (row: TrackerRow) => void;
  /** Called when `storage.save` rejects with `code === 'LIMIT'`. */
  onLimit?: (reason: string) => void;
  /** State to start with, instead of restoring the last session. */
  initialState?: TrackerState;
  /** Milliseconds to wait after the last change before autosaving. Default 400. */
  autosaveDelay?: number;
  /**
   * When given, a row filled from the creature list (by default the SRD part of it) gets a small button in its name cell that
   * opens the creature's stat block in a panel beside the tracker. `load` is called with the
   * row's `monsterId` the first time (the result is kept) and resolves to the stat block, or
   * null when there is none. `pageUrl`, when given, adds a link to a full page.
   */
  statBlocks?: StatBlockSource;
}

export interface StatBlockSource {
  load(id: string): Promise<Monster | null>;
  /** Which rows get the button. Default: the SRD creatures (`srdCreatures`). */
  has?: (id: string) => boolean;
  pageUrl?: (id: string) => string;
}

export interface Tracker {
  getState(): TrackerState;
  /** Replaces the whole state (migrated first) and re-renders. Does not call `onChange`. */
  setState(state: TrackerState): void;
  /**
   * Ties `link` to a row and returns that row: the row that already has it, else the first unlinked
   * row with the same name, else a new one. `fields` fill the row in. Does not call `onChange`.
   */
  linkRow(link: string, fields?: Partial<TrackerRow>): TrackerRow;
  /** Changes every row with this link (`link: undefined` unties it). Does not call `onRowEdit`. */
  updateLinked(link: string, patch: Partial<TrackerRow>): void;
  destroy(): void;
  /** Resolves once the last session has been restored (or there was nothing to restore). */
  ready: Promise<void>;
}
