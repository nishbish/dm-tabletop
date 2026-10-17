// One stylesheet for the whole widget. Every class starts with `it-` and every rule is scoped
// to `.it-root`, so it cannot leak into the host page. Colours come from custom properties;
// the dark set follows the visitor's system setting.
export const STYLE_ID = 'it-styles';

export const css: string = `
.it-root {
  --it-bg: #ffffff; --it-fg: #1b1b1f; --it-muted: #55585f; --it-border: #b9bdc6;
  --it-surface: #f3f4f7; --it-accent: #1f4fb8; --it-accent-fg: #ffffff;
  --it-active-bg: #e3ecff; --it-focus: #b35c00; --it-danger: #a4161a; --it-input-bg: #ffffff;
  box-sizing: border-box; max-width: 100%; padding: 12px; border-radius: 8px;
  background: var(--it-bg); color: var(--it-fg);
  font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .it-root {
    --it-bg: #17181c; --it-fg: #ececf1; --it-muted: #aeb1ba; --it-border: #4b4e57;
    --it-surface: #23252b; --it-accent: #8ab4ff; --it-accent-fg: #0c1424;
    --it-active-bg: #1f2f52; --it-focus: #ffb454; --it-danger: #ff8a8d; --it-input-bg: #101114;
  }
}
.it-root [hidden] { display: none !important; }
.it-root *, .it-root *::before, .it-root *::after { box-sizing: border-box; }
.it-root :focus-visible { outline: 3px solid var(--it-focus); outline-offset: 2px; }
.it-root .it-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.it-root button, .it-root input, .it-root select {
  font: inherit; color: var(--it-fg); background: var(--it-input-bg);
  border: 1px solid var(--it-border); border-radius: 6px; padding: 6px 10px; min-height: 40px;
}
.it-root button { background: var(--it-surface); cursor: pointer; }
.it-root button:hover:not(:disabled) { border-color: var(--it-accent); }
.it-root button:disabled { opacity: 0.5; cursor: default; }
.it-root button.it-primary { background: var(--it-accent); color: var(--it-accent-fg); border-color: var(--it-accent); font-weight: 600; }
.it-root button.it-armed { border: 2px solid var(--it-danger); color: var(--it-danger); font-weight: 600; }
.it-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; justify-content: space-between; }
.it-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.it-field > span, .it-root .it-label { font-size: 0.8rem; color: var(--it-muted); }
.it-enc-name { font-size: 1.15rem; font-weight: 600; min-width: 14rem; max-width: 100%; }
.it-round { display: flex; align-items: center; gap: 8px; }
.it-round-num { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
.it-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.it-turn { margin: 0 0 8px; font-weight: 600; min-height: 1.4em; }
.it-table { width: 100%; border-collapse: collapse; }
.it-table th { text-align: left; font-size: 0.8rem; font-weight: 600; color: var(--it-muted); padding: 4px 6px; }
.it-table td { padding: 4px 6px; border-top: 1px solid var(--it-border); vertical-align: middle; }
.it-row--active td { background: var(--it-active-bg); }
.it-row--active td:first-child { box-shadow: inset 6px 0 0 var(--it-accent); }
.it-row--dragging { opacity: 0.55; }
.it-row--drop-before td { border-top: 3px solid var(--it-accent); }
.it-row--drop-after td { border-bottom: 3px solid var(--it-accent); }
.it-grip { cursor: grab; touch-action: none; user-select: none; padding: 8px 6px; color: var(--it-muted); display: inline-block; }
.it-marker { font-weight: 700; color: var(--it-accent); white-space: nowrap; }
.it-num { width: 4.5rem; text-align: right; }
.it-hp { width: 5rem; text-align: right; }
.it-name-wrap { position: relative; }
.it-name { width: 100%; min-width: 9rem; }
.it-suggest {
  position: absolute; z-index: 10; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 4px 0;
  list-style: none; max-height: 16rem; overflow-y: auto; background: var(--it-bg);
  border: 1px solid var(--it-border); border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.it-suggest li { padding: 6px 10px; cursor: pointer; display: flex; justify-content: space-between; gap: 12px; }
.it-suggest li small { color: var(--it-muted); }
.it-suggest li[aria-selected='true'] { background: var(--it-accent); color: var(--it-accent-fg); }
.it-suggest li[aria-selected='true'] small { color: inherit; }
.it-actions { display: flex; gap: 4px; flex-wrap: nowrap; }
.it-actions button { min-width: 40px; padding: 6px 8px; }
.it-down { color: var(--it-danger); font-weight: 700; font-size: 0.8rem; margin-left: 4px; }
.it-empty { color: var(--it-muted); margin: 12px 0; }
.it-storage { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--it-border); }
.it-storage select { min-width: 12rem; max-width: 100%; }
.it-message { min-height: 1.4em; margin: 8px 0 0; color: var(--it-muted); }
@media (max-width: 640px) {
  .it-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .it-table, .it-table tbody { display: block; }
  .it-table tr {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 8px; padding: 10px 6px;
    border-top: 1px solid var(--it-border);
  }
  .it-table td { display: flex; flex-direction: column; gap: 2px; border: 0; padding: 0; background: none; }
  .it-row--active { background: var(--it-active-bg); box-shadow: inset 6px 0 0 var(--it-accent); }
  .it-row--active td { background: none; }
  .it-row--active td:first-child { box-shadow: none; }
  .it-table td[data-label]::before { content: attr(data-label); font-size: 0.75rem; color: var(--it-muted); }
  .it-table td.it-c-grip, .it-table td.it-c-turn { display: none; }
  .it-table td.it-c-name, .it-table td.it-c-actions { grid-column: 1 / -1; }
  .it-row--active td.it-c-turn { display: flex; grid-column: 1 / -1; }
  .it-num, .it-hp { width: 100%; }
  .it-enc-name { min-width: 0; width: 100%; }
  .it-field { flex: 1 1 100%; }
}
`;
