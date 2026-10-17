import type { Pool } from 'pg';
import { RoomState, RoomStorage } from '../types';
import { assertValidRoomId } from './roomId';

// Same table as the SQLite storage, but with a real jsonb column. You own the Pool (and its
// connection settings); we only use it.
export class PostgresStorage implements RoomStorage {
  private ready: Promise<void> | null = null;

  constructor(private pool: Pool) {}

  // Creates the table if needed. Called lazily; safe to call yourself at startup to fail early.
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS rooms (
             id TEXT PRIMARY KEY, version INTEGER, state JSONB, updated_at TIMESTAMPTZ)`,
        )
        .then(() => undefined);
      // If creating failed, allow a later retry instead of caching the failure forever.
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  }

  async loadRoom(id: string): Promise<RoomState | null> {
    assertValidRoomId(id);
    await this.init();
    const result = await this.pool.query('SELECT state FROM rooms WHERE id = $1', [id]);
    return result.rows.length ? result.rows[0].state : null;
  }

  async saveRoom(id: string, state: RoomState): Promise<void> {
    assertValidRoomId(id);
    await this.init();
    await this.pool.query(
      `INSERT INTO rooms (id, version, state, updated_at) VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, state = EXCLUDED.state,
       updated_at = now()`,
      [id, state.version, JSON.stringify(state)],
    );
  }
}
