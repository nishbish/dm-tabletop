import { RoomState, RoomStorage } from '../types';

// Keeps rooms in a Map. For tests and throwaway servers; nothing survives a restart.
// Stores copies so later changes to the live state don't silently alter the "saved" one.
export class MemoryStorage implements RoomStorage {
  private rooms = new Map<string, string>();

  async loadRoom(id: string): Promise<RoomState | null> {
    const text = this.rooms.get(id);
    return text === undefined ? null : JSON.parse(text);
  }

  async saveRoom(id: string, state: RoomState): Promise<void> {
    this.rooms.set(id, JSON.stringify(state));
  }
}
