import { describe, expect, it } from 'vitest';
import { addRow, createState } from './logic';
import { LAST_SESSION_ID, LocalStorageEncounterStorage, StorageLike } from './storage';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k) : null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function sample(name: string) {
  return addRow({ ...createState(), name }, { name: 'Goblin', hp: 7, maxHp: 7 }, 'g1');
}

describe('LocalStorageEncounterStorage', () => {
  it('round-trips an encounter and lists it', async () => {
    const store = new LocalStorageEncounterStorage({ storage: new MemoryStorage() });
    const id = await store.save(null, sample('Ambush'));
    expect(await store.list()).toEqual([{ id, name: 'Ambush' }]);
    expect(await store.load(id)).toEqual(sample('Ambush'));
  });

  it('saving with an id overwrites and renames', async () => {
    const store = new LocalStorageEncounterStorage({ storage: new MemoryStorage() });
    const id = await store.save(null, sample('One'));
    expect(await store.save(id, sample('Two'))).toBe(id);
    expect(await store.list()).toEqual([{ id, name: 'Two' }]);
  });

  it('removes encounters', async () => {
    const store = new LocalStorageEncounterStorage({ storage: new MemoryStorage() });
    const a = await store.save(null, sample('A'));
    const b = await store.save(null, sample('B'));
    await store.remove(a);
    expect((await store.list()).map((e) => e.id)).toEqual([b]);
    expect(await store.load(a)).toBeNull();
  });

  it('hides the last-session slot from list() but can load it', async () => {
    const store = new LocalStorageEncounterStorage({ storage: new MemoryStorage() });
    await store.save(LAST_SESSION_ID, sample('Working'));
    expect(await store.list()).toEqual([]);
    expect((await store.load(LAST_SESSION_ID)).name).toBe('Working');
  });

  it('treats corrupt JSON as empty', async () => {
    const mem = new MemoryStorage();
    const store = new LocalStorageEncounterStorage({ storage: mem, prefix: 'x' });
    mem.setItem('x:index', '{not json');
    mem.setItem('x:enc:a', '[[[');
    expect(await store.list()).toEqual([]);
    expect(await store.load('a')).toBeNull();
    // and it recovers by saving over the damage
    const id = await store.save(null, sample('Fresh'));
    expect(await store.list()).toEqual([{ id, name: 'Fresh' }]);
  });

  it('migrates old shapes when loading', async () => {
    const mem = new MemoryStorage();
    const store = new LocalStorageEncounterStorage({ storage: mem });
    mem.setItem('it-tracker:enc:old', JSON.stringify({ name: 'Old', rows: [{ name: 'X' }] }));
    const loaded = await store.load('old');
    expect(loaded.version).toBe(1);
    expect(loaded.rows[0].name).toBe('X');
  });

  it('rejects (does not throw) when the browser storage is full', async () => {
    const mem = new MemoryStorage();
    const store = new LocalStorageEncounterStorage({ storage: mem });
    mem.failWrites = true;
    await expect(store.save(null, sample('Big'))).rejects.toMatchObject({ code: 'QUOTA' });
  });

  it('uses the configured key prefix', async () => {
    const mem = new MemoryStorage();
    const store = new LocalStorageEncounterStorage({ storage: mem, prefix: 'mygame' });
    await store.save(null, sample('P'));
    expect([...mem.data.keys()].every((k) => k.startsWith('mygame:'))).toBe(true);
  });
});
