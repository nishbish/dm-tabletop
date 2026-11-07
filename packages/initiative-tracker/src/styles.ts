// One stylesheet for the whole widget. Every class starts with `it-` and every rule is scoped
// to `.it-root`, so it cannot leak into the host page.
//
// Theming: every colour, the font, the corner cut, the shadow and the control height come from
// a CSS custom property named `--it-*` (listed in `themeVariables`, documented in the README). The
// host sets them on `:root`, on a wrapper or on `.it-root` itself; anything it leaves unset falls
// back to the built-in defaults below (a light and a dark set; the dark one follows
// `prefers-color-scheme`). The widget never reads the host's own variables.
//
// Corners are cut (chamfered, like the edge of a die) with `clip-path`, never rounded; the default
// cut is 0, which gives square corners. Buttons draw their border as a second, smaller cut shape
// so the border follows the cut.
export const STYLE_ID = 'it-styles';

export interface ThemeVariable {
  name: string;
  light: string;
  dark: string;
  description: string;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// The public theme variables with their built-in values. The README table is checked against
// this list by a test.
export const themeVariables: ThemeVariable[] = [
  { name: 'bg', light: '#f4f1e4', dark: '#0e2a24', description: 'Background of the whole widget' },
  { name: 'fg', light: '#16261f', dark: '#eef0e2', description: 'Main text on the background' },
  { name: 'muted', light: '#4d5b52', dark: '#b6c4b9', description: 'Secondary text and labels' },
  {
    name: 'border-strong',
    light: '#5f6f63',
    dark: '#8fae9f',
    description: 'Borders of fields and buttons',
  },
  { name: 'surface', light: '#e7e5d2', dark: '#17382f', description: 'Buttons and raised parts' },
  { name: 'input-bg', light: '#ffffff', dark: '#0a211c', description: 'Fill of text fields' },
  {
    name: 'rule',
    light: '#c9c9ad',
    dark: '#dbdbc7',
    description:
      'The panel behind the creature list, which shows as the lines between the cells (a gradient works too)',
  },
  {
    name: 'head-bg',
    light: '#244e44',
    dark: '#2b5a4e',
    description: 'Background of the column headings',
  },
  {
    name: 'head-fg',
    light: '#f4f1e4',
    dark: '#f4f1e4',
    description: 'Text of the column headings',
  },
  { name: 'row-bg', light: '#244e44', dark: '#1c4137', description: 'Fill of a creature row' },
  { name: 'row-fg', light: '#f4f1e4', dark: '#eef0e2', description: 'Text in a creature row' },
  {
    name: 'active-bg',
    light: '#2f7a5e',
    dark: '#2f7a5e',
    description: 'Fill of the row whose turn it is',
  },
  {
    name: 'down-bg',
    light: '#7a3535',
    dark: '#773636',
    description: 'Fill of a row whose creature is down (0 hit points)',
  },
  { name: 'accent', light: '#1d6a4c', dark: '#9be3b4', description: 'Primary buttons and markers' },
  {
    name: 'accent-fg',
    light: '#ffffff',
    dark: '#07241a',
    description: 'Text and icons on the accent colour',
  },
  { name: 'focus', light: '#a35200', dark: '#ffc566', description: 'Keyboard focus ring' },
  { name: 'danger', light: '#a4161a', dark: '#ff9a9d', description: 'Clear and Delete buttons' },
  {
    name: 'cut',
    light: '0px',
    dark: '0px',
    description:
      'Size of the cut corners of the widget, the creature list, buttons and fields (0 = square)',
  },
  { name: 'font', light: FONT, dark: FONT, description: 'Font family' },
  { name: 'weight', light: '500', dark: '500', description: 'Normal font weight' },
  {
    name: 'weight-strong',
    light: '700',
    dark: '700',
    description: 'Bold font weight (buttons, headings, the round number)',
  },
  {
    name: 'shadow',
    light: '0 2px 10px rgba(0, 0, 0, 0.12)',
    dark: '0 2px 12px rgba(0, 0, 0, 0.45)',
    description: 'Shadow of the suggestion list and of a row being dragged',
  },
  {
    name: 'control-height',
    light: '44px',
    dark: '44px',
    description: 'Minimum height of buttons and fields (touch target)',
  },
  { name: 'pad', light: '14px', dark: '14px', description: 'Padding inside the widget' },
];

// `--_x` are private working copies: `--_x: var(--it-x, <built-in value>)`. Reading the public
// variable here (not in the rules) lets a host set it anywhere above the widget.
function workingCopies(mode: 'light' | 'dark'): string {
  return themeVariables.map((v) => `--_${v.name}: var(--it-${v.name}, ${v[mode]});`).join(' ');
}

// clip-path polygon with the corners cut by `c`
const poly = (c: string) =>
  `polygon(${c} 0, calc(100% - ${c}) 0, 100% ${c}, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, ${c} 100%, 0 calc(100% - ${c}), 0 ${c})`;
const CUT = poly('var(--_cut)');
// the inner shape of a 2px border is cut a little less, so the border keeps its width on the slant
const CUT_INNER = poly('max(0px, calc(var(--_cut) - 0.83px))');
// one stripe per corner, exactly inside the cut (the corner order of background-position above)
const slant = (dir: string) =>
  `linear-gradient(to ${dir}, transparent 50%, var(--_border-strong) 50%, var(--_border-strong) calc(50% + 1px), transparent calc(50% + 1px))`;
const SLANTS = ['bottom right', 'bottom left', 'top left', 'top right'].map(slant).join(', ');
// A corner cut of one cell sitting inside a cut panel: the panel's cut, made smaller so the
// line of panel colour along the slant is as thick as along the straight sides (inset 2px).
const CELL_CUT = 'max(0px, calc(var(--_cut) - 1.17px))';
const CELL_CUT_NARROW = 'max(0px, calc(var(--_cut) - 3.51px))'; // inset 6px (narrow layout)
const cutCorner = (corner: string, c: string) =>
  ({
    'top left': `polygon(${c} 0, 100% 0, 100% 100%, 0 100%, 0 ${c})`,
    'top right': `polygon(0 0, calc(100% - ${c}) 0, 100% ${c}, 100% 100%, 0 100%)`,
    'bottom right': `polygon(0 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%)`,
    'bottom left': `polygon(0 0, 100% 0, 100% 100%, ${c} 100%, 0 calc(100% - ${c}))`,
  })[corner];
const OCTAGON = 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)';
const HEXAGON = 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)';

