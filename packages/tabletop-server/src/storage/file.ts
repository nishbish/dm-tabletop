import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RoomState, RoomStorage } from '../types';
import { assertValidRoomId } from './roomId';

// One JSON file per room in a directory. Simple to back up and inspect by hand.
export class FileStorage implements RoomStorage {
  constructor(private dir: string) {}

  private fileFor(id: string): string {
    return path.join(this.dir, assertValidRoomId(id) + '.json');
  }

  async loadRoom(id: string): Promise<RoomState | null> {
    const file = this.fileFor(id);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async saveRoom(id: string, state: RoomState): Promise<void> {
    const file = this.fileFor(id);
    await fs.mkdir(this.dir, { recursive: true });
    // Write to a temp file then rename: rename is atomic, so a crash mid-write can never leave a
    // half-written room file behind.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state));
    await fs.rename(tmp, file);
  }
}
