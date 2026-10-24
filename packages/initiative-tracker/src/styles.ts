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
      'The panel behind the creature list: shows between the cells and under the headings',
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
    description: 'Size of the cut corners of buttons, fields and rows (0 = square corners)',
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
const OCTAGON = 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)';
const HEXAGON = 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)';

export const css: string = `
.it-root { ${workingCopies('light')} }
@media (prefers-color-scheme: dark) {
  .it-root { ${workingCopies('dark')} }
}
.it-root {
  box-sizing: border-box; max-width: 100%; min-width: 0; padding: var(--_pad);
  background: var(--_bg); color: var(--_fg);
  font: var(--_weight) 16px/1.4 var(--_font);
}
.it-root [hidden] { display: none !important; }
.it-root *, .it-root *::before, .it-root *::after { box-sizing: border-box; }
.it-root :focus-visible { outline: 3px solid var(--_focus); outline-offset: 2px; }
.it-root .it-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.it-root input, .it-root select {
  font: inherit; color: var(--_fg); background: var(--_input-bg); min-width: 0;
  border: 1px solid var(--_border-strong); padding: 6px 10px; min-height: var(--_control-height);
  clip-path: ${CUT};
}

/* buttons: the border is a second, smaller cut shape inside the first */
.it-root button {
  --edge: var(--_border-strong); --fill: var(--_surface); --ink: var(--_fg);
  position: relative; isolation: isolate; margin: 0; padding: 6px 18px; min-height: var(--_control-height);
  font: inherit; font-weight: var(--_weight-strong); letter-spacing: 0.01em; color: var(--ink);
  background: var(--edge); border: 0; cursor: pointer; clip-path: ${CUT};
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

.it-header { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; justify-content: space-between; }
.it-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.it-field > span, .it-root .it-label { font-size: 0.8rem; color: var(--_muted); }
.it-enc-name {
  font-size: 1.3rem; font-weight: var(--_weight-strong); min-width: 14rem; max-width: 100%;
  background: transparent !important; border-color: transparent !important; border-bottom-color: var(--_border-strong) !important;
}
.it-turn { margin: 8px 0; font-weight: var(--_weight-strong); min-height: 1.4em; }

/* the creature list: a cream panel with dark cells, as on the first tracker */
.it-table { background: var(--_rule); padding-bottom: 8px; margin-top: 4px; }
.it-head, .it-row {
  display: grid; align-items: stretch; gap: 3px; margin: 0 0 2px;
  grid-template-columns: 2.25rem minmax(8.5rem, 11.5rem) minmax(0, 1fr) 8.5rem 4.5rem 2.75rem;
}
.it-th {
  padding: 6px 12px; background: var(--_head-bg); color: var(--_head-fg);
  font-size: 1.15rem; font-weight: var(--_weight);
}
.it-td { position: relative; display: flex; align-items: center; min-width: 0; background: var(--_row-bg); color: var(--_row-fg); min-height: 3.25rem; }
.it-row--active .it-td { background: var(--_active-bg); }
.it-row--down .it-td { background: var(--_down-bg); }
.it-row--active.it-row--down .it-td { background: var(--_down-bg); box-shadow: inset 0 0 0 2px var(--_row-fg); }
.it-row--active .it-c-grip { box-shadow: inset 4px 0 0 var(--_accent); }
.it-td input {
  width: 100%; height: 100%; min-height: 3.25rem; padding: 0 10px; color: inherit; background: transparent;
  border: 0; clip-path: none; font-size: 1.1rem;
}
.it-td input:focus-visible { outline-offset: -3px; background: rgba(255, 255, 255, 0.08); }
.it-td input::placeholder { color: inherit; opacity: 0.6; }
.it-td input[type='number'] { -moz-appearance: textfield; appearance: textfield; text-align: left; }
.it-td input::-webkit-outer-spin-button, .it-td input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.it-row--dragging .it-td { box-shadow: var(--_shadow); }

.it-c-grip { justify-content: center; }
.it-root button.it-grip {
  --edge: transparent; --fill: transparent; --ink: var(--_row-fg);
  min-height: 3.25rem; width: 100%; padding: 0; cursor: grab; touch-action: none; user-select: none; font-size: 1rem; clip-path: none;
}
.it-root button.it-grip::before { display: none; }
.it-root button.it-grip:hover:not(:disabled) { --edge: transparent; opacity: 0.75; }
.it-c-init { gap: 2px; }
.it-c-init .it-init { width: 3.4rem; flex: 0 1 3.4rem; padding-left: 4px; }
.it-mod { display: inline-flex; align-items: baseline; margin-left: auto; padding-right: 8px; font-size: 0.85rem; color: inherit; opacity: 0.85; }
.it-td .it-bonus { width: 2.6rem; padding: 0 2px; font-size: 0.85rem; min-height: 2rem; height: 2rem; }

/* the d20 button inside the initiative cell */
.it-root button.it-d20 {
  --edge: transparent; --fill: var(--_accent); --ink: var(--_accent-fg);
  flex: none; width: 2.5rem; min-height: 2.5rem; height: 2.5rem; padding: 0; margin-left: 6px; font-size: 0.72rem; background: transparent; clip-path: none;
}
.it-root button.it-d20::before { inset: 3px; clip-path: ${HEXAGON}; background: var(--_accent); }
.it-root button.it-d20:hover:not(:disabled) { --edge: transparent; filter: brightness(1.15); }

.it-marker { display: inline-flex; align-items: center; justify-content: center; width: 1.4rem; flex: none; color: var(--_accent); font-size: 0.8rem; }
.it-row--active .it-marker { color: var(--_row-fg); }
.it-c-name { padding-left: 4px; }
.it-name-wrap { position: relative; flex: 1 1 auto; min-width: 0; align-self: stretch; }
.it-name { min-width: 0; }
.it-c-hp { gap: 0; }
.it-c-hp .it-hp { width: 3.4rem; flex: 0 1 3.4rem; }
.it-c-hp .it-maxhp { width: 3.2rem; flex: 0 1 3.2rem; padding-left: 2px; opacity: 0.8; font-size: 0.95rem; }
.it-slash { opacity: 0.6; }
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
.it-root button.it-x { --edge: transparent; --fill: transparent; --ink: var(--_row-fg); width: 100%; min-height: 3.25rem; padding: 0; font-size: 1rem; clip-path: none; opacity: 0.8; }
.it-root button.it-x::before { display: none; }
.it-root button.it-x:hover:not(:disabled) { --edge: transparent; opacity: 1; --ink: var(--_row-fg); }
.it-empty { color: var(--_muted); margin: 12px 0; }

/* Next, Sort and Clear under the list; the round and the big add button on the right */
.it-toolbar { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; justify-content: space-between; margin: 16px 0 4px; }
.it-tools-left, .it-tools-right { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.it-round { display: flex; align-items: center; gap: 4px; font-size: 1.5rem; color: var(--_fg); }
.it-round-num { font-weight: var(--_weight-strong); font-variant-numeric: tabular-nums; min-width: 1ch; }
.it-root button.it-icon { --edge: transparent; --fill: transparent; width: var(--_control-height); padding: 0; font-size: 1.5rem; clip-path: none; }
.it-root button.it-icon::before { display: none; }
.it-root button.it-add {
  --edge: var(--_accent); --fill: var(--_accent); --ink: var(--_accent-fg);
  width: 3.75rem; height: 3.75rem; min-height: 3.75rem; padding: 0; font-size: 2.2rem; line-height: 1; clip-path: ${OCTAGON};
}
.it-root button.it-add::before { display: none; }
.it-root button.it-add:hover:not(:disabled) { filter: brightness(1.12); }

.it-storage { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--_border-strong); }
.it-storage select { min-width: 12rem; max-width: 100%; }
.it-message { min-height: 1.4em; margin: 8px 0 0; color: var(--_muted); }

/* dragging: the row follows the pointer, the others slide aside */
.it-rows--dragging { user-select: none; }
.it-row--dragging { position: relative; z-index: 5; }
.it-row--dragging, .it-row--shifted { will-change: transform; }
.it-row--shifted, .it-row--settling { transition: transform 0.15s ease; }

@media (prefers-reduced-motion: reduce) {
  .it-root button:active:not(:disabled) { transform: none; }
  .it-row--shifted, .it-row--settling { transition: none; }
}
@media (max-width: 720px) {
  .it-root { padding: calc(var(--_pad) * 0.7); }
  .it-head { display: none; }
  .it-table { padding: 6px; }
  .it-row {
    grid-template-columns: 2.25rem minmax(0, 1fr) minmax(0, 1fr) 2.75rem;
    grid-template-areas: 'grip init init remove' 'name name name name' 'hp hp ac ac';
    margin-bottom: 8px;
  }
  .it-row .it-c-grip { grid-area: grip; }
  .it-row .it-c-init { grid-area: init; }
  .it-row .it-c-remove { grid-area: remove; }
  .it-row .it-c-name { grid-area: name; }
  .it-row .it-c-hp { grid-area: hp; }
  .it-row .it-c-ac { grid-area: ac; }
  .it-td[data-label]:not(.it-c-name):not(.it-c-init)::before {
    content: attr(data-label); position: absolute; left: 10px; top: 2px; font-size: 0.65rem; opacity: 0.7;
  }
  .it-c-hp, .it-c-ac { padding-top: 10px; }
  .it-c-hp .it-hp { padding-left: 10px; }
  .it-c-ac input { padding-left: 10px; }
  .it-enc-name { min-width: 0; width: 100%; }
  .it-field { flex: 1 1 100%; }
  .it-tools-left { flex: 1 1 100%; }
  .it-tools-left button { flex: 1 1 0; padding-inline: 8px; }
  .it-tools-right { flex: 1 1 100%; justify-content: space-between; }
  .it-storage select { min-width: 0; width: 100%; }
}
`;