export const css: string = `
.it-root { ${workingCopies('light')} }
@media (prefers-color-scheme: dark) {
  .it-root { ${workingCopies('dark')} }
}
.it-root {
  box-sizing: border-box; max-width: 100%; min-width: 0; padding: var(--_pad); container: it / inline-size;
  position: relative; isolation: isolate; color: var(--_fg);
  font: var(--_weight) 16px/1.4 var(--_font);
}
/* The widget's background and the creature list's panel are cut shapes drawn behind the content
   (not clip-path on the boxes themselves), so the suggestion list and the - / + boxes can still
   hang out past the last row. */
.it-root::before, .it-table::before { content: ''; position: absolute; inset: 0; z-index: -1; clip-path: ${CUT}; }
.it-root::before { background: var(--_bg); }
.it-root [hidden] { display: none !important; }
.it-root *, .it-root *::before, .it-root *::after { box-sizing: border-box; }
.it-root :focus-visible { outline: 3px solid var(--_focus); outline-offset: 2px; }
.it-root .it-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
/* the border is clipped off at the cut corners, so each slant gets a 1px stripe in the background */
.it-root input, .it-root select {
  font: inherit; color: var(--_fg); min-width: 0;
  background-color: var(--_input-bg);
  background-image: ${SLANTS};
  background-origin: border-box; background-clip: border-box; background-repeat: no-repeat;
  background-size: var(--_cut) var(--_cut);
  background-position: top left, top right, bottom right, bottom left;
  border: 1px solid var(--_border-strong); border-radius: 0; padding: 6px 10px; min-height: var(--_control-height);
  clip-path: ${CUT};
}

/* buttons: the border is a second, smaller cut shape inside the first */
.it-root button {
  --edge: var(--_border-strong); --fill: var(--_surface); --ink: var(--_fg);
  position: relative; isolation: isolate; margin: 0; padding: 6px 18px; min-height: var(--_control-height);
  font: inherit; font-weight: var(--_weight-strong); letter-spacing: 0.01em; color: var(--ink);
  background: var(--edge); border: 0; border-radius: 0; cursor: pointer; clip-path: ${CUT};
}
.it-root button::before {
  content: ''; position: absolute; inset: 2px; z-index: -1; background: var(--fill); clip-path: ${CUT_INNER};
}
.it-root button:hover:not(:disabled) { --edge: var(--_accent); }
.it-root button:active:not(:disabled) { transform: translateY(1px); }
.it-root button:disabled { opacity: 0.45; cursor: default; }
.it-root button.it-primary { --edge: var(--_accent); --fill: var(--_accent); --ink: var(--_accent-fg); }
.it-root button.it-danger { --edge: var(--_danger); --fill: var(--_bg); --ink: var(--_danger); }
.it-root button.it-danger:hover:not(:disabled) { --fill: var(--_surface); }
.it-root button.it-armed { --edge: var(--_danger); --fill: var(--_danger); --ink: var(--_bg); }

.it-header { position: relative; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 12px; }
/* the name reads as the encounter's title, the size of the column headings, with no line or
   box; a faint fill on hover and while typing shows it is a field */
.it-root input.it-enc-name {
  font-size: 1.15rem; font-weight: var(--_weight-strong); width: 18rem; max-width: 100%;
  background: transparent; border-color: transparent; padding-inline: 8px; clip-path: none;
  margin-left: -8px; /* the text lines up with the list; the hover fill reaches out past it */
}
@supports (field-sizing: content) {
  .it-root input.it-enc-name { width: auto; min-width: 8ch; field-sizing: content; }
}
.it-root input.it-enc-name:hover, .it-root input.it-enc-name:focus { background: rgba(127, 127, 127, 0.12); }
.it-root input.it-enc-name:focus { outline: none; }
.it-root button.it-folder, .it-root button.it-new { width: 2.25rem; }
.it-root button.it-folder svg { display: block; margin: auto; }
.it-root button.it-new { font-size: 1.7rem; font-weight: var(--_weight); line-height: 1; }
.it-message:not(.it-sr) { margin: 0 0 0 10px; color: var(--_danger); font-weight: var(--_weight-strong); }

/* the saved encounters, under the folder button: a name to open, a cross to delete */
.it-saved {
  position: absolute; z-index: 20; top: 100%; left: 0; margin-top: 4px; width: 26rem; max-width: 100%;
  max-height: 22rem; overflow-y: auto; padding: 8px; background: var(--_bg); color: var(--_fg);
  border: 1px solid var(--_border-strong); box-shadow: var(--_shadow);
}
.it-saved ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.it-saved li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; }
.it-root button.it-saved-open {
  --edge: var(--_row-bg); --fill: var(--_row-bg); --ink: var(--_row-fg);
  text-align: left; font-weight: var(--_weight); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.it-root button.it-saved-open:hover:not(:disabled) { --edge: var(--_active-bg); --fill: var(--_active-bg); }
.it-root button.it-saved-open[aria-current='true'] { --edge: var(--_active-bg); }
.it-root button.it-saved-delete { --edge: var(--_danger); --fill: var(--_danger); --ink: var(--_bg); min-width: var(--_control-height); padding: 0 10px; }
.it-root button.it-saved-delete:hover:not(:disabled) { --edge: var(--_danger); filter: brightness(1.12); }
.it-saved-empty { margin: 4px; color: var(--_muted); }

/* the creature list: a cream panel with dark cells, as on the first tracker */
.it-table { position: relative; margin-top: 4px; padding: 2px 2px 0; }
.it-table::before { background: var(--_rule); }
/* the gap under the last row stays inside the list (it would otherwise collapse out of it and
   leave the bottom edge without a line) */
.it-rows { display: flow-root; }
/* the four corner cells are cut too, so the panel colour runs along the slants */
.it-head > .it-th:first-child { clip-path: ${cutCorner('top left', CELL_CUT)}; }
.it-head > .it-th:last-child { clip-path: ${cutCorner('top right', CELL_CUT)}; }
.it-rows > .it-row:last-child > .it-td:first-child { clip-path: ${cutCorner('bottom left', CELL_CUT)}; }
.it-rows > .it-row:last-child > .it-td:last-child { clip-path: ${cutCorner('bottom right', CELL_CUT)}; }
.it-head, .it-row {
  display: grid; align-items: stretch; gap: 3px; margin: 0 0 2px;
  grid-template-columns: minmax(10.5rem, 13.5rem) minmax(0, 1fr) 8.5rem 4.5rem 2.75rem;
}
.it-th {
  padding: 6px 12px; background: var(--_head-bg); color: var(--_head-fg);
  font-size: 1.15rem; font-weight: var(--_weight);
}
.it-td { position: relative; display: flex; align-items: center; min-width: 0; background: var(--_row-bg); color: var(--_row-fg); min-height: 3.25rem; }
.it-row--active .it-td { background: var(--_active-bg); }
.it-row--down .it-td { background: var(--_down-bg); }
.it-row--active.it-row--down .it-td { background: var(--_down-bg); }
/* the bar on the active row is a background stripe, not an inset shadow, so a cut corner cell
   (the first row's initiative on a phone, the last row's on a wide screen) cuts it cleanly */
.it-row--active .it-c-init { background: linear-gradient(var(--_accent), var(--_accent)) left / 4px 100% no-repeat, var(--_active-bg); }
.it-row--active.it-row--down .it-c-init { background: linear-gradient(var(--_accent), var(--_accent)) left / 4px 100% no-repeat, var(--_down-bg); }
.it-td input {
  width: 100%; height: 100%; min-height: 3.25rem; padding: 0 10px; color: inherit; background: transparent;
  border: 0; clip-path: none; font-size: 1.1rem;
}
/* a field in use shows no outline, only a slightly lighter fill */
.it-root .it-td input:focus, .it-root .it-td input:focus-visible { outline: none; background: rgba(255, 255, 255, 0.06); }
.it-td input::placeholder { color: inherit; opacity: 0.6; }
.it-td input[type='number'] { -moz-appearance: textfield; appearance: textfield; text-align: left; }
.it-td input::-webkit-outer-spin-button, .it-td input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.it-row--dragging .it-td { box-shadow: var(--_shadow); }

.it-root button.it-grip {
  --edge: transparent; --fill: transparent; --ink: var(--_row-fg);
  flex: none; align-self: stretch; width: 2rem; min-height: 3.25rem; padding: 0; cursor: grab; touch-action: none; user-select: none; font-size: 1rem; clip-path: none;
}
.it-root button.it-grip::before { display: none; }
.it-root button.it-grip:hover:not(:disabled) { --edge: transparent; opacity: 0.75; }
.it-th.it-c-init { padding-left: calc(2rem + 4px); }
/* the number fills the cell after the handle; the bonus and the d20 sit over its right end */
.it-c-init .it-init { flex: 1 1 auto; width: auto; padding-left: 4px; padding-right: 5.5rem; }
.it-mod {
  position: absolute; right: 3.2rem; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 0.85rem; opacity: 0.85; white-space: nowrap; font-variant-numeric: tabular-nums;
}

/* the d20 button inside the initiative cell: only there while the pointer is over the cell, or
   while the cell is in use (focused or tapped), as on the first tracker */
.it-root button.it-d20 {
  --edge: transparent; --fill: var(--_accent); --ink: var(--_accent-fg);
  position: absolute; right: 6px; top: calc(50% - 1.25rem);
  width: 2.5rem; min-height: 2.5rem; height: 2.5rem; padding: 0; font-size: 0.72rem; background: transparent; clip-path: none;
  opacity: 0; pointer-events: none; transition: opacity 0.2s ease-in-out;
}
.it-c-init--open button.it-d20 { opacity: 1; pointer-events: auto; }
@media (hover: hover) {
  .it-c-init:hover button.it-d20 { opacity: 1; pointer-events: auto; }
}
.it-root button.it-d20::before { inset: 3px; clip-path: ${HEXAGON}; background: var(--_accent); }
.it-root button.it-d20:hover:not(:disabled) { --edge: transparent; filter: brightness(1.15); }

.it-marker {
  position: absolute; z-index: 1; left: 0; top: 0; bottom: 0; width: 1.6rem; pointer-events: none;
  display: flex; align-items: center; justify-content: center; color: var(--_accent); font-size: 0.8rem;
}
.it-row--active .it-marker { color: var(--_row-fg); }
.it-td .it-name { padding-left: 1.6rem; }
.it-name-wrap { position: relative; flex: 1 1 auto; min-width: 0; align-self: stretch; }
.it-root button.it-link { --edge: transparent; --fill: transparent; --ink: var(--_row-fg); flex: none; width: 1.75rem; min-height: 2rem; padding: 0; clip-path: none; opacity: 0.8; }
.it-root button.it-link::before { display: none; }
.it-root button.it-link:hover:not(:disabled) { --edge: transparent; opacity: 1; --ink: var(--_row-fg); }
.it-name { min-width: 0; }
.it-c-hp { gap: 0; }
.it-c-hp .it-hp { flex: 1 1 auto; width: auto; }
.it-c-hp .it-maxhp { flex: none; width: 3.4rem; padding-left: 1rem; padding-right: 6px; opacity: 0.8; font-size: 0.9rem; }
.it-slash { position: absolute; right: 2.75rem; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.6; font-size: 0.9rem; }
/* an empty row shows empty cells: no lone / until something is typed or the cell is in use */
.it-c-hp:not(:focus-within):not(:hover):has(.it-hp:placeholder-shown):has(.it-maxhp:placeholder-shown) .it-slash { visibility: hidden; }
/* a corner cell drops its cut while its - / + box is open, or the box would be clipped */
.it-root .it-table .it-rows > .it-row > .it-td.it-c-init--open,
.it-root .it-table .it-rows > .it-row > .it-td.it-c-hp--open { clip-path: none; }
/* the - / + box under the HP field: an amount between two buttons, over the row below */
.it-hp-pop {
  display: none; position: absolute; z-index: 10; left: 0; top: 100%; margin-top: 2px; padding: 6px; gap: 6px;
  align-items: center; background: var(--_bg); color: var(--_fg);
  border: 1px solid var(--_border-strong); box-shadow: var(--_shadow);
}
.it-c-hp--open .it-hp-pop, .it-c-init--open .it-hp-pop { display: flex; }
.it-root button.it-hp-step { width: var(--_control-height); padding: 0; font-size: 1.3rem; line-height: 1; }
/* a normal boxed field again (the cell inputs above are bare) */
.it-td .it-hp-pop .it-hp-amount {
  width: 4rem; height: auto; min-height: var(--_control-height); padding: 6px 4px; text-align: center; font-size: 1rem;
  color: var(--_fg); background-color: var(--_input-bg); background-image: ${SLANTS};
  background-origin: border-box; background-clip: border-box; background-repeat: no-repeat;
  background-size: var(--_cut) var(--_cut); background-position: top left, top right, bottom right, bottom left;
  border: 1px solid var(--_border-strong); clip-path: ${CUT};
}
.it-td .it-hp-pop .it-hp-amount:focus-visible { outline-offset: -4px; }
.it-down { position: absolute; right: 4px; top: 2px; font-weight: var(--_weight-strong); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; }
.it-suggest {
  position: absolute; z-index: 10; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 4px 0;
  list-style: none; max-height: 16rem; overflow-y: auto; background: var(--_input-bg); color: var(--_fg);
  border: 1px solid var(--_border-strong); box-shadow: var(--_shadow); min-width: 14rem;
}
.it-suggest li { padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; gap: 12px; }
.it-suggest li small { color: var(--_muted); }
.it-suggest li[aria-selected='true'] { background: var(--_accent); color: var(--_accent-fg); }
.it-suggest li[aria-selected='true'] small { color: inherit; }
/* remove: a minus in a thin ring, faint until the pointer is on the row (or it has focus) */
.it-root button.it-x { --edge: transparent; --fill: transparent; --ink: var(--_row-fg); width: 100%; min-height: 3.25rem; padding: 0; clip-path: none; opacity: 0.5; transition: opacity 0.15s ease-in-out; }
.it-root button.it-x::before { display: none; }
.it-row:hover button.it-x, .it-root button.it-x:focus-visible { opacity: 0.85; }
.it-root button.it-x:hover:not(:disabled) { --edge: transparent; opacity: 1; --ink: var(--_row-fg); }
.it-x-mark {
  display: inline-flex; align-items: center; justify-content: center; width: 1.35rem; height: 1.35rem;
  border: 1.5px solid currentColor; border-radius: 50%; font-size: 1rem; line-height: 1;
}
@media (hover: none) {
  .it-root button.it-x { opacity: 0.85; } /* no hover on a touch screen: always plain to see */
}

/* Next, Sort and Clear under the list; the round and the big add button on the right */
.it-toolbar { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; justify-content: space-between; margin: 16px 0 4px; }
.it-tools-left, .it-tools-right { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.it-round { display: flex; align-items: center; gap: 4px; font-size: 1.5rem; color: var(--_fg); }
.it-round-num { font-weight: var(--_weight-strong); font-variant-numeric: tabular-nums; min-width: 1ch; }
.it-root button.it-icon { --edge: transparent; --fill: transparent; width: var(--_control-height); padding: 0; font-size: 1.5rem; clip-path: none; }
.it-root button.it-icon::before { display: none; }
/* the icon buttons (folder, new encounter, reset round) get the same faint fill on hover as the
   encounter name, not the accent fill of the other buttons, which hid the icon */
.it-root button.it-icon:hover:not(:disabled) { --edge: rgba(127, 127, 127, 0.14); }
.it-root button.it-add {
  --edge: var(--_accent); --fill: var(--_accent); --ink: var(--_accent-fg);
  width: 3.75rem; height: 3.75rem; min-height: 3.75rem; padding: 0; font-size: 2.2rem; line-height: 1; clip-path: ${OCTAGON};
}
.it-root button.it-add::before { display: none; }
.it-root button.it-add:hover:not(:disabled) { filter: brightness(1.12); }


/* dragging: the row follows the pointer, the others slide aside */
.it-rows--dragging { user-select: none; }
.it-row--dragging { position: relative; z-index: 5; }
.it-row--dragging, .it-row--shifted { will-change: transform; }
.it-row--shifted, .it-row--settling { transition: transform 0.15s ease; }

@media (prefers-reduced-motion: reduce) {
  .it-root button:active:not(:disabled) { transform: none; }
  .it-root button.it-d20 { transition: none; }
  .it-row--shifted, .it-row--settling { transition: none; }
}
/* the narrow layout follows the tracker's own width, so it also fits a side panel on a wide screen */
@media (max-width: 720px) {
  .it-root { padding: calc(var(--_pad) * 0.7); }
}
@container it (max-width: 720px) {
  .it-head { display: none; }
  .it-table { padding: 6px; }
  .it-rows > .it-row:last-child { margin-bottom: 0; }
  .it-rows > .it-row:last-child > .it-td:first-child, .it-rows > .it-row:last-child > .it-td:last-child { clip-path: none; }
  .it-rows > .it-row:first-child > .it-c-init { clip-path: ${cutCorner('top left', CELL_CUT_NARROW)}; }
  .it-rows > .it-row:first-child > .it-c-remove { clip-path: ${cutCorner('top right', CELL_CUT_NARROW)}; }
  .it-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 2.75rem;
    grid-template-areas: 'init init remove' 'name name name' 'hp ac ac';
    margin-bottom: 8px;
  }
  .it-row .it-c-init { grid-area: init; }
  .it-row .it-c-remove { grid-area: remove; }
  .it-row .it-c-name { grid-area: name; }
  .it-row .it-c-hp { grid-area: hp; }
  .it-row .it-c-ac { grid-area: ac; }
  .it-td[data-label]:not(.it-c-name):not(.it-c-init)::before {
    content: attr(data-label); position: absolute; left: 10px; top: 2px; font-size: 0.65rem; opacity: 0.7;
  }
  .it-c-hp, .it-c-ac { padding-top: 10px; }
  .it-c-hp .it-slash { top: calc(50% + 5px); } /* the fields sit 10px lower, under their label */
  .it-c-hp .it-hp { padding-left: 10px; }
  .it-c-ac input { padding-left: 10px; }
  .it-tools-left { flex: 1 1 100%; }
  .it-tools-left button { flex: 1 1 0; padding-inline: 8px; }
  .it-tools-right { flex: 1 1 100%; justify-content: space-between; }
}
`;
