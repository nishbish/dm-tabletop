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
const names = () => tracker.getState().rows.map((r) => r.name);
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
  it('starts with five empty rows, the name and its two buttons, and nothing else', async () => {
    await make().ready;
    expect($('.it-root')).toBeTruthy();
    expect($('.it-round-num').textContent).toBe('1');
    expect(rows()).toHaveLength(5);
    expect(tracker.getState()).toMatchObject({ version: 1, round: 1, turn: 0 });
    // empty rows show empty fields, not zeros
    const fields = $$('.it-row input:not(.it-hp-amount)') as HTMLInputElement[];
    expect(fields.every((i) => i.value === '')).toBe(true);
    for (const a of ['add', 'roll-all', 'sort', 'next', 'clear', 'reset-round', 'saved', 'new']) {
      expect(action(a).getAttribute('aria-label')).toBeTruthy();
    }
    expect($('input[data-field="encname"]').getAttribute('aria-label')).toBe('Encounter name');
    expect($('.it-root').textContent).not.toContain('Encounter name');
    expect($('.it-root').textContent).not.toContain('Saved encounters');
    expect($('select')).toBeNull();
    // whose turn it is and other messages are for screen readers only
    expect($('.it-turn').classList.contains('it-sr')).toBe(true);
    expect($('.it-message').classList.contains('it-sr')).toBe(true);
  });

  it('adds creatures, rolls all, sorts, and goes to the next turn', async () => {
    const values = [0.5, 0.95, 0.1]; // d20 results 11, 20, 3
    let i = 0;
    await make({ rng: () => values[i++ % values.length] }).ready;
    ['Ann', 'Bob', 'Cy'].forEach((n, k) => type(field(rows()[k], 'name'), n));
    click(action('add'));
    expect(rows()).toHaveLength(6);

    click(action('roll-all')); // the empty rows stay empty
    expect(tracker.getState().rows.map((r) => r.initiative)).toEqual([11, 20, 3, 0, 0, 0]);

    click(action('sort'));
    expect(names()).toEqual(['Bob', 'Ann', 'Cy', '', '', '']);
    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].textContent).toContain('Turn');

    click(action('next'));
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
    expect($('.it-turn').textContent).toBe('Round 1, turn: Ann');

    click(action('next'));
    click(action('next')); // past the empty rows, back to Bob
    expect($('.it-round-num').textContent).toBe('2');
    expect(tracker.getState()).toMatchObject({ round: 2, turn: 0 });

    click(action('reset-round'));
    expect($('.it-round-num').textContent).toBe('1');
  });

  it("rolls a single row using a picked creature's bonus, shown in brackets", async () => {
    await make({ rng: () => 0.5 }).ready;
    expect(field(rows()[0], 'bonus')).toBeNull(); // the bonus is not typed in
    expect(rows()[0].querySelector('.it-mod').textContent).toBe('');
    type(field(rows()[0], 'name'), 'gobl');
    click($('.it-suggest [role="option"]'));
    expect(rows()[0].querySelector('.it-mod').textContent).toBe('(+2)');
    click(rows()[0].querySelector('[data-action="roll"]'));
    expect(tracker.getState().rows[0].initiative).toBe(13);
    expect(field(rows()[0], 'initiative').value).toBe('13');
  });

  it('clear needs a second press and leaves five empty rows', async () => {
    await make().ready;
    click(action('add'));
    type(field(rows()[0], 'name'), 'Ann');
    click(action('clear'));
    expect(rows()).toHaveLength(6);
    expect(action('clear').textContent).toContain('?');
    click(action('clear'));
    expect(rows()).toHaveLength(5);
    expect(names()).toEqual(['', '', '', '', '']);
    expect(action('clear').textContent).toBe('Clear');
  });

  it('changes initiative with the - / + buttons by the amount', async () => {
    await make().ready;
    const row = rows()[0];
    type(field(row, 'initiative'), '12');
    field(row, 'initiative').focus();
    expect(row.querySelector('.it-c-init').classList.contains('it-c-init--open')).toBe(true);
    click(row.querySelector('[data-action="init-down"]'));
    expect(tracker.getState().rows[0].initiative).toBe(11);
    type(field(row, 'initstep'), '4');
    click(row.querySelector('[data-action="init-up"]'));
    expect(tracker.getState().rows[0].initiative).toBe(15);
    expect(field(rows()[0], 'initiative').value).toBe('15');
    // Escape closes the box and goes back to the initiative field
    const up = row.querySelector('[data-action="init-up"]') as HTMLElement;
    up.focus();
    up.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(row.querySelector('.it-c-init').classList.contains('it-c-init--open')).toBe(false);
    expect(document.activeElement).toBe(field(row, 'initiative'));
  });

  it('rolls hit points from the hit dice of a creature picked from the list', async () => {
    await make({ rng: () => 0.999 }).ready;
    const row = rows()[0];
    const roll = row.querySelector('[data-action="roll-hp"]') as HTMLButtonElement;
    expect(roll.hidden).toBe(true); // nothing to roll for a row without a creature
    type(field(row, 'name'), 'gobl');
    click($('.it-suggest [role="option"]'));
    expect(roll.hidden).toBe(false);
    expect(roll.textContent).toBe('d6');
    click(roll); // goblin: 2d6, the highest roll
    expect(tracker.getState().rows[0]).toMatchObject({ hp: 12, maxHp: 12 });
    expect(field(rows()[0], 'hp').value).toBe('12');
  });

  it('shows the d20 button while the initiative cell is in use', async () => {
    await make().ready;
    const cell = rows()[1].querySelector('.it-c-init');
    expect(cell.classList.contains('it-c-init--open')).toBe(false);
    field(rows()[1], 'initiative').focus();
    expect(cell.classList.contains('it-c-init--open')).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cell.classList.contains('it-c-init--open')).toBe(false);
  });

  it('removes rows, and reorders them from the keyboard on the handle', async () => {
    await make().ready;
    ['A', 'B', 'C'].forEach((n, k) => type(field(rows()[k], 'name'), n));
    const grip = (i: number) => rows()[i].querySelector('[data-grip]') as HTMLElement;
    grip(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(names()).toEqual(['A', 'C', 'B', '', '']);
    // at the top, up does nothing
    grip(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(names()).toEqual(['A', 'C', 'B', '', '']);
    click(rows()[0].querySelector('[data-action="remove"]'));
    expect(names()).toEqual(['C', 'B', '', '']);
  });

  it('has no actions column: the roll button lives in the initiative cell', async () => {
    await make().ready;
    click(action('add'));
    const row = rows()[0];
    expect(row.querySelector('.it-actions')).toBeNull();
    expect(row.querySelector('.it-c-init [data-action="roll"]')).toBeTruthy();
    expect(row.querySelector('[data-action="up"]')).toBeNull();
    // the drag handle is in the initiative cell, not a column of its own
    expect(row.querySelectorAll('[role="cell"]')).toHaveLength(5);
    expect(row.querySelector('.it-c-init [data-grip]')).toBeTruthy();
  });

  it('drags a row: it follows the pointer, the others shift, and the order changes on release', async () => {
    await make().ready;
    ['A', 'B', 'C'].forEach((n, k) => type(field(rows()[k], 'name'), n));
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
    expect(names()).toEqual(['B', 'A', 'C', '', '']);
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

  it('changes HP with the - / + buttons by the amount, within 0 and max', async () => {
    await make().ready;
    click(action('add'));
    type(field(rows()[0], 'hp'), '20', 'change');
    const row = rows()[0];
    const cell = row.querySelector('.it-c-hp');
    const down = row.querySelector('[data-action="hp-down"]') as HTMLButtonElement;
    const up = row.querySelector('[data-action="hp-up"]') as HTMLButtonElement;
    expect(down.getAttribute('aria-label')).toMatch(/^Subtract the amount from hit points/);
    expect(field(row, 'hpstep').value).toBe('1');

    // focus on the HP field opens the box; focus elsewhere closes it
    field(row, 'hp').focus();
    expect(cell.classList.contains('it-c-hp--open')).toBe(true);

    click(down);
    expect(tracker.getState().rows[0].hp).toBe(19);
    expect(field(rows()[0], 'hp').value).toBe('19');
    type(field(row, 'hpstep'), '7');
    click(down);
    expect(tracker.getState().rows[0].hp).toBe(12);
    click(up);
    click(up);
    expect(tracker.getState().rows[0].hp).toBe(26); // above max is allowed
    expect(tracker.getState().rows[0].maxHp).toBe(20);
    type(field(row, 'hpstep'), '50');
    click(down);
    expect(tracker.getState().rows[0].hp).toBe(0);
    expect(row.querySelector('.it-down').hasAttribute('hidden')).toBe(false);
    expect($('.it-message').textContent).toBe('creature 1: 0 HP'); // for screen readers

    field(row, 'ac').focus();
    expect(cell.classList.contains('it-c-hp--open')).toBe(false);
  });

  it('closes the HP box on Escape and on a press outside it', async () => {
    await make().ready;
    click(action('add'));
    const row = rows()[0];
    const cell = row.querySelector('.it-c-hp');
    const up = row.querySelector('[data-action="hp-up"]') as HTMLButtonElement;
    field(row, 'hp').focus();
    up.focus();
    expect(cell.classList.contains('it-c-hp--open')).toBe(true);
    up.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cell.classList.contains('it-c-hp--open')).toBe(false);
    expect(document.activeElement).toBe(field(row, 'hp'));

    click(field(row, 'hp'));
    expect(cell.classList.contains('it-c-hp--open')).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cell.classList.contains('it-c-hp--open')).toBe(false);
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

  it('suggests Pathfinder creatures too, tagged, with Perception as the bonus', async () => {
    await make().ready;
    type(field(rows()[0], 'name'), 'goblin warr');
    const option = $$('.it-suggest [role="option"]').find((o) =>
      o.textContent.includes('Goblin Warrior'),
    );
    expect(option.textContent).toContain('PF2e');
    click(option);
    expect(tracker.getState().rows[0]).toMatchObject({
      name: 'Goblin Warrior',
      ac: 16,
      hp: 6,
      initiativeBonus: 2,
      monsterId: 'pf2e-goblin-warrior',
    });
    // fixed hit points: no hit dice to roll
    const roll = rows()[0].querySelector('[data-action="roll-hp"]') as HTMLButtonElement;
    expect(roll.hidden).toBe(true);
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
  const openList = () => click(action('saved'));
  const listed = () => $$('.it-saved-open').map((b) => b.textContent);

  it('autosaves an encounter once something is filled in, without a Save button', async () => {
    await make().ready;
    expect(action('save')).toBeNull();
    type($('input[data-field="encname"]') as HTMLInputElement, 'Lair');
    await wait();
    expect(await storage.list()).toHaveLength(0); // nothing filled in yet
    type(field(rows()[0], 'name'), 'Dragon');
    type(field(rows()[0], 'name'), 'Dragon!'); // quick edits make one encounter, not two
    await wait();
    const list = await storage.list();
    expect(list).toEqual([{ id: list[0].id, name: 'Lair' }]);
    const saved = await storage.load(list[0].id);
    expect(saved.rows.map((r) => r.name)).toEqual(['Dragon!']); // empty rows are not kept
  });

  it('opens a saved encounter from the folder list, and starts a new one with +', async () => {
    await make().ready;
    type($('input[data-field="encname"]') as HTMLInputElement, 'Lair');
    type(field(rows()[0], 'name'), 'Dragon');
    await wait();

    click(action('new'));
    await wait();
    expect(rows()).toHaveLength(5);
    expect(tracker.getState().name).toBe('New encounter');
    type(field(rows()[0], 'name'), 'Bandit');
    await wait();

    openList();
    await wait();
    expect($('.it-saved').hidden).toBe(false);
    expect(action('saved').getAttribute('aria-expanded')).toBe('true');
    expect(listed().sort()).toEqual(['Lair', 'New encounter']);
    click($$('.it-saved-open').find((b) => b.textContent === 'Lair'));
    await wait();
    expect($('.it-saved').hidden).toBe(true);
    expect(tracker.getState().name).toBe('Lair');
    expect(names()).toEqual(['Dragon']);

    // changes go back into the opened encounter
    type(field(rows()[0], 'name'), 'Red dragon');
    await wait();
    expect(await storage.list()).toHaveLength(2);
    const lair = (await storage.list()).find((e) => e.name === 'Lair');
    expect((await storage.load(lair.id)).rows[0].name).toBe('Red dragon');
  });

  it('closes the list on Escape and on a press outside it', async () => {
    await make().ready;
    openList();
    expect($('.it-saved').textContent).toContain('No saved encounters');
    $('.it-saved').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect($('.it-saved').hidden).toBe(true);
    openList();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect($('.it-saved').hidden).toBe(true);
  });

  it('deletes a saved encounter after confirmation', async () => {
    await make().ready;
    type(field(rows()[0], 'name'), 'Ann');
    await wait();
    expect(await storage.list()).toHaveLength(1);
    openList();
    await wait();
    click($('.it-saved-delete'));
    expect(await storage.list()).toHaveLength(1);
    click($('.it-saved-delete'));
    await wait();
    expect(await storage.list()).toHaveLength(0);
    // the encounter on screen is kept as a new one when it changes again
    type(field(rows()[1], 'name'), 'Bob');
    await wait();
    expect(await storage.list()).toHaveLength(1);
  });

  it('shows "All changes saved" for a moment after an autosave', async () => {
    await make().ready;
    const note = $('.it-saved-note');
    expect(note.classList.contains('it-saved-note--shown')).toBe(false);
    type(field(rows()[0], 'name'), 'Ann');
    await wait();
    expect(note.textContent).toBe('All changes saved');
    expect(note.classList.contains('it-saved-note--shown')).toBe(true);
  });

  it('hides the encounter controls when there is no storage', async () => {
    await make({ storage: null }).ready;
    expect(action('saved')).toBeNull();
    expect(action('new')).toBeNull();
  });

  it('autosaves the working state and restores it in a new tracker', async () => {
    await make().ready;
    type(field(rows()[0], 'name'), 'Wraith');
    click(action('next'));
    await wait(60);
    tracker.destroy();

    const again = createTracker(container, { storage, autosaveDelay: 10 });
    await again.ready;
    tracker = again;
    expect(rows()).toHaveLength(5);
    expect(field(rows()[0], 'name').value).toBe('Wraith');
    expect(tracker.getState().round).toBe(2);
    expect('encounterId' in tracker.getState()).toBe(false);
    // it carries on saving into the same encounter; the autosave slot is not listed
    type(field(rows()[1], 'name'), 'Ghoul');
    await wait();
    const list = await storage.list();
    expect(list).toHaveLength(1);
    expect((await storage.load(list[0].id)).rows.map((r) => r.name)).toEqual(['Wraith', 'Ghoul']);
  });

  it('saves again as new when the encounter was deleted elsewhere', async () => {
    const kept = new Map<string, TrackerState>();
    let n = 0;
    const remote: EncounterStorage = {
      list: async () => [...kept.keys()].map((id) => ({ id, name: kept.get(id).name })),
      load: async (id) => kept.get(id) || null,
      remove: async (id) => void kept.delete(id),
      save: async (id, state) => {
        if (id && id !== '_last_session' && !kept.has(id)) {
          throw Object.assign(new Error('Not found'), { status: 404 });
        }
        const use = id || 'e' + ++n;
        kept.set(use, state);
        return use;
      },
    };
    await make({ storage: remote }).ready;
    type(field(rows()[0], 'name'), 'Ann');
    await wait();
    expect(kept.has('e1')).toBe(true);
    kept.delete('e1');
    type(field(rows()[0], 'name'), 'Anna');
    await wait();
    expect(kept.get('e2').rows[0].name).toBe('Anna');
    expect($('.it-message').classList.contains('it-sr')).toBe(true);
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
    type(field(rows()[0], 'name'), 'Ann');
    await wait();
    expect(onLimit).toHaveBeenCalledWith('Free accounts keep 3 encounters');
    expect($('.it-message').textContent).toBe('Free accounts keep 3 encounters');
    expect($('.it-message').classList.contains('it-sr')).toBe(false);
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

describe('linked rows', () => {
  const linked = () => {
    const onRowEdit = vi.fn();
    const onLinkClick = vi.fn();
    const onChange = vi.fn();
    make({ storage: null, onRowEdit, onLinkClick, onChange });
    tracker.linkRow('r:1', { name: 'Grik', hp: 10, maxHp: 10 });
    return { onRowEdit, onLinkClick, onChange };
  };
  const type = (field: string, value: string, event: string) => {
    const input = $(`[data-field="${field}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event(event, { bubbles: true }));
  };

  it('tells the host app about HP and AC edits on a linked row only', () => {
    const { onRowEdit } = linked();
    type('hp', '-3', 'change');
    expect(onRowEdit).toHaveBeenLastCalledWith(expect.objectContaining({ link: 'r:1', hp: 7 }));
    type('ac', '15', 'input');
    expect(onRowEdit).toHaveBeenLastCalledWith(expect.objectContaining({ ac: 15 }));
    onRowEdit.mockClear();
    type('name', 'Grak', 'input');
    expect(onRowEdit).not.toHaveBeenCalled();
    $('[data-action="add"]').click();
    (container.querySelectorAll('[data-field="ac"]')[1] as HTMLInputElement).value = '3';
    container
      .querySelectorAll('[data-field="ac"]')[1]
      .dispatchEvent(new Event('input', { bubbles: true }));
    expect(onRowEdit).not.toHaveBeenCalled();
  });

  it('updateLinked changes the row without telling the host app back', () => {
    const { onRowEdit, onChange } = linked();
    onChange.mockClear();
    tracker.updateLinked('r:1', { hp: 2 });
    expect(($('[data-field="hp"]') as HTMLInputElement).value).toBe('2');
    expect(onRowEdit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the link button calls the host app, and untying removes it', () => {
    const { onLinkClick } = linked();
    $('[data-action="link"]').click();
    expect(onLinkClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Grik' }));
    tracker.updateLinked('r:1', { link: undefined });
    expect($('[data-action="link"]')).toBeNull();
    expect(JSON.parse(JSON.stringify(tracker.getState())).rows[0].link).toBeUndefined();
  });

  it('shows no link button without onLinkClick', () => {
    make({ storage: null });
    tracker.linkRow('r:1', { name: 'Grik' });
    expect($('[data-action="link"]')).toBeNull();
  });
});
