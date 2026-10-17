import { migrate } from './logic';
import { EncounterStorage, EncounterSummary, TrackerState } from './types';

/** Reserved id for the autosaved working state. Hosts' `list()` may include it; the UI hides it. */
export const LAST_SESSION_ID = '_last_session';

export interface LocalStorageOptions {
  /** Prefix for every key. Default 'it-tracker'. */
  prefix?: string;
  /** Any object shaped like the Web Storage API. Default window.localStorage. */
  storage?: StorageLike;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** True when window.localStorage can be read and written (it throws when blocked). */
export function localStorageAvailable(): boolean {
  try {
    const s = window.localStorage;
    s.setItem('__it_probe', '1');
    s.removeItem('__it_probe');
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps encounters in the browser. Layout: `<prefix>:index` is a JSON list of {id, name} and
 * `<prefix>:enc:<id>` holds each encounter. Damaged JSON is treated as "nothing there", and a
 * full disk makes `save` reject (the caller shows a message) instead of throwing.
 */
export class LocalStorageEncounterStorage implements EncounterStorage {
  private prefix: string;
  private store: StorageLike;

  constructor(options: LocalStorageOptions = {}) {
    this.prefix = options.prefix || 'it-tracker';
    this.store = options.storage || window.localStorage;
  }

  private indexKey() {
    return this.prefix + ':index';
  }
  private key(id: string) {
    return this.prefix + ':enc:' + id;
  }

  private readIndex(): EncounterSummary[] {
    try {
      const raw = this.store.getItem(this.indexKey());
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e) => e && typeof e.id === 'string')
        .map((e) => ({ id: e.id, name: String(e.name || '') }));
    } catch {
      return [];
    }
  }

  async list(): Promise<EncounterSummary[]> {
    return this.readIndex().filter((e) => e.id !== LAST_SESSION_ID);
  }

  async load(id: string): Promise<TrackerState | null> {
    try {
      const raw = this.store.getItem(this.key(id));
      if (!raw) return null;
      return migrate(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(id: string | null, state: TrackerState): Promise<string> {
    const useId = id || 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const index = this.readIndex().filter((e) => e.id !== useId);
    index.push({ id: useId, name: state.name });
    try {
      this.store.setItem(this.key(useId), JSON.stringify(state));
      this.store.setItem(this.indexKey(), JSON.stringify(index));
    } catch (err) {
      const e: Error & { code?: string } = new Error(
        'Could not save: browser storage is full or blocked',
      );
      e.code = 'QUOTA';
      e.cause = err;
      throw e;
    }
    return useId;
  }

  async remove(id: string): Promise<void> {
    try {
      this.store.removeItem(this.key(id));
      this.store.setItem(
        this.indexKey(),
        JSON.stringify(this.readIndex().filter((e) => e.id !== id)),
      );
    } catch {
      // Nothing useful to do; the entry stays until storage works again.
    }
  }
}
