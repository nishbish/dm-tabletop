import { creatureBonus, defaultCreatures, searchCreatures, srdCreatures } from './creatures';
import {
  addRow,
  applyHpInput,
  changeHp,
  clear,
  createState,
  hasContent,
  isBlankRow,
  linkRow,
  migrate,
  moveRowTo,
  nextTurn,
  removeRow,
  resetRound,
  rollHitDice,
  rollInitiative,
  sortByInitiative,
  updateRow,
  withoutBlankRows,
} from './logic';
import { css, STYLE_ID } from './styles';
import { escapeHtml, renderStatBlock, SRD_CREDIT_HTML } from './statblock';
import type { Monster } from './statblock';
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

// A plain folder outline for the saved-encounters button (drawn here, no icon font needed).
// An open book, for the stat block button in the name cell.
const BOOK_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zm0 0V19" ' +
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
  '<path d="M3 5h6.5l2 2H21v12H3z" fill="currentColor"/></svg>';

// The encounter the tracker is saving into. `id` is null until it has been saved once;
// `blocked` stops further tries after the host refused to keep another one (LIMIT).
interface OpenEncounter {
  id: string | null;
  blocked: boolean;
}

const notFound = (err: unknown) => {
  const e = err as { status?: number; code?: string } | null;
  return !!e && (e.status === 404 || e.code === 'NOT_FOUND');
};

const intOr = (text: string, fallback: number) => {
  const n = parseInt(text, 10);
  return isNaN(n) ? fallback : n;
};

