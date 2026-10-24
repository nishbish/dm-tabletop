import { creatureBonus, searchCreatures, srdCreatures } from './creatures';
import {
  addRow,
  applyHpInput,
  clear,
  createState,
  migrate,
  moveRowTo,
  nextTurn,
  removeRow,
  resetRound,
  rollInitiative,
  sortByInitiative,
  updateRow,
} from './logic';
import { css, STYLE_ID } from './styles';
import { LAST_SESSION_ID, LocalStorageEncounterStorage, localStorageAvailable } from './storage';
import {
  CreatureTemplate,
  EncounterStorage,
  EncounterSummary,
  Tracker,
  TrackerOptions,
  TrackerRow,
  TrackerState,
} from './types';

// One <style> per document, shared by every tracker on the page and removed with the last one.
const styleUsers = new WeakMap<Document, number>();
function useStyles(doc: Document) {
  const count = styleUsers.get(doc) || 0;
  styleUsers.set(doc, count + 1);
  if (count === 0 && !doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    doc.head.appendChild(style);
  }
}
function releaseStyles(doc: Document) {
  const count = (styleUsers.get(doc) || 1) - 1;
  styleUsers.set(doc, count);
  if (count === 0) {
    const style = doc.getElementById(STYLE_ID);
    if (style) style.remove();
  }
}

let uid = 0;

type Attrs = Record<string, string | number | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

const intOr = (text: string, fallback: number) => {
  const n = parseInt(text, 10);
  return isNaN(n) ? fallback : n;
};

