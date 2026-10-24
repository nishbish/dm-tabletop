// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageEncounterStorage, StorageLike } from './storage';
import { createTracker } from './tracker';
import { EncounterStorage, Tracker, TrackerState } from './types';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k) : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let container: HTMLElement;
let tracker: Tracker;
let memory: MemoryStorage;
let storage: LocalStorageEncounterStorage;

function make(options: Parameters<typeof createTracker>[1] = {}) {
  tracker = createTracker(container, { storage, autosaveDelay: 10, ...options });
  return tracker;
}
const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const action = (name: string) => $(`button[data-action="${name}"]`) as HTMLButtonElement;
const click = (node: Element) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
function type(input: HTMLInputElement, value: string, event = 'input') {
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}
const rows = () => $$('.it-row');
const field = (row: Element, name: string) =>
  row.querySelector(`[data-field="${name}"]`) as HTMLInputElement;
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  memory = new MemoryStorage();
  storage = new LocalStorageEncounterStorage({ storage: memory });
});
afterEach(() => {
  if (tracker) tracker.destroy();
  container.remove();
});

describe('rendering and actions', () => {
  it('renders an empty tracker with its controls', async () => {
    await make().ready;
    expect($('.it-root')).toBeTruthy();
    expect($('.it-round-num').textContent).toBe('1');
    expect(rows()).toHaveLength(0);
    for (const a of ['add', 'roll-all', 'sort', 'next', 'clear', 'reset-round']) {
      expect(action(a).getAttribute('aria-label')).toBeTruthy();
    }
    expect(tracker.getState()).toMatchObject({ version: 1, round: 1, turn: 0, rows: [] });
  });

  it('adds creatures, rolls all, sorts, and goes to the next turn', async () => {
    const values = [0.5, 0.95, 0.1]; // d20 results 11, 20, 3
    let i = 0;
    await make({ rng: () => values[i++ % values.length] }).ready;
    click(action('add'));
    click(action('add'));
    click(action('add'));
    expect(rows()).toHaveLength(3);
    ['Ann', 'Bob', 'Cy'].forEach((n, k) => type(field(rows()[k], 'name'), n));

    click(action('roll-all'));
    expect(tracker.getState().rows.map((r) => r.initiative)).toEqual([11, 20, 3]);

    click(action('sort'));
    expect(tracker.getState().rows.map((r) => r.name)).toEqual(['Bob', 'Ann', 'Cy']);
    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].textContent).toContain('Turn');

    click(action('next'));
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
    expect($('.it-turn').textContent).toBe('Round 1, turn: Ann');

    click(action('next'));
    click(action('next'));
    expect($('.it-round-num').textContent).toBe('2');
    expect(tracker.getState()).toMatchObject({ round: 2, turn: 0 });

    click(action('reset-round'));
    expect($('.it-round-num').textContent).toBe('1');
  });

  it('rolls a single row using its bonus', async () => {
    await make({ rng: () => 0.5 }).ready;
    click(action('add'));
    type(field(rows()[0], 'bonus'), '3');
    click(rows()[0].querySelector('[data-action="roll"]'));
    expect(tracker.getState().rows[0].initiative).toBe(14);
    expect(field(rows()[0], 'initiative').value).toBe('14');
  });

  it('clear needs a second press', async () => {
    await make().ready;
    click(action('add'));
    click(action('clear'));
    expect(rows()).toHaveLength(1);
    expect(action('clear').textContent).toContain('?');
    click(action('clear'));
    expect(rows()).toHaveLength(0);
    expect(action('clear').textContent).toBe('Clear');
  });

  it('removes rows, and reorders them from the keyboard on the handle', async () => {
    await make().ready;
    ['A', 'B', 'C'].forEach((n) => {
      click(action('add'));
      type(field(rows()[rows().length - 1], 'name'), n);
    });
    const grip = (i: number) => rows()[i].querySelector('[data-grip]') as HTMLElement;
    grip(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(tracker.getState().rows.map((r) => r.name)).toEqual(['A', 'C', 'B']);
    // at the top, up does nothing
    grip(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(tracker.getState().rows.map((r) => r.name)).toEqual(['A', 'C', 'B']);
    click(rows()[0].querySelector('[data-action="remove"]'));
    expect(tracker.getState().rows.map((r) => r.name)).toEqual(['C', 'B']);
  });

  it('has no actions column: the roll button lives in the initiative cell', async () => {
    await make().ready;
    click(action('add'));
    const row = rows()[0];
    expect(row.querySelector('.it-actions')).toBeNull();
    expect(row.querySelector('.it-c-init [data-action="roll"]')).toBeTruthy();
    expect(row.querySelector('[data-action="up"]')).toBeNull();
    expect(row.querySelectorAll('[role="cell"]')).toHaveLength(6);
  });

  it('drags a row: it follows the pointer, the others shift, and the order changes on release', async () => {
    await make().ready;
    ['A', 'B', 'C'].forEach((n) => {
      click(action('add'));
      type(field(rows()[rows().length - 1], 'name'), n);
    });
    // happy-dom has no layout: give the rows a fixed 50px pitch
    rows().forEach((r, i) => {
      r.getBoundingClientRect = () =>
        ({
          top: i * 50,
          height: 48,
          bottom: i * 50 + 48,
          left: 0,
          right: 100,
          width: 100,
        }) as DOMRect;
    });
    const grip = rows()[0].querySelector('[data-grip]') as HTMLElement;
    const fire = (type: string, y: number) =>
      grip.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), { clientY: y, pointerId: 1, button: 0 }),
      );
    fire('pointerdown', 10);
    expect(rows()[0].classList.contains('it-row--dragging')).toBe(true);
    fire('pointermove', 70); // 60px down: past B (one place)... and onto C's slot (50px pitch)
    expect(rows()[0].style.transform).toBe('translateY(60px)');
    expect(rows()[1].style.transform).toBe('translateY(-50px)');
    expect(rows()[2].style.transform).toBe('');
    fire('pointerup', 70);
    await new Promise((r) => setTimeout(r, 200));
    expect(tracker.getState().rows.map((r) => r.name)).toEqual(['B', 'A', 'C']);
    expect(rows().every((r) => !r.classList.contains('it-row--dragging'))).toBe(true);
  });

  it('renames the encounter', async () => {
    const onChange = vi.fn();
    await make({ onChange }).ready;
    type($('input[data-field="encname"]') as HTMLInputElement, 'Bridge fight');
    expect(tracker.getState().name).toBe('Bridge fight');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Bridge fight' }));
  });

  it('applies relative HP edits typed into the HP field', async () => {
    await make().ready;
    click(action('add'));
    type(field(rows()[0], 'hp'), '20', 'change');
    expect(tracker.getState().rows[0]).toMatchObject({ hp: 20, maxHp: 20 });
    type(field(rows()[0], 'hp'), '-5', 'change');
    expect(tracker.getState().rows[0].hp).toBe(15);
    expect(field(rows()[0], 'hp').value).toBe('15');
    type(field(rows()[0], 'hp'), '+3', 'change');
    expect(tracker.getState().rows[0].hp).toBe(18);
    type(field(rows()[0], 'hp'), '-100', 'change');
    expect(tracker.getState().rows[0].hp).toBe(0);
    expect(rows()[0].querySelector('.it-down').hasAttribute('hidden')).toBe(false);
  });
});