export function createTracker(container: HTMLElement, options: TrackerOptions = {}): Tracker {
  const doc = container.ownerDocument;
  const rng = options.rng || Math.random;
  const creatures: CreatureTemplate[] = options.creatures || defaultCreatures;
  const autosaveDelay = options.autosaveDelay === undefined ? 400 : options.autosaveDelay;

  let storage: EncounterStorage | null = null;
  if (options.storage === undefined) {
    if (localStorageAvailable()) storage = new LocalStorageEncounterStorage();
  } else {
    storage = options.storage;
  }

  let state: TrackerState = options.initialState ? migrate(options.initialState) : createState();
  // The open encounter. Every change is autosaved into it (and into the last session), as on the
  // first tracker: there is no Save button.
  let current: OpenEncounter = { id: null, blocked: false };
  let dirty = false; // the user changed something (stops a late restore from overwriting it)
  let pending = false; // a change has not been handed to storage yet
  let saving: Promise<void> = Promise.resolve(); // saves run one after another
  let destroyed = false;
  let saved: EncounterSummary[] = [];
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  const armTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const instance = ++uid;

  useStyles(doc);

  // ---------- skeleton ----------
  const root = el(doc, 'div', { class: 'it-root' });
  // The name, with the folder (saved encounters) and new-encounter buttons beside it, as on the
  // first tracker. No label: the name is the heading of the encounter.
  const nameInput = el(doc, 'input', {
    class: 'it-enc-name',
    type: 'text',
    'data-field': 'encname',
    'aria-label': 'Encounter name',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const header = el(doc, 'div', { class: 'it-header' });
  header.append(nameInput);

  const button = (action: string, label: string, text: string, cls = '') =>
    el(
      doc,
      'button',
      { type: 'button', 'data-action': action, 'aria-label': label, class: cls },
      text,
    );

  const folderButton = el(doc, 'button', {
    type: 'button',
    'data-action': 'saved',
    'aria-label': 'Saved encounters',
    title: 'Open encounter',
    'aria-expanded': 'false',
    'aria-controls': `it-saved-${instance}`,
    class: 'it-icon it-folder',
  });
  folderButton.innerHTML = FOLDER_ICON;
  const savedList = el(doc, 'div', {
    class: 'it-saved',
    id: `it-saved-${instance}`,
    role: 'group',
    'aria-label': 'Saved encounters',
    hidden: true,
  });
  if (storage) {
    const newButton = button('new', 'New encounter', '+', 'it-icon it-new');
    newButton.title = 'New encounter';
    header.append(folderButton, newButton, savedList);
  }

  // Whose turn it is goes to screen readers only: the highlighted row shows it on screen.
  const turnLine = el(doc, 'p', {
    class: 'it-turn it-sr',
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

  // Problems (a save refused, an encounter that would not open) are shown; everything else the
  // tracker says only reaches screen readers.
  const message = el(doc, 'p', {
    class: 'it-message it-sr',
    role: 'status',
    'aria-live': 'polite',
  });
  // "All changes saved", shown for a moment after each autosave, as on the first tracker: with no
  // Save button it is the sign that the encounter was kept. Screen readers are not told every
  // time; a problem saving is announced (see `say`).
  const savedNote = el(doc, 'span', { class: 'it-saved-note', 'aria-hidden': 'true' });
  let savedNoteTimer: ReturnType<typeof setTimeout> | null = null;
  function showSaved() {
    if (destroyed || !storage || shown) return;
    savedNote.textContent = 'All changes saved';
    savedNote.classList.add('it-saved-note--shown');
    if (savedNoteTimer) clearTimeout(savedNoteTimer);
    savedNoteTimer = setTimeout(() => savedNote.classList.remove('it-saved-note--shown'), 2500);
  }
  header.append(savedNote, message);

  root.append(header, turnLine, table, toolbar);
  container.appendChild(root);

  // ---------- helpers ----------
  const labelOf = (row: TrackerRow, index: number) => row.name.trim() || 'creature ' + (index + 1);
  // Accessible names mention the creature, so they are refreshed whenever the name changes.
  function relabel(tr: HTMLElement, row: TrackerRow, index: number) {
    const label = labelOf(row, index);
    const names: Record<string, string> = {
      '[data-field="initiative"]': 'Initiative, ' + label,
      '[data-field="hp"]': 'Hit points, ' + label + '. Type a number, or +3 / -5 to change it',
      '[data-field="maxhp"]': 'Maximum hit points, ' + label,
      '[data-field="hpstep"]': 'Amount to add or subtract, ' + label,
      '[data-action="hp-down"]': 'Subtract the amount from hit points, ' + label,
      '[data-action="hp-up"]': 'Add the amount to hit points, ' + label,
      '[data-field="initstep"]': 'Amount to add or subtract, initiative of ' + label,
      '[data-action="init-down"]': 'Subtract the amount from initiative, ' + label,
      '[data-action="init-up"]': 'Add the amount to initiative, ' + label,
      '[data-field="ac"]': 'Armor class, ' + label,
      '[data-action="roll"]': 'Roll initiative for ' + label,
      '[data-action="roll-hp"]': 'Roll hit points for ' + label,
      '[data-grip]': 'Reorder ' + label + '. Drag, or press the up and down arrow keys',
      '[data-action="remove"]': 'Remove ' + label,
      '[data-action="link"]': 'Show ' + label + ' on the table',
      '[data-action="info"]': 'Stat block for ' + label,
    };
    Object.keys(names).forEach((sel) => {
      const node = tr.querySelector(sel);
      if (node) node.setAttribute('aria-label', names[sel]);
    });
  }
  const rowEl = (id: string) =>
    Array.from(rowsEl.children).find((tr) => (tr as HTMLElement).dataset.id === id) as
      HTMLElement | undefined;
  let shown = false; // the message on screen is a problem the user should see
  const say = (text: string, loud = false) => {
    message.textContent = text;
    shown = loud && !!text;
    message.classList.toggle('it-sr', !shown);
  };
  const clearProblem = () => {
    if (shown) say('');
  };

  function commit(next: TrackerState) {
    state = next;
    dirty = true;
    scheduleAutosave();
    if (options.onChange) options.onChange(getState());
  }

  // The user changed something a linked row shares with what it is linked to.
  function edited(id: string) {
    const row = state.rows.find((r) => r.id === id);
    if (row && row.link && options.onRowEdit) options.onRowEdit({ ...row });
  }

  function getState(): TrackerState {
    return JSON.parse(JSON.stringify(state));
  }

  // ---------- rendering ----------
  // A 0 that nobody typed shows as an empty field, so empty rows look empty. HP 0 still shows
  // when the creature has a max HP (it is down).
  const blankZero = (n: number) => (n ? String(n) : '');
  const hpText = (row: TrackerRow) => (row.hp || row.maxHp ? String(row.hp) : '');

  // the creature a row was filled from, for its hit dice
  const creatureOf = (row: TrackerRow) =>
    row.monsterId ? creatures.find((c) => c.id === row.monsterId) : undefined;
  const hitDiceOf = (row: TrackerRow) => {
    const c = creatureOf(row);
    return c && c.hitDice && rollHitDice(c.hitDice, () => 0) !== null ? c.hitDice : '';
  };
  // the HP roll button shows the die it rolls ("d6"), like the d20 of initiative
  const hpDieText = (hitDice: string) => (hitDice ? 'd' + /d\s*(\d+)/i.exec(hitDice)[1] : '');

  const modText = (row: TrackerRow) => {
    if (!row.initiativeBonus && !row.monsterId) return '';
    return `(${row.initiativeBonus >= 0 ? '+' : ''}${row.initiativeBonus})`;
  };

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

  // The - / + box under the initiative and HP fields, as on the first tracker: an amount (1 to
  // start with) between a minus and a plus button. Shown while the cell is in use (see openPop).
  function stepBox(kind: 'init' | 'hp', label: string) {
    const box = el(doc, 'div', { class: 'it-hp-pop', role: 'group', 'aria-label': label });
    const amount = el(doc, 'input', {
      type: 'number',
      class: 'it-hp-amount',
      'data-field': kind + 'step',
      min: 1,
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    amount.value = '1';
    box.append(
      button(kind + '-down', '', '\u2212', 'it-hp-step'),
      amount,
      button(kind + '-up', '', '+', 'it-hp-step'),
    );
    return box;
  }

  function buildRow(row: TrackerRow, index: number): HTMLElement {
    const label = labelOf(row, index);
    const tr = el(doc, 'div', { class: 'it-row', role: 'row', 'data-id': row.id });

    // The initiative cell starts with the drag handle (no column of its own, so no extra line),
    // then the number, which takes the rest of the cell; the bonus and the d20 sit over its right
    // end, as on the first tracker.
    const grip = el(
      doc,
      'button',
      { type: 'button', class: 'it-grip', 'data-grip': 'true', title: 'Drag to reorder' },
      '\u22EE\u22EE',
    );
    const initCell = cellOf('init', 'Initiative');
    const initInput = el(doc, 'input', {
      type: 'number',
      class: 'it-num it-init',
      'data-field': 'initiative',
      autocomplete: 'off',
    });
    initInput.value = blankZero(row.initiative);
    // A picked creature's bonus, in brackets as on the first tracker. It is not typed in: players
    // say their total, and a creature from the list brings its own.
    const mod = el(doc, 'span', { class: 'it-mod' }, modText(row));
    initCell.append(
      grip,
      initInput,
      mod,
      button('roll', 'Roll initiative for ' + label, '20', 'it-d20'),
      stepBox('init', 'Change initiative'),
    );

    const listId = `it-list-${instance}-${row.id}`;
    // the name field fills the cell; the turn arrow sits over its left padding
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
    if (options.statBlocks) {
      // the stat block button: only on a row filled from the creature list
      const info = el(doc, 'button', {
        type: 'button',
        class: 'it-info',
        'data-action': 'info',
        'aria-label': 'Stat block for ' + label,
        title: 'Stat block',
        'aria-expanded': String(panelRowId === row.id),
        'aria-controls': panelId,
      });
      info.innerHTML = BOOK_ICON;
      info.hidden = !hasStatBlock(row.monsterId);
      nameCell.append(info);
    }
    if (row.link && options.onLinkClick) {
      nameCell.append(
        el(
          doc,
          'button',
          { type: 'button', class: 'it-link', 'data-action': 'link', title: 'Show on the table' },
          '\u25CE',
        ),
      );
    }

    const hpCell = cellOf('hp', 'HP');
    const hpInput = el(doc, 'input', {
      type: 'text',
      class: 'it-hp',
      'data-field': 'hp',
      placeholder: ' ', // lets the stylesheet hide the / while there are no hit points
      inputmode: 'text',
      autocomplete: 'off',
    });
    hpInput.value = hpText(row);
    const maxInput = el(doc, 'input', {
      type: 'number',
      class: 'it-maxhp',
      'data-field': 'maxhp',
      placeholder: ' ',
      min: 0,
      autocomplete: 'off',
    });
    maxInput.value = blankZero(row.maxHp);
    // Current HP takes most of the cell, max HP a small part on the right (the / sits over its
    // left padding). The - / + box comes after max HP so Tab goes HP, max HP, -, amount, +.
    const hpPop = stepBox('hp', 'Change HP');
    // A creature from the list can roll its hit points, as on the first tracker: the button shows
    // on hover, or while the cell is in use, and only for a row with hit dice.
    const hitDice = hitDiceOf(row);
    const hpRoll = button('roll-hp', '', hpDieText(hitDice), 'it-d20 it-hp-roll');
    hpRoll.hidden = !hitDice;
    hpCell.append(
      hpInput,
      el(doc, 'span', { class: 'it-slash', 'aria-hidden': 'true' }, '/'),
      maxInput,
      hpPop,
      hpRoll, // after the box, so Tab still goes HP, max HP, -, amount, +
      el(doc, 'span', { class: 'it-down', hidden: true }, 'Down'),
    );
    const ac = inputCell(
      'ac',
      'AC',
      { type: 'number', class: 'it-num', 'data-field': 'ac', min: 0 },
      blankZero(row.ac),
    );

    const removeCell = cellOf('remove', '');
    // a minus in a thin ring: the pair of the big + that adds a row (a cross reads as "close"),
    // and the ring tells it apart from the - buttons that subtract hit points
    const removeButton = button('remove', 'Remove ' + label, '', 'it-x');
    removeButton.append(el(doc, 'span', { class: 'it-x-mark', 'aria-hidden': 'true' }, '\u2212'));
    removeCell.append(removeButton);

    tr.append(initCell, nameCell, hpCell, ac.td, removeCell);
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
    // a number field being typed in keeps what was typed ("" and "0" mean the same there)
    const set = (field: string, value: string) => {
      const input = tr.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null;
      if (!input || input.value === value) return;
      const typing = input === doc.activeElement && field !== 'name';
      if (typing && intOr(input.value, 0) === intOr(value, 0)) return;
      input.value = value;
    };
    set('initiative', blankZero(row.initiative));
    const hpRoll = tr.querySelector('[data-action="roll-hp"]') as HTMLButtonElement | null;
    if (hpRoll) {
      const hitDice = hitDiceOf(row);
      hpRoll.hidden = !hitDice;
      if (hpRoll.textContent !== hpDieText(hitDice)) hpRoll.textContent = hpDieText(hitDice);
    }
    const mod = tr.querySelector('.it-mod');
    if (mod && mod.textContent !== modText(row)) mod.textContent = modText(row);
    const info = tr.querySelector('[data-action="info"]') as HTMLButtonElement | null;
    if (info) info.hidden = !hasStatBlock(row.monsterId);
    set('name', row.name);
    set('hp', hpText(row));
    set('maxhp', blankZero(row.maxHp));
    set('ac', blankZero(row.ac));
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
    popOpen = null;
    if (panelRowId && !state.rows.some((r) => r.id === panelRowId)) closePanel(false);
    rowsEl.textContent = '';
    state.rows.forEach((row, i) => {
      const tr = buildRow(row, i);
      rowsEl.append(tr);
      refreshDown(tr, row);
    });
    if (nameInput !== doc.activeElement) nameInput.value = state.name;
    renderTurn(false);
    if (restore) {
      const tr = rowEl(restore.id);
      const target = tr && (tr.querySelector(restore.sel) as HTMLButtonElement | null);
      if (target && !target.disabled) target.focus();
    }
  }

  // The list under the folder button: click a name to open it, the bin to delete it.
  function renderSaved() {
    if (!storage) return;
    savedList.textContent = '';
    if (!saved.length) {
      savedList.append(el(doc, 'p', { class: 'it-saved-empty' }, 'No saved encounters yet'));
      return;
    }
    const ul = el(doc, 'ul');
    saved.forEach((e) => {
      const li = el(doc, 'li');
      const open = el(
        doc,
        'button',
        {
          type: 'button',
          class: 'it-saved-open',
          'data-action': 'open',
          'data-id': e.id,
          'aria-current': e.id === current.id ? 'true' : undefined,
        },
        e.name || 'Untitled encounter',
      );
      const del = el(
        doc,
        'button',
        {
          type: 'button',
          class: 'it-saved-delete',
          'data-action': 'delete',
          'data-id': e.id,
          'aria-label': 'Delete ' + (e.name || 'Untitled encounter'),
          title: 'Delete',
        },
        '\u2715',
      );
      li.append(open, del);
      ul.append(li);
    });
    savedList.append(ul);
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

  function openList() {
    renderSaved();
    savedList.hidden = false;
    folderButton.setAttribute('aria-expanded', 'true');
    void refreshSaved();
  }

  function closeList() {
    if (savedList.hidden) return;
    savedList.hidden = true;
    folderButton.setAttribute('aria-expanded', 'false');
  }

  // ---------- initiative and HP cells ----------
  // A cell is "open" while it is in use: focus moved into it from outside, or its field was
  // clicked or tapped. An open initiative cell shows its d20 button (on a screen with a mouse it
  // also shows on hover), and both cells show their - / + box. It closes when focus or a pointer
  // press lands outside it, or on Escape. A class (not :focus-within) keeps it open when a phone
  // browser drops focus on tapping a button, so the tap still reaches the button.
  const POP_CELLS = '.it-c-init, .it-c-hp';
  let popOpen: HTMLElement | null = null;
  const openClass = (cell: HTMLElement) =>
    cell.classList.contains('it-c-hp') ? 'it-c-hp--open' : 'it-c-init--open';

  function openPop(cell: HTMLElement) {
    if (popOpen === cell) return;
    closePop();
    popOpen = cell;
    cell.classList.add(openClass(cell));
  }

  function closePop() {
    if (!popOpen) return;
    popOpen.classList.remove(openClass(popOpen));
    popOpen = null;
  }

  function stepAmount(btn: HTMLElement, kind: string) {
    const cell = btn.closest(POP_CELLS);
    const input = cell && (cell.querySelector(`[data-field="${kind}step"]`) as HTMLInputElement);
    return Math.abs(intOr(input ? input.value : '', 1));
  }

  function stepHp(btn: HTMLElement, id: string, sign: number) {
    const row = state.rows.find((r) => r.id === id);
    const amount = stepAmount(btn, 'hp');
    if (!row || !amount) return;
    commit(updateRow(state, id, { hp: changeHp(row.hp, row.maxHp, sign * amount) }));
    const next = state.rows.find((r) => r.id === id);
    syncInputs(rowEl(id), next);
    say(`${labelOf(next, state.rows.indexOf(next))}: ${next.hp} HP`);
  }

  function stepInit(btn: HTMLElement, id: string, sign: number) {
    const row = state.rows.find((r) => r.id === id);
    const amount = stepAmount(btn, 'init');
    if (!row || !amount) return;
    commit(updateRow(state, id, { initiative: row.initiative + sign * amount }));
    const next = state.rows.find((r) => r.id === id);
    syncInputs(rowEl(id), next);
    say(`${labelOf(next, state.rows.indexOf(next))}: initiative ${next.initiative}`);
  }

  function onFocusIn(e: FocusEvent) {
    const cell = (e.target as Element).closest(POP_CELLS) as HTMLElement | null;
    if (!cell) {
      closePop();
      return;
    }
    // Moving between the controls of one cell keeps it as it is (so Escape stays closed).
    const from = e.relatedTarget as Node | null;
    if (!from || !cell.contains(from)) openPop(cell);
  }

  function onDocPointerDown(e: Event) {
    const target = e.target as Node;
    if (popOpen && !popOpen.contains(target)) closePop();
    if (!savedList.hidden && !savedList.contains(target) && !folderButton.contains(target)) {
      closeList();
    }
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
      li.append(
        el(doc, 'span', {}, c.name),
        el(doc, 'small', {}, `${c.ruleset ? c.ruleset + ' · ' : ''}AC ${c.ac} · HP ${c.hp}`),
      );
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
    edited(id);
    // the panel is showing this row: show the creature it was changed to
    if (panelRowId === id && row) void openPanel(row, false);
    input.focus();
  }

  // ---------- stat block panel ----------
  // A panel at the side of the window (a sheet along the bottom on a phone) with the stat block of
  // a row's creature, so it can be read mid-combat without leaving the tracker. It is not modal:
  // the tracker stays usable beside it. It lives on <body> (the tracker is a size container, which
  // would otherwise hold a fixed panel inside its own box).
  const panelId = `it-panel-${instance}`;
  const srdIds = new Set(srdCreatures.map((c) => c.id));
  const hasStatBlock = (id: string | undefined) => {
    const source = options.statBlocks;
    if (!id || !source) return false;
    return source.has ? source.has(id) : srdIds.has(id);
  };
  let panel: HTMLElement | null = null;
  let panelBody: HTMLElement | null = null;
  let panelRowId: string | null = null;
  let panelToken = 0;
  const statCache = new Map<string, Promise<Monster | null>>();

  function ensurePanel(): HTMLElement {
    if (panel) return panel;
    panel = el(doc, 'aside', {
      class: 'it-panel',
      id: panelId,
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': 'Stat block',
      hidden: true,
    });
    const close = button('close-panel', 'Close stat block', '\u00D7', 'it-panel-close');
    panelBody = el(doc, 'div', { class: 'it-panel-body' });
    panel.append(close, panelBody);
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('keydown', onPanelKeydown);
    doc.body.append(panel);
    return panel;
  }

  function onPanelClick(e: Event) {
    const btn = (e.target as Element).closest('[data-action="close-panel"]');
    if (btn) closePanel(true);
  }
  function onPanelKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel(true);
    }
  }

  function infoButton(rowId: string): HTMLButtonElement | null {
    const tr = rowEl(rowId);
    return tr && (tr.querySelector('[data-action="info"]') as HTMLButtonElement | null);
  }
  function markOpen(rowId: string | null, open: boolean) {
    const btn = rowId && infoButton(rowId);
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  async function openPanel(row: TrackerRow, focus = true) {
    const source = options.statBlocks;
    const box = ensurePanel();
    markOpen(panelRowId, false);
    panelRowId = row.id;
    markOpen(row.id, true);
    const token = ++panelToken;
    const id = row.monsterId;
    box.hidden = false;
    panelBody.innerHTML = '<p class="it-panel-note">Loading\u2026</p>';
    if (focus) (box.querySelector('.it-panel-close') as HTMLElement).focus();
    if (!statCache.has(id)) {
      // a failed load is not kept, so the next click tries again
      const p = source.load(id).catch(() => {
        statCache.delete(id);
        return undefined;
      });
      statCache.set(id, p);
    }
    const monster = await statCache.get(id);
    if (token !== panelToken || destroyed || !panelBody) return;
    if (monster === undefined) {
      panelBody.innerHTML = '<p class="it-panel-note">The stat block did not load. Try again.</p>';
      return;
    }
    if (!monster) {
      panelBody.innerHTML = '<p class="it-panel-note">No stat block for this creature.</p>';
      return;
    }
    const titleId = `${panelId}-title`;
    const page = source.pageUrl ? source.pageUrl(monster.id) : '';
    panelBody.innerHTML =
      renderStatBlock(monster, { headingLevel: 2, headingId: titleId }) +
      (page
        ? `<p class="it-panel-page"><a href="${escapeHtml(page)}" target="_blank" rel="noopener">Full page</a></p>`
        : '') +
      `<p class="it-panel-credit">${SRD_CREDIT_HTML}</p>`;
    box.removeAttribute('aria-label');
    box.setAttribute('aria-labelledby', titleId);
  }

  function closePanel(returnFocus: boolean) {
    if (!panel || !panelRowId) return;
    const rowId = panelRowId;
    panelRowId = null;
    panelToken++;
    panel.hidden = true;
    markOpen(rowId, false);
    const btn = infoButton(rowId);
    if (returnFocus && btn && !btn.hidden) btn.focus();
  }

  // ---------- storage ----------
  // Changes are saved a moment after the last one, as on the first tracker: into the open
  // encounter once it has a filled-in row (creating it the first time), and into the last session
  // so a reload carries on where you were. Saves run one after another, so a slow first save
  // cannot create the same encounter twice.
  function scheduleAutosave() {
    if (!storage) return;
    pending = true;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, autosaveDelay);
  }

  function flushAutosave(): Promise<void> {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (!storage || !pending) return saving;
    pending = false;
    const enc = current;
    const snapshot = getState();
    saving = saving.then(() => saveNow(enc, snapshot));
    return saving;
  }

  async function saveNow(enc: OpenEncounter, snapshot: TrackerState) {
    if (enc.id || (!enc.blocked && hasContent(snapshot))) {
      const kept = withoutBlankRows(snapshot);
      const created = !enc.id;
      try {
        try {
          enc.id = await storage.save(enc.id, kept);
        } catch (err) {
          if (!enc.id || !notFound(err)) throw err;
          enc.id = await storage.save(null, kept); // deleted elsewhere: keep it as a new one
        }
        enc.blocked = false;
        if (!destroyed) clearProblem();
        if (created || !savedList.hidden) await refreshSaved();
      } catch (err) {
        const e = err as { code?: string };
        if (!enc.id && e && e.code === 'LIMIT') enc.blocked = true;
        reportSaveError(err, true);
      }
    }
    // a newer encounter took over: its own saves keep the last session
    if (enc !== current) return;
    try {
      await storage.save(LAST_SESSION_ID, { ...snapshot, encounterId: enc.id || undefined });
      showSaved();
    } catch (err) {
      reportSaveError(err, false);
    }
  }

  function reportSaveError(err: unknown, loud: boolean) {
    const e = err as { code?: string; message?: string };
    if (e && e.code === 'LIMIT') {
      const reason = e.message || 'Storage limit reached';
      if (options.onLimit) options.onLimit(reason);
      if (!destroyed) say(reason, true);
    } else if (loud && !destroyed) {
      say((e && e.message) || 'Could not save', true);
    }
  }

  // Shows another encounter (opened, or a new one) after the open one has been saved.
  function switchTo(enc: OpenEncounter, next: TrackerState) {
    current = enc;
    clearProblem();
    commit(next);
    renderRows();
    renderSaved();
  }

  async function openSaved(id: string) {
    closeList();
    if (!storage) return;
    await flushAutosave();
    let loaded: TrackerState | null = null;
    try {
      loaded = await storage.load(id);
    } catch {
      loaded = null;
    }
    if (destroyed) return;
    if (!loaded) {
      say('That encounter could not be opened', true);
      return;
    }
    const next = migrate(loaded);
    delete next.encounterId;
    switchTo({ id, blocked: false }, next);
    if (options.onLoad) options.onLoad(getState());
    say(`Opened ${state.name}`);
  }

  async function newEncounter() {
    closeList();
    await flushAutosave();
    if (destroyed) return;
    switchTo({ id: null, blocked: false }, createState());
    say('Started a new encounter');
    const first = rowsEl.querySelector('[data-field="name"]') as HTMLInputElement | null;
    if (first) first.focus();
  }

  async function deleteSaved(id: string) {
    if (!storage) return;
    try {
      await storage.remove(id);
      // the open encounter stays on screen and is saved again as a new one if it changes
      if (id === current.id) current.id = null;
      current.blocked = false;
      say('Deleted the saved encounter');
    } catch {
      say('Could not delete that encounter', true);
    }
    await refreshSaved();
    const first = savedList.querySelector('button') as HTMLButtonElement | null;
    (first || folderButton).focus();
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
    const clicked = (target as HTMLElement).dataset && (target as HTMLElement).dataset.field;
    if (clicked === 'initiative' || clicked === 'hp') {
      openPop(target.closest(POP_CELLS) as HTMLElement);
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
          // empty rows are left empty
          rows: state.rows.map((r) =>
            isBlankRow(r) ? r : { ...r, initiative: rollInitiative(r.initiativeBonus, rng) },
          ),
        });
        renderRows();
        say('Rolled initiative for everyone');
        break;
      case 'roll-hp': {
        const row = id && state.rows.find((r) => r.id === id);
        const hitDice = row ? hitDiceOf(row) : '';
        if (!hitDice) break;
        const hp = rollHitDice(hitDice, rng);
        commit(updateRow(state, id, { hp, maxHp: hp }));
        const next = state.rows.find((r) => r.id === id);
        syncInputs(rowEl(id), next);
        edited(id);
        say(`${labelOf(next, state.rows.indexOf(next))}: rolled ${hp} HP`);
        break;
      }
      case 'roll':
        if (id) {
          const row = state.rows.find((r) => r.id === id);
          commit(updateRow(state, id, { initiative: rollInitiative(row.initiativeBonus, rng) }));
          renderRows();
        }
        break;
      case 'hp-down':
      case 'hp-up':
        if (id) stepHp(btn, id, action === 'hp-up' ? 1 : -1);
        break;
      case 'init-down':
      case 'init-up':
        if (id) stepInit(btn, id, action === 'init-up' ? 1 : -1);
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
      case 'info': {
        const row = state.rows.find((r) => r.id === id);
        if (row && hasStatBlock(row.monsterId)) {
          if (panelRowId === row.id) closePanel(true);
          else void openPanel(row);
        }
        break;
      }
      case 'link': {
        const row = state.rows.find((r) => r.id === id);
        if (row && options.onLinkClick) options.onLinkClick({ ...row });
        break;
      }
      case 'saved':
        if (savedList.hidden) openList();
        else closeList();
        break;
      case 'open':
        void openSaved(btn.dataset.id);
        break;
      case 'new':
        void newEncounter();
        break;
      case 'delete': {
        const delId = btn.dataset.id;
        confirmFirst(btn, 'delete:' + delId, 'Delete?', () => void deleteSaved(delId));
        break;
      }
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
    } else if (field === 'ac') {
      commit(updateRow(state, id, { ac: Math.max(0, intOr(input.value, 0)) }));
      edited(id);
    } else if (field === 'maxhp') {
      commit(updateRow(state, id, { maxHp: Math.max(0, intOr(input.value, 0)) }));
      refreshDown(
        rowEl(id),
        state.rows.find((r) => r.id === id),
      );
      edited(id);
    }
  }

  // The HP field is committed on change (blur or Enter) so "-5" is not applied per keystroke.
  function onChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.dataset || input.dataset.field !== 'hp') return;
    const id = rowIdOf(input);
    const row = state.rows.find((r) => r.id === id);
    if (!row) return;
    const result = applyHpInput(input.value, row.hp, row.maxHp);
    commit(updateRow(state, id, { hp: result.hp, maxHp: result.maxHp }));
    const next = state.rows.find((r) => r.id === id);
    syncInputs(rowEl(id), next);
    edited(id);
  }

  function onKeydown(e: KeyboardEvent) {
    if (onGripKey(e)) return;
    const input = e.target as HTMLInputElement;
    if (e.key === 'Escape' && !savedList.hidden) {
      e.preventDefault();
      closeList();
      folderButton.focus();
      return;
    }
    if (e.key === 'Escape' && popOpen && popOpen.contains(input)) {
      e.preventDefault();
      const inPop = !!input.closest('.it-hp-pop');
      const fieldName = popOpen.classList.contains('it-c-hp') ? 'hp' : 'initiative';
      const cell = popOpen;
      closePop();
      // the box's controls are hidden now, so focus goes back to the cell's own field
      if (inPop) (cell.querySelector(`[data-field="${fieldName}"]`) as HTMLElement).focus();
      return;
    }
    if (e.key === 'Escape' && panelRowId && !(suggest && input === suggest.input)) {
      e.preventDefault();
      closePanel(true);
      return;
    }
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

  function onFocusOut(e: FocusEvent) {
    const input = e.target as HTMLInputElement;
    if (suggest && input === suggest.input) closeSuggest();
    // relatedTarget is null when focus just drops (a tap on a phone): the pointer handler decides
    const to = e.relatedTarget as Node | null;
    if (popOpen && to && !popOpen.contains(to)) closePop();
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
    ['focusin', onFocusIn as EventListener],
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
    void flushAutosave();
  };
  if (view) view.addEventListener('pagehide', onPageHide);
  doc.addEventListener('pointerdown', onDocPointerDown, true);

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
          if (state.encounterId) current = { id: state.encounterId, blocked: false };
          delete state.encounterId;
          renderRows();
          if (options.onLoad) options.onLoad(getState());
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
      delete state.encounterId;
      dirty = true;
      renderRows();
      scheduleAutosave();
    },
    linkRow(link: string, fields: Partial<TrackerRow> = {}) {
      state = linkRow(state, link, fields);
      dirty = true;
      renderRows();
      scheduleAutosave();
      return { ...state.rows.find((r) => r.link === link) };
    },
    updateLinked(link: string, patch: Partial<TrackerRow>) {
      const rows = state.rows.filter((r) => r.link === link);
      const changes = (r: TrackerRow) =>
        Object.keys(patch).some((key) => r[key as keyof TrackerRow] !== patch[key]);
      if (!rows.some(changes)) return;
      rows.forEach((r) => {
        state = updateRow(state, r.id, patch);
      });
      dirty = true;
      renderRows();
      scheduleAutosave();
    },
    destroy() {
      if (destroyed) return;
      void flushAutosave();
      destroyed = true;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      armTimers.forEach((t) => clearTimeout(t));
      if (savedNoteTimer) clearTimeout(savedNoteTimer);
      armTimers.clear();
      listeners.forEach(([type, fn]) => root.removeEventListener(type, fn));
      if (view) view.removeEventListener('pagehide', onPageHide);
      doc.removeEventListener('pointerdown', onDocPointerDown, true);
      root.remove();
      if (panel) panel.remove();
      releaseStyles(doc);
    },
  };
}