export function createTracker(container: HTMLElement, options: TrackerOptions = {}): Tracker {
  const doc = container.ownerDocument;
  const rng = options.rng || Math.random;
  const creatures: CreatureTemplate[] = options.creatures || srdCreatures;
  const autosaveDelay = options.autosaveDelay === undefined ? 400 : options.autosaveDelay;

  let storage: EncounterStorage | null = null;
  if (options.storage === undefined) {
    if (localStorageAvailable()) storage = new LocalStorageEncounterStorage();
  } else {
    storage = options.storage;
  }

  let state: TrackerState = options.initialState ? migrate(options.initialState) : createState();
  let currentId: string | null = null; // id of the named encounter being edited, if saved
  let dirty = false; // the user changed something (stops a late restore from overwriting it)
  let destroyed = false;
  let saved: EncounterSummary[] = [];
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  const armTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const instance = ++uid;

  useStyles(doc);

  // ---------- skeleton ----------
  const root = el(doc, 'div', { class: 'it-root' });
  const nameInput = el(doc, 'input', {
    class: 'it-enc-name',
    type: 'text',
    'data-field': 'encname',
    autocomplete: 'off',
  });
  const nameLabel = el(doc, 'label', { class: 'it-field' });
  nameLabel.append(el(doc, 'span', {}, 'Encounter name'), nameInput);
  const header = el(doc, 'div', { class: 'it-header' });
  header.append(nameLabel);

  const button = (action: string, label: string, text: string, cls = '') =>
    el(
      doc,
      'button',
      { type: 'button', 'data-action': action, 'aria-label': label, class: cls },
      text,
    );

  const turnLine = el(doc, 'p', {
    class: 'it-turn',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  // The creature list is a grid of divs with table roles (rows can then follow the pointer while
  // they are dragged, which table rows do not do reliably).
  const table = el(doc, 'div', {
    class: 'it-table',
    role: 'table',
    'aria-label': 'Creatures in turn order',
  });
  const head = el(doc, 'div', { class: 'it-head', role: 'row' });
  [
    ['grip', '', 'Reorder'],
    ['init', 'Initiative', ''],
    ['name', 'Name', ''],
    ['hp', 'HP', ''],
    ['ac', 'AC', ''],
    ['remove', '', 'Remove'],
  ].forEach(([cls, text, sr]) => {
    const th = el(doc, 'div', { class: 'it-th it-c-' + cls, role: 'columnheader' }, text);
    if (sr) th.append(el(doc, 'span', { class: 'it-sr' }, sr));
    head.append(th);
  });
  const rowsEl = el(doc, 'div', { class: 'it-rows', role: 'rowgroup' });
  table.append(head, rowsEl);
  const emptyNote = el(
    doc,
    'p',
    { class: 'it-empty' },
    'No creatures yet. Use "Add creature" to start.',
  );

  // Under the list, as on the first tracker: Next, Sort and Clear on the left, the round and the
  // big add button on the right.
  const toolbar = el(doc, 'div', {
    class: 'it-toolbar',
    role: 'group',
    'aria-label': 'Encounter actions',
  });
  const leftTools = el(doc, 'div', { class: 'it-tools-left' });
  leftTools.append(
    button('next', 'Next turn', 'Next', 'it-primary'),
    button('sort', 'Sort by initiative', 'Sort'),
    button('roll-all', 'Roll all initiatives', 'Roll all'),
    button('clear', 'Clear all creatures', 'Clear', 'it-danger'),
  );
  const roundNum = el(doc, 'strong', { class: 'it-round-num' });
  const roundBox = el(doc, 'div', { class: 'it-round' });
  roundBox.append(
    el(doc, 'span', {}, 'Round '),
    roundNum,
    el(
      doc,
      'button',
      {
        type: 'button',
        'data-action': 'reset-round',
        'aria-label': 'Reset round',
        class: 'it-icon',
      },
      '\u21BB',
    ),
  );
  const rightTools = el(doc, 'div', { class: 'it-tools-right' });
  rightTools.append(roundBox, button('add', 'Add creature', '+', 'it-add'));
  toolbar.append(leftTools, rightTools);

  const saveSelect = el(doc, 'select', { 'data-field': 'saved' });
  const storageBox = el(doc, 'div', {
    class: 'it-storage',
    role: 'group',
    'aria-label': 'Saved encounters',
  });
  const selectLabel = el(doc, 'label', { class: 'it-field' });
  selectLabel.append(el(doc, 'span', {}, 'Saved encounters'), saveSelect);
  storageBox.append(
    selectLabel,
    button('open', 'Open selected encounter', 'Open'),
    button('save', 'Save encounter', 'Save'),
    button('new', 'New encounter', 'New'),
    button('delete', 'Delete selected encounter', 'Delete'),
  );
  const message = el(doc, 'p', { class: 'it-message', role: 'status', 'aria-live': 'polite' });

  root.append(header, turnLine, table, emptyNote, toolbar);
  if (storage) root.append(storageBox);
  root.append(message);
  container.appendChild(root);

  // ---------- helpers ----------
  const labelOf = (row: TrackerRow, index: number) => row.name.trim() || 'creature ' + (index + 1);
  // Accessible names mention the creature, so they are refreshed whenever the name changes.
  function relabel(tr: HTMLElement, row: TrackerRow, index: number) {
    const label = labelOf(row, index);
    const names: Record<string, string> = {
      '[data-field="initiative"]': 'Initiative, ' + label,
      '[data-field="bonus"]': 'Initiative bonus, ' + label,
      '[data-field="hp"]': 'Hit points, ' + label + '. Type a number, or +3 / -5 to change it',
      '[data-field="maxhp"]': 'Maximum hit points, ' + label,
      '[data-field="ac"]': 'Armor class, ' + label,
      '[data-action="roll"]': 'Roll initiative for ' + label,
      '[data-grip]': 'Reorder ' + label + '. Drag, or press the up and down arrow keys',
      '[data-action="remove"]': 'Remove ' + label,
    };
    Object.keys(names).forEach((sel) => {
      const node = tr.querySelector(sel);
      if (node) node.setAttribute('aria-label', names[sel]);
    });
  }
  const rowEl = (id: string) =>
    Array.from(rowsEl.children).find((tr) => (tr as HTMLElement).dataset.id === id) as
      HTMLElement | undefined;
  const say = (text: string) => {
    message.textContent = text;
  };

  function commit(next: TrackerState) {
    state = next;
    dirty = true;
    scheduleAutosave();
    if (options.onChange) options.onChange(getState());
  }

  function getState(): TrackerState {
    return JSON.parse(JSON.stringify(state));
  }

  // ---------- rendering ----------
  function cellOf(cls: string, label: string) {
    return el(doc, 'div', { class: 'it-td it-c-' + cls, role: 'cell', 'data-label': label });
  }
  function inputCell(cls: string, label: string, attrs: Attrs, value: string | number) {
    const td = cellOf(cls, label);
    const input = el(doc, 'input', { autocomplete: 'off', ...attrs });
    input.value = String(value);
    td.append(input);
    return { td, input };
  }

  function buildRow(row: TrackerRow, index: number): HTMLElement {
    const label = labelOf(row, index);
    const tr = el(doc, 'div', { class: 'it-row', role: 'row', 'data-id': row.id });

    const gripCell = cellOf('grip', '');
    gripCell.append(
      el(
        doc,
        'button',
        { type: 'button', class: 'it-grip', 'data-grip': 'true', title: 'Drag to reorder' },
        '\u22EE\u22EE',
      ),
    );

    // initiative: the d20 roll button sits in the cell, with the number and the bonus
    const initCell = cellOf('init', 'Initiative');
    const initInput = el(doc, 'input', {
      type: 'number',
      class: 'it-num it-init',
      'data-field': 'initiative',
      autocomplete: 'off',
    });
    initInput.value = String(row.initiative);
    const mod = el(doc, 'label', { class: 'it-mod' });
    const bonusInput = el(doc, 'input', {
      type: 'number',
      class: 'it-bonus',
      'data-field': 'bonus',
      autocomplete: 'off',
    });
    bonusInput.value = String(row.initiativeBonus);
    mod.append(el(doc, 'span', { 'aria-hidden': 'true' }, '+'), bonusInput);
    initCell.append(button('roll', 'Roll initiative for ' + label, '20', 'it-d20'), initInput, mod);

    const listId = `it-list-${instance}-${row.id}`;
    const nameCell = cellOf('name', 'Name');
    nameCell.append(el(doc, 'span', { class: 'it-marker' }));
    const wrap = el(doc, 'div', { class: 'it-name-wrap' });
    const nameField = el(doc, 'input', {
      type: 'text',
      class: 'it-name',
      'data-field': 'name',
      'aria-label': 'Name, row ' + (index + 1),
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': listId,
      autocomplete: 'off',
      spellcheck: 'false',
    });
    nameField.value = row.name;
    wrap.append(nameField);
    nameCell.append(wrap);

    const hpCell = cellOf('hp', 'HP');
    const hpInput = el(doc, 'input', {
      type: 'text',
      class: 'it-hp',
      'data-field': 'hp',
      inputmode: 'text',
      autocomplete: 'off',
    });
    hpInput.value = String(row.hp);
    const maxInput = el(doc, 'input', {
      type: 'number',
      class: 'it-maxhp',
      'data-field': 'maxhp',
      min: 0,
      autocomplete: 'off',
    });
    maxInput.value = String(row.maxHp);
    hpCell.append(
      hpInput,
      el(doc, 'span', { class: 'it-slash', 'aria-hidden': 'true' }, '/'),
      maxInput,
      el(doc, 'span', { class: 'it-down', hidden: true }, 'Down'),
    );
    const ac = inputCell(
      'ac',
      'AC',
      { type: 'number', class: 'it-num', 'data-field': 'ac', min: 0 },
      row.ac,
    );

    const removeCell = cellOf('remove', '');
    removeCell.append(button('remove', 'Remove ' + label, '\u2715', 'it-x'));

    tr.append(gripCell, initCell, nameCell, hpCell, ac.td, removeCell);
    relabel(tr, row, index);
    return tr;
  }

  function relabelRow(id: string) {
    const index = state.rows.findIndex((r) => r.id === id);
    const tr = rowEl(id);
    if (tr && index >= 0) relabel(tr, state.rows[index], index);
  }

  function refreshDown(tr: HTMLElement, row: TrackerRow) {
    const badge = tr.querySelector('.it-down') as HTMLElement | null;
    if (badge) badge.hidden = !(row.maxHp > 0 && row.hp <= 0);
    tr.classList.toggle('it-row--down', row.maxHp > 0 && row.hp <= 0);
  }

  function syncInputs(tr: HTMLElement, row: TrackerRow) {
    const set = (field: string, value: string | number) => {
      const input = tr.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null;
      if (input && input.value !== String(value)) input.value = String(value);
    };
    set('initiative', row.initiative);
    set('bonus', row.initiativeBonus);
    set('name', row.name);
    set('hp', row.hp);
    set('maxhp', row.maxHp);
    set('ac', row.ac);
    refreshDown(tr, row);
  }

  // Marks the creature whose turn it is, with text as well as colour, and announces it.
  function renderTurn(announce: boolean) {
    roundNum.textContent = String(state.round);
    const active = state.rows[state.turn];
    Array.from(rowsEl.children).forEach((node, i) => {
      const tr = node as HTMLElement;
      const isActive = !!active && i === state.turn;
      tr.classList.toggle('it-row--active', isActive);
      if (isActive) tr.setAttribute('aria-current', 'true');
      else tr.removeAttribute('aria-current');
      const marker = tr.querySelector('.it-marker');
      if (marker) {
        marker.textContent = '';
        if (isActive) {
          marker.append(
            el(doc, 'span', { 'aria-hidden': 'true' }, '\u25B6'),
            el(doc, 'span', { class: 'it-sr' }, 'Turn'),
          );
        }
      }
    });
    if (!active) {
      turnLine.textContent = '';
    } else {
      turnLine.textContent = `Round ${state.round}, turn: ${labelOf(active, state.turn)}`;
      const tr = rowEl(active.id);
      if (announce && tr && typeof tr.scrollIntoView === 'function') {
        tr.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  // Rebuilds the rows. Keeps keyboard focus on the same control where it still exists.
  function renderRows() {
    const focused = doc.activeElement as HTMLElement | null;
    let restore: { id: string; sel: string } | null = null;
    if (focused && rowsEl.contains(focused)) {
      const tr = focused.closest('.it-row') as HTMLElement | null;
      const sel = focused.dataset.action
        ? `[data-action="${focused.dataset.action}"]`
        : focused.dataset.grip
          ? '[data-grip]'
          : focused.dataset.field
            ? `[data-field="${focused.dataset.field}"]`
            : '';
      if (tr && sel) restore = { id: tr.dataset.id, sel };
    }
    closeSuggest();
    rowsEl.textContent = '';
    state.rows.forEach((row, i) => {
      const tr = buildRow(row, i);
      rowsEl.append(tr);
      refreshDown(tr, row);
    });
    emptyNote.hidden = state.rows.length > 0;
    table.hidden = state.rows.length === 0;
    nameInput.value = state.name;
    renderTurn(false);
    if (restore) {
      const tr = rowEl(restore.id);
      const target = tr && (tr.querySelector(restore.sel) as HTMLButtonElement | null);
      if (target && !target.disabled) target.focus();
    }
  }

  function renderSaved() {
    if (!storage) return;
    const keep = saveSelect.value;
    saveSelect.textContent = '';
    saveSelect.append(
      el(
        doc,
        'option',
        { value: '' },
        saved.length ? 'Choose an encounter' : 'No saved encounters',
      ),
    );
    saved.forEach((e) =>
      saveSelect.append(el(doc, 'option', { value: e.id }, e.name || 'Untitled')),
    );
    const want = currentId && saved.some((e) => e.id === currentId) ? currentId : keep;
    saveSelect.value = saved.some((e) => e.id === want) ? want : '';
  }

  async function refreshSaved() {
    if (!storage) return;
    try {
      saved = (await storage.list()).filter((e) => e.id !== LAST_SESSION_ID);
    } catch {
      saved = [];
    }
    if (!destroyed) renderSaved();
  }

  // ---------- autocomplete ----------
  let suggest: {
    rowId: string;
    items: CreatureTemplate[];
    index: number;
    ul: HTMLElement;
    input: HTMLInputElement;
  } | null = null;

  function closeSuggest() {
    if (!suggest) return;
    suggest.ul.remove();
    suggest.input.setAttribute('aria-expanded', 'false');
    suggest.input.removeAttribute('aria-activedescendant');
    suggest = null;
  }

  function paintSuggest() {
    if (!suggest) return;
    Array.from(suggest.ul.children).forEach((li, i) => {
      li.setAttribute('aria-selected', i === suggest.index ? 'true' : 'false');
    });
    const active = suggest.ul.children[suggest.index] as HTMLElement | undefined;
    if (active) suggest.input.setAttribute('aria-activedescendant', active.id);
    else suggest.input.removeAttribute('aria-activedescendant');
  }

  function openSuggest(input: HTMLInputElement, rowId: string) {
    const items = searchCreatures(creatures, input.value);
    closeSuggest();
    if (!items.length) return;
    const ul = el(doc, 'ul', {
      class: 'it-suggest',
      role: 'listbox',
      id: input.getAttribute('aria-controls'),
      'aria-label': 'Matching creatures',
    });
    items.forEach((c, i) => {
      const li = el(doc, 'li', {
        role: 'option',
        id: `${ul.id}-${i}`,
        'data-index': i,
        'aria-selected': 'false',
      });
      li.append(el(doc, 'span', {}, c.name), el(doc, 'small', {}, `AC ${c.ac} · HP ${c.hp}`));
      ul.append(li);
    });
    (input.parentElement as HTMLElement).append(ul);
    input.setAttribute('aria-expanded', 'true');
    suggest = { rowId, items, index: -1, ul, input };
  }

  function chooseCreature(c: CreatureTemplate) {
    if (!suggest) return;
    const id = suggest.rowId;
    const input = suggest.input;
    closeSuggest();
    commit(
      updateRow(state, id, {
        name: c.name,
        ac: c.ac,
        hp: c.hp,
        maxHp: c.hp,
        initiativeBonus: creatureBonus(c),
        monsterId: c.id,
      }),
    );
    const tr = rowEl(id);
    const row = state.rows.find((r) => r.id === id);
    if (tr && row) syncInputs(tr, row);
    relabelRow(id);
    input.focus();
    say(`Filled in ${c.name}: AC ${c.ac}, HP ${c.hp}`);
  }

  // ---------- storage ----------
  function scheduleAutosave() {
    if (!storage) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, autosaveDelay);
  }

  function flushAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (!storage) return;
    storage.save(LAST_SESSION_ID, getState()).catch((err) => reportSaveError(err, false));
  }

  function reportSaveError(err: unknown, loud: boolean) {
    const e = err as { code?: string; message?: string };
    if (e && e.code === 'LIMIT') {
      const reason = e.message || 'Storage limit reached';
      if (options.onLimit) options.onLimit(reason);
      if (!destroyed) say(reason);
    } else if (loud && !destroyed) {
      say((e && e.message) || 'Could not save');
    }
  }

  async function saveNamed() {
    if (!storage) return;
    try {
      currentId = await storage.save(currentId, getState());
      say(`Saved "${state.name}"`);
    } catch (err) {
      reportSaveError(err, true);
    }
    await refreshSaved();
  }

  async function openNamed() {
    if (!storage || !saveSelect.value) {
      say('Choose a saved encounter first');
      return;
    }
    const id = saveSelect.value;
    const loaded = await storage.load(id);
    if (destroyed) return;
    if (!loaded) {
      say('That encounter could not be loaded');
      return;
    }
    currentId = id;
    commit(migrate(loaded));
    renderRows();
    say(`Opened "${state.name}"`);
  }

  function newEncounter() {
    currentId = null;
    commit(createState());
    renderRows();
    saveSelect.value = '';
    say('Started a new encounter');
  }

  async function deleteNamed() {
    if (!storage) return;
    const id = saveSelect.value || currentId;
    if (!id) {
      say('Choose a saved encounter to delete');
      return;
    }
    try {
      await storage.remove(id);
      if (id === currentId) currentId = null;
      say('Deleted the saved encounter');
    } catch {
      say('Could not delete that encounter');
    }
    await refreshSaved();
  }

  // Destructive buttons need a second press within a few seconds.
  function confirmFirst(btn: HTMLButtonElement, key: string, confirmText: string, run: () => void) {
    const original = btn.dataset.original || btn.textContent;
    btn.dataset.original = original;
    const origLabel = btn.dataset.originalLabel || btn.getAttribute('aria-label');
    btn.dataset.originalLabel = origLabel;
    const reset = () => {
      const t = armTimers.get(key);
      if (t) clearTimeout(t);
      armTimers.delete(key);
      btn.textContent = original;
      btn.setAttribute('aria-label', origLabel);
      btn.classList.remove('it-armed');
    };
    if (armTimers.has(key)) {
      reset();
      run();
      return;
    }
    btn.textContent = confirmText;
    btn.setAttribute('aria-label', confirmText);
    btn.classList.add('it-armed');
    say(confirmText + ' Press again to confirm.');
    armTimers.set(key, setTimeout(reset, 4000));
  }

  // ---------- actions ----------
  function rowIdOf(node: Element): string | undefined {
    const tr = node.closest('.it-row') as HTMLElement | null;
    return tr ? tr.dataset.id : undefined;
  }

  function onClick(e: Event) {
    const target = e.target as Element;
    const option = target.closest('.it-suggest li') as HTMLElement | null;
    if (option && suggest) {
      chooseCreature(suggest.items[Number(option.dataset.index)]);
      return;
    }
    const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const id = rowIdOf(btn);

    switch (action) {
      case 'add': {
        const before = state.rows.length;
        commit(addRow(state));
        renderRows();
        renderTurn(false);
        const tr = rowsEl.children[before] as HTMLElement;
        const field = tr && (tr.querySelector('[data-field="name"]') as HTMLInputElement);
        if (field) field.focus();
        break;
      }
      case 'roll-all':
        commit({
          ...state,
          rows: state.rows.map((r) => ({
            ...r,
            initiative: rollInitiative(r.initiativeBonus, rng),
          })),
        });
        renderRows();
        say('Rolled initiative for everyone');
        break;
      case 'roll':
        if (id) {
          const row = state.rows.find((r) => r.id === id);
          commit(updateRow(state, id, { initiative: rollInitiative(row.initiativeBonus, rng) }));
          renderRows();
        }
        break;
      case 'sort':
        commit(sortByInitiative(state));
        renderRows();
        say('Sorted by initiative');
        break;
      case 'next':
        commit(nextTurn(state));
        renderTurn(true);
        break;
      case 'reset-round':
        commit(resetRound(state));
        renderTurn(true);
        break;
      case 'clear':
        confirmFirst(btn, 'clear', 'Clear all creatures?', () => {
          commit(clear(state));
          renderRows();
          say('Cleared');
        });
        break;
      case 'remove':
        if (id) {
          commit(removeRow(state, id));
          renderRows();
          (toolbar.querySelector('[data-action="add"]') as HTMLElement).focus();
        }
        break;
      case 'save':
        void saveNamed();
        break;
      case 'open':
        void openNamed();
        break;
      case 'new':
        newEncounter();
        break;
      case 'delete':
        confirmFirst(btn, 'delete', 'Delete this encounter?', () => void deleteNamed());
        break;
    }
  }

  function onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const field = input.dataset && input.dataset.field;
    if (!field) return;
    if (field === 'encname') {
      commit({ ...state, name: input.value });
      return;
    }
    const id = rowIdOf(input);
    if (!id) return;
    if (field === 'name') {
      commit(updateRow(state, id, { name: input.value }));
      relabelRow(id);
      openSuggest(input, id);
    } else if (field === 'initiative') {
      commit(updateRow(state, id, { initiative: intOr(input.value, 0) }));
    } else if (field === 'bonus') {
      commit(updateRow(state, id, { initiativeBonus: intOr(input.value, 0) }));
    } else if (field === 'ac') {
      commit(updateRow(state, id, { ac: Math.max(0, intOr(input.value, 0)) }));
    } else if (field === 'maxhp') {
      commit(updateRow(state, id, { maxHp: Math.max(0, intOr(input.value, 0)) }));
      refreshDown(
        rowEl(id),
        state.rows.find((r) => r.id === id),
      );
    }
  }

  // The HP field is committed on change (blur or Enter) so "-5" is not applied per keystroke.
  function onChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.dataset && input.dataset.field === 'saved') return;
    if (!input.dataset || input.dataset.field !== 'hp') return;
    const id = rowIdOf(input);
    const row = state.rows.find((r) => r.id === id);
    if (!row) return;
    const result = applyHpInput(input.value, row.hp, row.maxHp);
    commit(updateRow(state, id, { hp: result.hp, maxHp: result.maxHp }));
    const next = state.rows.find((r) => r.id === id);
    syncInputs(rowEl(id), next);
  }

  function onKeydown(e: KeyboardEvent) {
    if (onGripKey(e)) return;
    const input = e.target as HTMLInputElement;
    if (!suggest || input !== suggest.input) return;
    const n = suggest.items.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggest.index = (suggest.index + 1) % n;
      paintSuggest();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggest.index = (suggest.index - 1 + n) % n;
      paintSuggest();
    } else if (e.key === 'Enter' && suggest.index >= 0) {
      e.preventDefault();
      chooseCreature(suggest.items[suggest.index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggest();
    }
  }

  function onFocusOut(e: Event) {
    const input = e.target as HTMLInputElement;
    if (suggest && input === suggest.input) closeSuggest();
  }

  // Options must not steal focus from the name field before the click lands.
  function onMouseDown(e: Event) {
    if ((e.target as Element).closest('.it-suggest')) e.preventDefault();
  }

  // ---------- drag to reorder (pointer events on the grip) ----------
  // The row follows the pointer while the others slide out of its way, as on the first tracker.
  // Nothing is committed until the pointer is released.
  let drag: {
    id: string;
    from: number;
    over: number;
    startY: number;
    pitch: number;
    el: HTMLElement;
    rows: HTMLElement[];
    pointerId: number | undefined;
  } | null = null;

  function resetDragStyles() {
    Array.from(rowsEl.children).forEach((node) => {
      const tr = node as HTMLElement;
      tr.classList.remove('it-row--dragging', 'it-row--shifted', 'it-row--settling');
      tr.style.removeProperty('transform');
    });
    rowsEl.classList.remove('it-rows--dragging');
  }

  function onPointerDown(e: PointerEvent) {
    const grip = (e.target as Element).closest('[data-grip]') as HTMLElement | null;
    if (!grip || (e.button !== undefined && e.button > 0) || drag) return;
    const id = rowIdOf(grip);
    if (!id) return;
    e.preventDefault();
    if (grip.setPointerCapture && e.pointerId !== undefined) {
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; dragging still works while the pointer stays over the page.
      }
    }
    const rows = Array.from(rowsEl.children) as HTMLElement[];
    const from = rows.findIndex((r) => r.dataset.id === id);
    const rect = rows[from].getBoundingClientRect();
    // distance from one row to the next (row height plus the gap), measured, not assumed
    const next = rows[from + 1] || rows[from - 1];
    const pitch = next
      ? Math.abs(next.getBoundingClientRect().top - rect.top) || rect.height
      : rect.height;
    drag = {
      id,
      from,
      over: from,
      startY: e.clientY,
      pitch,
      el: rows[from],
      rows,
      pointerId: e.pointerId,
    };
    rows[from].classList.add('it-row--dragging');
    rowsEl.classList.add('it-rows--dragging');
    rows.forEach((r, i) => {
      if (i !== from) r.classList.add('it-row--shifted');
    });
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const { from, rows, pitch, startY } = drag;
    const dy = e.clientY - startY;
    // keep the dragged row inside the list
    const min = -from * pitch;
    const max = (rows.length - 1 - from) * pitch;
    const clamped = Math.max(min, Math.min(max, dy));
    drag.el.style.transform = `translateY(${clamped}px)`;
    const over = Math.max(0, Math.min(rows.length - 1, from + Math.round(clamped / pitch)));
    drag.over = over;
    rows.forEach((r, i) => {
      if (i === from) return;
      let shift = 0;
      if (from < over && i > from && i <= over) shift = -pitch;
      else if (from > over && i >= over && i < from) shift = pitch;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function finishDrag(commitIt: boolean) {
    if (!drag) return;
    const { id, from, over, el: dragged, pitch, rows } = drag;
    drag = null;
    if (!commitIt || over === from) {
      // slide back
      dragged.classList.add('it-row--settling');
      dragged.style.transform = '';
      rows.forEach((r) => (r.style.transform = ''));
      setTimeout(() => {
        if (!destroyed) resetDragStyles();
      }, 160);
      return;
    }
    // slide into the slot, then rebuild the list in the new order
    dragged.classList.add('it-row--settling');
    dragged.style.transform = `translateY(${(over - from) * pitch}px)`;
    const finish = () => {
      if (destroyed) return;
      resetDragStyles();
      commit(moveRowTo(state, id, over));
      renderRows();
    };
    setTimeout(finish, 140);
  }

  function onPointerUp() {
    finishDrag(true);
  }

  function onPointerCancel() {
    finishDrag(false);
  }

  // The same, from the keyboard: arrow keys on the grip move the row one place.
  function onGripKey(e: KeyboardEvent) {
    const grip = (e.target as Element).closest('[data-grip]') as HTMLElement | null;
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
    const id = rowIdOf(grip);
    if (!id) return false;
    e.preventDefault();
    const from = state.rows.findIndex((r) => r.id === id);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= state.rows.length) return true;
    commit(moveRowTo(state, id, to));
    renderRows();
    say(`${labelOf(state.rows[to], to)} moved to place ${to + 1} of ${state.rows.length}`);
    return true;
  }

  const listeners: Array<[string, EventListener]> = [
    ['click', onClick as EventListener],
    ['input', onInput as EventListener],
    ['change', onChange as EventListener],
    ['keydown', onKeydown as EventListener],
    ['focusout', onFocusOut as EventListener],
    ['mousedown', onMouseDown as EventListener],
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', onPointerUp as EventListener],
    ['pointercancel', onPointerCancel as EventListener],
  ];
  listeners.forEach(([type, fn]) => root.addEventListener(type, fn));

  const view = doc.defaultView;
  const onPageHide = () => {
    if (dirty && storage) flushAutosave();
  };
  if (view) view.addEventListener('pagehide', onPageHide);

  // ---------- start ----------
  renderRows();
  renderSaved();

  const ready = (async () => {
    if (!storage) return;
    if (!options.initialState) {
      try {
        const last = await storage.load(LAST_SESSION_ID);
        if (last && !dirty && !destroyed) {
          state = migrate(last);
          renderRows();
        }
      } catch {
        // No usable last session: start empty.
      }
    }
    await refreshSaved();
  })();

  return {
    ready,
    getState,
    setState(next: TrackerState) {
      state = migrate(next);
      dirty = true;
      renderRows();
      scheduleAutosave();
    },
    destroy() {
      if (destroyed) return;
      if (dirty && storage) flushAutosave();
      destroyed = true;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      armTimers.forEach((t) => clearTimeout(t));
      armTimers.clear();
      listeners.forEach(([type, fn]) => root.removeEventListener(type, fn));
      if (view) view.removeEventListener('pagehide', onPageHide);
      root.remove();
      releaseStyles(doc);
    },
  };
}
