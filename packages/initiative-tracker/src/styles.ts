// One stylesheet for the whole widget. Every class starts with `it-` and every rule is scoped
// to `.it-root`, so it cannot leak into the host page.
//
// Theming: every colour, the font, the corner radii, the shadow and the control height come from
// a CSS custom property named `--it-*` (listed in `themeVariables`, documented in the README). The
// host sets them on `:root`, on a wrapper or on `.it-root` itself; anything it leaves unset falls
// back to the built-in defaults below (a light and a dark set; the dark one follows
// `prefers-color-scheme`). The widget never reads the host's own variables.
export const STYLE_ID = 'it-styles';

export interface ThemeVariable {
  name: string;
  light: string;
  dark: string;
  description: string;
}

// The public theme variables with their built-in values. The README table is checked against
// this list by a test.
export const themeVariables: ThemeVariable[] = [
  { name: 'bg', light: '#f4f1e4', dark: '#0e2a24', description: 'Background of the whole widget' },
  { name: 'fg', light: '#16261f', dark: '#eef0e2', description: 'Main text' },
  { name: 'muted', light: '#4d5b52', dark: '#b6c4b9', description: 'Secondary text and labels' },
  { name: 'border', light: '#c9cdb8', dark: '#2f544a', description: 'Row and section dividers' },
  {
    name: 'border-strong',
    light: '#6e7c70',
    dark: '#7f9d90',
    description: 'Borders of fields and buttons',
  },
  {
    name: 'surface',
    light: '#e7e5d2',
    dark: '#17382f',
    description: 'Buttons and raised parts',
  },
  { name: 'row-bg', light: '#ffffff', dark: '#14352c', description: 'Fill of a creature row' },
  { name: 'input-bg', light: '#ffffff', dark: '#0a211c', description: 'Fill of text fields' },
  {
    name: 'head-bg',
    light: '#1d4a3b',
    dark: '#23524a',
    description: 'Background of the column heading bar',
  },
  { name: 'head-fg', light: '#f4f1e4', dark: '#f4f1e4', description: 'Text on the heading bar' },
  { name: 'accent', light: '#1d6a4c', dark: '#9be3b4', description: 'Primary buttons and markers' },
  {
    name: 'accent-fg',
    light: '#ffffff',
    dark: '#07241a',
    description: 'Text and icons on the accent colour',
  },
  {
    name: 'active-bg',
    light: '#dcefdc',
    dark: '#1f5a43',
    description: 'Fill of the row whose turn it is',
  },
  { name: 'badge-bg', light: '#1d4a3b', dark: '#9be3b4', description: 'The round counter circle' },
  {
    name: 'badge-fg',
    light: '#f4f1e4',
    dark: '#07241a',
    description: 'Number inside the round counter',
  },
  { name: 'focus', light: '#a35200', dark: '#ffc566', description: 'Keyboard focus ring' },
  {
    name: 'danger',
    light: '#a4161a',
    dark: '#ff9a9d',
    description: 'Down creatures, Clear and Delete',
  },
  {
    name: 'radius',
    light: '8px',
    dark: '8px',
    description: 'Corners of fields, buttons and rows',
  },
  { name: 'radius-lg', light: '14px', dark: '14px', description: 'Corners of the whole widget' },
  {
    name: 'font',
    light: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    dark: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    description: 'Font family',
  },
  { name: 'weight', light: '500', dark: '500', description: 'Normal font weight' },
  {
    name: 'weight-strong',
    light: '700',
    dark: '700',
    description: 'Bold font weight (buttons, names, round counter)',
  },
  {
    name: 'shadow',
    light: '0 2px 10px rgba(0, 0, 0, 0.12)',
    dark: '0 2px 12px rgba(0, 0, 0, 0.45)',
    description: 'Shadow of the widget and the suggestion list',
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

export const css: string = `
.it-root { ${workingCopies('light')} }
@media (prefers-color-scheme: dark) {
  .it-root { ${workingCopies('dark')} }
}
.it-root {
  box-sizing: border-box; max-width: 100%; min-width: 0; padding: var(--_pad);
  border-radius: var(--_radius-lg); background: var(--_bg); color: var(--_fg);
  font: var(--_weight) 16px/1.4 var(--_font);
}
.it-root [hidden] { display: none !important; }
.it-root *, .it-root *::before, .it-root *::after { box-sizing: border-box; }
.it-root :focus-visible { outline: 3px solid var(--_focus); outline-offset: 2px; }
.it-root .it-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.it-root button, .it-root input, .it-root select {
  font: inherit; color: var(--_fg); background: var(--_input-bg); min-width: 0;
  border: 1px solid var(--_border-strong); border-radius: var(--_radius);
  padding: 6px 10px; min-height: var(--_control-height);
}
.it-root button {
  background: var(--_surface); cursor: pointer; font-weight: var(--_weight-strong);
  letter-spacing: 0.01em;
  transition: background-color 0.12s, border-color 0.12s, transform 0.12s;
}
.it-root button:hover:not(:disabled) { border-color: var(--_accent); }
.it-root button:active:not(:disabled) { transform: translateY(1px); }
.it-root button:disabled { opacity: 0.5; cursor: default; }
.it-root button.it-primary { background: var(--_accent); color: var(--_accent-fg); border-color: var(--_accent); }
.it-root button.it-armed { border: 2px solid var(--_danger); color: var(--_danger); }
.it-header { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; justify-content: space-between; }
.it-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.it-field > span, .it-root .it-label { font-size: 0.8rem; color: var(--_muted); }
.it-enc-name { font-size: 1.15rem; font-weight: var(--_weight-strong); min-width: 14rem; max-width: 100%; }
.it-round { display: flex; align-items: center; gap: 10px; color: var(--_muted); }
.it-round-num {
  display: inline-grid; place-items: center; min-width: 3rem; height: 3rem; padding: 0 6px;
  border-radius: 999px; background: var(--_badge-bg); color: var(--_badge-fg);
  font-size: 1.5rem; font-weight: var(--_weight-strong); font-variant-numeric: tabular-nums; line-height: 1;
}
.it-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 12px; align-items: center; }
.it-root .it-toolbar button { border-width: 2px; padding-inline: 16px; }
.it-root .it-toolbar button[data-action='add'] { border-radius: 999px; padding-inline: 10px 20px; }
.it-root .it-toolbar button[data-action='add']::before {
  content: '+'; display: inline-grid; place-items: center; width: 1.6em; height: 1.6em; margin-right: 8px;
  border-radius: 50%; background: var(--_accent-fg); color: var(--_accent); font-size: 1.2rem; line-height: 1;
}
.it-root .it-toolbar button[data-action='clear'] { color: var(--_danger); border-color: var(--_danger); background: transparent; margin-left: auto; }
.it-root .it-toolbar button[data-action='sort'],
.it-root .it-toolbar button[data-action='roll-all'] { background: transparent; border-color: var(--_accent); }
.it-turn { margin: 0 0 8px; font-weight: var(--_weight-strong); min-height: 1.4em; }
.it-table { width: 100%; border-collapse: separate; border-spacing: 0 6px; }
.it-table th {
  text-align: left; font-size: 0.85rem; font-weight: var(--_weight-strong); padding: 8px 6px;
  background: var(--_head-bg); color: var(--_head-fg); border-bottom: 3px solid var(--_head-fg);
}
.it-table th:first-child { border-top-left-radius: var(--_radius); }
.it-table th:last-child { border-top-right-radius: var(--_radius); }
.it-table td { padding: 6px; background: var(--_row-bg); vertical-align: middle; }
.it-table td:first-child { border-radius: var(--_radius) 0 0 var(--_radius); }
.it-table td:last-child { border-radius: 0 var(--_radius) var(--_radius) 0; }
.it-row--active td { background: var(--_active-bg); }
.it-row--active td:first-child { box-shadow: inset 6px 0 0 var(--_accent); }
.it-row--down td .it-name { text-decoration: line-through; text-decoration-thickness: 2px; }
.it-row--dragging { opacity: 0.55; }
.it-row--drop-before td { box-shadow: inset 0 3px 0 var(--_accent); }
.it-row--drop-after td { box-shadow: inset 0 -3px 0 var(--_accent); }
.it-grip { cursor: grab; touch-action: none; user-select: none; padding: 8px 6px; color: var(--_muted); display: inline-block; }
.it-marker { font-weight: var(--_weight-strong); color: var(--_accent); white-space: nowrap; }
.it-num { width: 4.5rem; text-align: right; }
.it-hp { width: 5rem; text-align: right; }
.it-name-wrap { position: relative; }
.it-name { width: 100%; min-width: 9rem; }
.it-suggest {
  position: absolute; z-index: 10; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 4px 0;
  list-style: none; max-height: 16rem; overflow-y: auto; background: var(--_row-bg); color: var(--_fg);
  border: 1px solid var(--_border-strong); border-radius: var(--_radius); box-shadow: var(--_shadow);
}
.it-suggest li { padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; gap: 12px; }
.it-suggest li small { color: var(--_muted); }
.it-suggest li[aria-selected='true'] { background: var(--_accent); color: var(--_accent-fg); }
.it-suggest li[aria-selected='true'] small { color: inherit; }
.it-actions { display: flex; gap: 4px; flex-wrap: nowrap; }
.it-actions button { min-width: var(--_control-height); padding: 6px 8px; }
.it-actions button[data-action='roll']::before {
  content: ''; display: inline-block; width: 1em; height: 1em; margin-right: 6px; vertical-align: -0.12em;
  background: currentColor; clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
}
.it-down { color: var(--_danger); font-weight: var(--_weight-strong); font-size: 0.8rem; margin-left: 4px; }
.it-empty { color: var(--_muted); margin: 12px 0; }
.it-storage { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--_border); }
.it-storage select { min-width: 12rem; max-width: 100%; }
.it-message { min-height: 1.4em; margin: 8px 0 0; color: var(--_muted); }
@media (prefers-reduced-motion: reduce) {
  .it-root button { transition: none; }
  .it-root button:active:not(:disabled) { transform: none; }
}
@media (max-width: 720px) {
  .it-root { padding: calc(var(--_pad) * 0.7); }
  .it-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .it-table, .it-table tbody { display: block; }
  .it-table tr {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; padding: 10px 8px;
    margin-bottom: 8px; background: var(--_row-bg); border-radius: var(--_radius);
  }
  .it-table td { display: flex; flex-direction: column; gap: 2px; border: 0; padding: 0; background: none; min-width: 0; }
  .it-table td:first-child, .it-table td:last-child { border-radius: 0; }
  .it-row--active { background: var(--_active-bg) !important; box-shadow: inset 6px 0 0 var(--_accent); }
  .it-row--active td, .it-row--active td:first-child { background: none; box-shadow: none; }
  .it-row--drop-before { box-shadow: 0 -3px 0 var(--_accent); }
  .it-row--drop-after { box-shadow: 0 3px 0 var(--_accent); }
  .it-row--drop-before td, .it-row--drop-after td { box-shadow: none; }
  .it-table td[data-label]::before { content: attr(data-label); font-size: 0.75rem; color: var(--_muted); }
  .it-table td.it-c-grip, .it-table td.it-c-turn { display: none; }
  .it-table td.it-c-name, .it-table td.it-c-actions { grid-column: 1 / -1; }
  .it-row--active td.it-c-turn { display: flex; grid-column: 1 / -1; }
  .it-num, .it-hp { width: 100%; }
  .it-enc-name { min-width: 0; width: 100%; }
  .it-field { flex: 1 1 100%; }
  .it-name { min-width: 0; }
  .it-actions { flex-wrap: wrap; }
  .it-actions button { flex: 1 1 0; }
  .it-root .it-toolbar button[data-action='clear'] { margin-left: 0; }
  .it-storage select { min-width: 0; width: 100%; }
}
`;
