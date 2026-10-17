import * as fs from 'node:fs';
import * as path from 'node:path';
import { RoomState, RoomStorage } from '../types';
import { assertValidRoomId } from './roomId';

// Just the parts of node:sqlite we use (its types need a newer @types/node than Node 20 has).
interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): { state: string } | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
}
interface BuiltinLoader {
  getBuiltinModule?(name: string): { DatabaseSync: new (file: string) => DatabaseLike } | undefined;
}

// Uses Node's built-in `node:sqlite` (Node 22.5+), so there is no native module to compile.
// We fetch it with process.getBuiltinModule so older Node versions only fail if SQLite is
// actually used, and bundlers/test runners don't try to resolve it.
export class SqliteStorage implements RoomStorage {
  private db: DatabaseLike;

  // `file` is a path, or ':memory:'.
  constructor(file: string) {
    const sqlite = (process as unknown as BuiltinLoader).getBuiltinModule?.('node:sqlite');
    if (!sqlite) {
      throw new Error('SQLite storage needs Node.js 22.5 or newer (node:sqlite)');
    }
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, version INTEGER, state TEXT, updated_at TEXT)',
    );
  }

  async loadRoom(id: string): Promise<RoomState | null> {
    assertValidRoomId(id);
    const row = this.db.prepare('SELECT state FROM rooms WHERE id = ?').get(id);
    return row ? JSON.parse(row.state) : null;
  }

  async saveRoom(id: string, state: RoomState): Promise<void> {
    assertValidRoomId(id);
    this.db
      .prepare(
        `INSERT INTO rooms (id, version, state, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, state = excluded.state,
         updated_at = excluded.updated_at`,
      )
      .run(id, state.version, JSON.stringify(state), new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
