import { RoomState } from './types';

export const CURRENT_STATE_VERSION = 1;

export function createEmptyState(name = 'Untitled room'): RoomState {
  return {
    version: CURRENT_STATE_VERSION,
    name,
    grid: { width: 20, height: 20 },
    daylight: 100,
    moonlight: 0,
    nextId: 1,
    tokens: {},
    planes: {},
    doors: {},
    wallPoints: {},
  };
}

// Upgrades a saved state to the current version. Only version 1 exists today; when version 2 is
// introduced, add a `if (state.version === 1) { ...; state.version = 2; }` step here so old
// saved rooms keep loading. Throws for states we cannot understand (e.g. from a newer server).
export function migrate(saved: unknown): RoomState {
  if (!saved || typeof saved !== 'object') {
    throw new Error('saved room state is not an object');
  }
  const state = saved as RoomState;
  if (typeof state.version !== 'number') {
    throw new Error('saved room state has no version');
  }
  if (state.version > CURRENT_STATE_VERSION) {
    throw new Error(`saved room state version ${state.version} is newer than this server`);
  }
  // (future migrations go here, oldest first)
  return state;
}
