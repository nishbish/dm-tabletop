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
}

export interface TrackerState {
  version: number;
  name: string;
  /** Starts at 1. */
  round: number;
  /** Index into `rows` of the creature whose turn it is. */
  turn: number;
  rows: TrackerRow[];
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
}

export interface EncounterSummary {
  id: string;
  name: string;
}

/**
 * Where named encounters (and the autosaved "last session") live. All methods are async so a
 * host can back it with a server. `save(null, state)` creates a new encounter and resolves to
 * its id. A host that wants to cap how many encounters a user may keep rejects `save` with an
 * error whose `code` is 'LIMIT'; the tracker then calls `onLimit` and shows a short message.
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
  /** Autocomplete list. Replaces the built-in SRD list; concat `srdCreatures` to extend it. */
  creatures?: CreatureTemplate[];
  /** Random source returning [0, 1). Defaults to Math.random. */
  rng?: () => number;
  /** Called after every change the user makes (not after `setState`). */
  onChange?: (state: TrackerState) => void;
  /** Called when `storage.save` rejects with `code === 'LIMIT'`. */
  onLimit?: (reason: string) => void;
  /** State to start with, instead of restoring the last session. */
  initialState?: TrackerState;
  /** Milliseconds to wait after the last change before autosaving. Default 400. */
  autosaveDelay?: number;
}

export interface Tracker {
  getState(): TrackerState;
  /** Replaces the whole state (migrated first) and re-renders. Does not call `onChange`. */
  setState(state: TrackerState): void;
  destroy(): void;
  /** Resolves once the last session has been restored (or there was nothing to restore). */
  ready: Promise<void>;
}