describe('autocomplete', () => {
  it('suggests, fills stats from the SRD entry, and accepts free text', async () => {
    await make().ready;
    click(action('add'));
    const name = field(rows()[0], 'name');
    type(name, 'gobl');
    const options = $$('.it-suggest [role="option"]');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].textContent).toContain('Goblin');
    expect(name.getAttribute('aria-expanded')).toBe('true');
    click(options[0]);
    expect(tracker.getState().rows[0]).toMatchObject({
      name: 'Goblin',
      ac: 15,
      hp: 7,
      maxHp: 7,
      initiativeBonus: 2,
      monsterId: 'goblin',
    });
    expect(field(rows()[0], 'ac').value).toBe('15');
    expect($('.it-suggest')).toBeNull();

    click(action('add'));
    type(field(rows()[1], 'name'), 'My homebrew thing');
    expect(tracker.getState().rows[1].name).toBe('My homebrew thing');
    expect(tracker.getState().rows[1].monsterId).toBeUndefined();
  });

  it('works from the keyboard', async () => {
    await make().ready;
    click(action('add'));
    const name = field(rows()[0], 'name');
    type(name, 'owlb');
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(name.getAttribute('aria-activedescendant')).toBeTruthy();
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(tracker.getState().rows[0].name).toBe('Owlbear');
  });

  it('uses a creature list supplied by the host', async () => {
    await make({ creatures: [{ id: 'x', name: 'Xyzzy', ac: 4, hp: 9, dex: 18 }] }).ready;
    click(action('add'));
    type(field(rows()[0], 'name'), 'gob');
    expect($('.it-suggest')).toBeNull();
    type(field(rows()[0], 'name'), 'xyz');
    click($('.it-suggest [role="option"]'));
    expect(tracker.getState().rows[0]).toMatchObject({ ac: 4, hp: 9, initiativeBonus: 4 });
  });
});

