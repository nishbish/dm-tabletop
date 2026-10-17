import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createEmptyState } from '../state';
import { RoomStorage } from '../types';
import { FileStorage } from './file';
import { MemoryStorage } from './memory';
import { PostgresStorage } from './postgres';
import { SqliteStorage } from './sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletop-storage-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function roundTrip(name: string, make: () => RoomStorage) {
  describe(name, () => {
    it('returns null for unknown rooms, and round-trips and overwrites', async () => {
      const storage = make();
      expect(await storage.loadRoom('missing')).toBeNull();
      const state = createEmptyState('Dungeon');
      state.tokens['1'] = {
        modelId: 'orc',
        position: { x: 1, y: 2, z: 3 },
        scale: { x: 1, y: 1, z: 1 },
        owners: ['u1'],
        settings: { hideAvatar: false, disableCamLook: true },
      };
      await storage.saveRoom('room-1', state);
      expect(await storage.loadRoom('room-1')).toEqual(state);
      state.name = 'Renamed';
      await storage.saveRoom('room-1', state);
      expect((await storage.loadRoom('room-1')).name).toBe('Renamed');
      expect(await storage.loadRoom('room-2')).toBeNull();
    });
  });
}

roundTrip('MemoryStorage', () => new MemoryStorage());
roundTrip('FileStorage', () => new FileStorage(path.join(tmp, 'files')));
roundTrip('SqliteStorage', () => new SqliteStorage(path.join(tmp, 'db', 'rooms.sqlite')));

describe('FileStorage safety', () => {
  it('rejects room ids that could escape the directory', async () => {
    const dir = path.join(tmp, 'safe');
    const storage = new FileStorage(dir);
    for (const bad of ['../x', '..', 'a/b', '/etc/passwd', 'a\\b', '', 'x.json']) {
      await expect(storage.saveRoom(bad, createEmptyState())).rejects.toThrow('invalid room id');
      await expect(storage.loadRoom(bad)).rejects.toThrow('invalid room id');
    }
    expect(fs.existsSync(path.join(tmp, 'x.json'))).toBe(false);
  });

  it('leaves no temp files behind', async () => {
    const dir = path.join(tmp, 'clean');
    await new FileStorage(dir).saveRoom('r', createEmptyState());
    expect(fs.readdirSync(dir)).toEqual(['r.json']);
  });
});

const postgresUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!postgresUrl)('PostgresStorage', () => {
  it('round-trips', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: postgresUrl });
    try {
      const storage = new PostgresStorage(pool);
      const id = 'test-' + Date.now();
      expect(await storage.loadRoom(id)).toBeNull();
      const state = createEmptyState('pg');
      await storage.saveRoom(id, state);
      expect(await storage.loadRoom(id)).toEqual(state);
      state.name = 'pg2';
      await storage.saveRoom(id, state);
      expect((await storage.loadRoom(id)).name).toBe('pg2');
      await pool.query('DELETE FROM rooms WHERE id = $1', [id]);
    } finally {
      await pool.end();
    }
  });
});