describe('storage', () => {
  it('saves, starts a new encounter, and loads the first one back', async () => {
    await make().ready;
    click(action('add'));
    type(field(rows()[0], 'name'), 'Dragon');
    type($('input[data-field="encname"]') as HTMLInputElement, 'Lair');
    click(action('save'));
    await wait();
    expect($$('select[data-field="saved"] option').map((o) => o.textContent)).toContain('Lair');

    click(action('new'));
    expect(rows()).toHaveLength(0);
    expect(tracker.getState().name).toBe('New encounter');

    const select = $('select[data-field="saved"]') as unknown as HTMLSelectElement;
    select.value = (await storage.list())[0].id;
    click(action('open'));
    await wait();
    expect(rows()).toHaveLength(1);
    expect(tracker.getState()).toMatchObject({ name: 'Lair' });
    expect(tracker.getState().rows[0].name).toBe('Dragon');
  });

  it('deletes a saved encounter after confirmation', async () => {
    await make().ready;
    click(action('save'));
    await wait();
    expect(await storage.list()).toHaveLength(1);
    click(action('delete'));
    expect(await storage.list()).toHaveLength(1);
    click(action('delete'));
    await wait();
    expect(await storage.list()).toHaveLength(0);
  });

  it('hides the encounter controls when there is no storage', async () => {
    await make({ storage: null }).ready;
    expect(action('save')).toBeNull();
    expect($('.it-storage')).toBeNull();
  });

  it('autosaves the working state and restores it in a new tracker', async () => {
    await make().ready;
    click(action('add'));
    type(field(rows()[0], 'name'), 'Wraith');
    click(action('next'));
    await wait(60);
    tracker.destroy();

    const again = createTracker(container, { storage });
    await again.ready;
    tracker = again;
    expect(rows()).toHaveLength(1);
    expect(field(rows()[0], 'name').value).toBe('Wraith');
    expect(tracker.getState().round).toBe(2);
    // the autosave slot is not offered as a named encounter
    expect($$('select[data-field="saved"] option').map((o) => o.textContent)).not.toContain(
      'New encounter',
    );
  });

  it('calls onLimit and shows a message when the host refuses a save', async () => {
    const limited: EncounterStorage = {
      list: async () => [],
      load: async () => null,
      remove: async () => undefined,
      save: async () => {
        throw Object.assign(new Error('Free accounts keep 3 encounters'), { code: 'LIMIT' });
      },
    };
    const onLimit = vi.fn();
    await make({ storage: limited, onLimit }).ready;
    click(action('save'));
    await wait();
    expect(onLimit).toHaveBeenCalledWith('Free accounts keep 3 encounters');
    expect($('.it-message').textContent).toBe('Free accounts keep 3 encounters');
    expect(container.querySelector('.it-root')).toBeTruthy(); // still usable
  });
});

describe('state and destroy', () => {
  it('getState returns a copy; setState replaces and migrates', async () => {
    await make({ storage: null }).ready;
    const s = tracker.getState();
    s.name = 'tampered';
    expect(tracker.getState().name).not.toBe('tampered');
    const incoming: TrackerState = {
      version: 1,
      name: 'Set',
      round: 4,
      turn: 1,
      rows: [
        { id: 'a', name: 'A', initiative: 9, initiativeBonus: 0, hp: 5, maxHp: 5, ac: 12 },
        { id: 'b', name: 'B', initiative: 3, initiativeBonus: 0, hp: 5, maxHp: 5, ac: 12 },
      ],
    };
    tracker.setState(incoming);
    expect(rows()).toHaveLength(2);
    expect($('.it-round-num').textContent).toBe('4');
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
    expect(tracker.getState()).toEqual(incoming);
  });

  it('destroy removes nodes, listeners and the stylesheet', async () => {
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
    await make({ storage: null }).ready;
    expect(document.getElementById('it-styles')).toBeTruthy();
    tracker.destroy();
    expect(container.children).toHaveLength(0);
    expect(document.getElementById('it-styles')).toBeNull();
    const added = add.mock.calls.map((c) => c[0]).sort();
    const removed = remove.mock.calls.map((c) => c[0]).sort();
    expect(added.length).toBeGreaterThan(5);
    expect(removed).toEqual(added);
    expect(winRemove.mock.calls.map((c) => c[0])).toEqual(winAdd.mock.calls.map((c) => c[0]));
    expect(winAdd.mock.calls.length).toBeGreaterThan(0);
    winAdd.mockRestore();
    winRemove.mockRestore();
    add.mockRestore();
    remove.mockRestore();
    tracker.destroy(); // a second call is harmless
  });

  it('two trackers share one stylesheet', async () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const a = createTracker(container, { storage: null });
    const b = createTracker(other, { storage: null });
    expect(document.querySelectorAll('#it-styles')).toHaveLength(1);
    a.destroy();
    expect(document.getElementById('it-styles')).toBeTruthy();
    b.destroy();
    expect(document.getElementById('it-styles')).toBeNull();
    other.remove();
    tracker = createTracker(container, { storage: null });
  });
});
