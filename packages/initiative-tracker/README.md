# @dm-tabletop/initiative-tracker

A standalone initiative tracker for tabletop RPG sessions: turn order, rounds, hit points and
a creature list to fill in stats. It is a dependency-free TypeScript library that draws into any
element. It knows nothing about accounts or billing; where encounters are kept is up to the
host through a small storage interface.

## Try it

```
npm run dev -w @dm-tabletop/initiative-tracker     # demo page on http://127.0.0.1:5174
npm run build -w @dm-tabletop/initiative-tracker   # dist/initiative-tracker.js + dist/types
```

The built file is about 65 kB (16 kB gzipped); about 28 kB of that is the creature list.

## Use

```ts
import { createTracker, srdCreatures } from '@dm-tabletop/initiative-tracker';

const tracker = createTracker(document.getElementById('tracker'), {
  creatures: [...srdCreatures, { id: 'my-boss', name: 'My Boss', ac: 17, hp: 120, dex: 14 }],
  onChange: (state) => console.log('turn', state.turn, 'round', state.round),
});

tracker.getState(); // plain JSON, safe to keep
tracker.setState(savedState); // replaces everything (migrated first)
tracker.destroy(); // removes the DOM, listeners and styles
await tracker.ready; // the last session has been restored
```

The widget injects one stylesheet (every class starts with `it-`, scoped under `.it-root`) and
follows `prefers-color-scheme` unless you set the theme variables (see Theming). It fills the width of its container.

### Theming

Every colour, the font, the corner radii, the shadow and the control height are CSS custom
properties named `--it-*`. Set them on `:root`, on a wrapper element or on `.it-root`; anything
you leave unset keeps the built-in value. The built-in set is a light and a dark palette
(a deep green and cream "battle mat" look); the dark one follows `prefers-color-scheme`.
The widget never reads variables of the host page, so mapping your own design tokens is one
small rule:

```css
:root {
  --it-bg: var(--my-card);
  --it-fg: var(--my-text);
  --it-accent: var(--my-brand);
  --it-radius: 6px;
}
```

| Variable              | Light default                                              | Dark default                     | Used for                                            |
| --------------------- | ---------------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| `--it-bg`             | `#f4f1e4`                                                  | `#0e2a24`                        | Background of the whole widget                      |
| `--it-fg`             | `#16261f`                                                  | `#eef0e2`                        | Main text                                           |
| `--it-muted`          | `#4d5b52`                                                  | `#b6c4b9`                        | Secondary text and labels                           |
| `--it-border`         | `#c9cdb8`                                                  | `#2f544a`                        | Row and section dividers                            |
| `--it-border-strong`  | `#6e7c70`                                                  | `#7f9d90`                        | Borders of fields and buttons                       |
| `--it-surface`        | `#e7e5d2`                                                  | `#17382f`                        | Buttons and raised parts                            |
| `--it-row-bg`         | `#ffffff`                                                  | `#14352c`                        | Fill of a creature row                              |
| `--it-input-bg`       | `#ffffff`                                                  | `#0a211c`                        | Fill of text fields                                 |
| `--it-head-bg`        | `#1d4a3b`                                                  | `#23524a`                        | Background of the column heading bar                |
| `--it-head-fg`        | `#f4f1e4`                                                  | same                             | Text on the heading bar                             |
| `--it-accent`         | `#1d6a4c`                                                  | `#9be3b4`                        | Primary buttons and markers                         |
| `--it-accent-fg`      | `#ffffff`                                                  | `#07241a`                        | Text and icons on the accent colour                 |
| `--it-active-bg`      | `#dcefdc`                                                  | `#1f5a43`                        | Fill of the row whose turn it is                    |
| `--it-badge-bg`       | `#1d4a3b`                                                  | `#9be3b4`                        | The round counter circle                            |
| `--it-badge-fg`       | `#f4f1e4`                                                  | `#07241a`                        | Number inside the round counter                     |
| `--it-focus`          | `#a35200`                                                  | `#ffc566`                        | Keyboard focus ring                                 |
| `--it-danger`         | `#a4161a`                                                  | `#ff9a9d`                        | Down creatures, Clear and Delete                    |
| `--it-radius`         | `8px`                                                      | same                             | Corners of fields, buttons and rows                 |
| `--it-radius-lg`      | `14px`                                                     | same                             | Corners of the whole widget                         |
| `--it-font`           | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | same                             | Font family                                         |
| `--it-weight`         | `500`                                                      | same                             | Normal font weight                                  |
| `--it-weight-strong`  | `700`                                                      | same                             | Bold font weight (buttons, names, round counter)    |
| `--it-shadow`         | `0 2px 10px rgba(0, 0, 0, 0.12)`                           | `0 2px 12px rgba(0, 0, 0, 0.45)` | Shadow of the widget and the suggestion list        |
| `--it-control-height` | `44px`                                                     | same                             | Minimum height of buttons and fields (touch target) |
| `--it-pad`            | `14px`                                                     | same                             | Padding inside the widget                           |

The same list is exported as `themeVariables` (name, defaults, description). Layout classes all
start with `it-`; they are not a stable API, the variables are.

### Options

| Option          | Type                       | Default        | Meaning                                                                                       |
| --------------- | -------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `storage`       | `EncounterStorage \| null` | localStorage   | Where encounters are saved. `null` turns saving off and hides the open/save/new/delete UI.    |
| `creatures`     | `CreatureTemplate[]`       | `srdCreatures` | Autocomplete list. It replaces the built-in list; spread `srdCreatures` into yours to extend. |
| `rng`           | `() => number` in [0, 1)   | `Math.random`  | Random source for rolls (inject a fake one in tests).                                         |
| `onChange`      | `(state) => void`          | none           | Called after every change the user makes (not after `setState`).                              |
| `onLimit`       | `(reason: string) => void` | none           | Called when `storage.save` rejects with `code === 'LIMIT'`.                                   |
| `initialState`  | `TrackerState`             | last session   | Start from this state instead of restoring the last session.                                  |
| `autosaveDelay` | `number` (ms)              | `400`          | Wait after the last change before the working state is autosaved.                             |

### State

```ts
interface TrackerState {
  version: 1;
  name: string;
  round: number; // starts at 1
  turn: number; // index into rows
  rows: {
    id: string;
    name: string;
    initiative: number;
    initiativeBonus: number;
    hp: number;
    maxHp: number;
    ac: number;
    monsterId?: string;
  }[];
}
```

`migrate(anything)` turns old or damaged saved data into a valid current state. The pure
functions the UI uses (`sortByInitiative`, `nextTurn`, `resetRound`, `rollInitiative`, `addRow`,
`removeRow`, `clear`, `moveRow`, `applyHpInput`) are exported too.

### Using it

- Press **Add creature**, type a name. Suggestions come from the creature list; picking one fills
  AC, HP and the initiative bonus. Any other name is fine, fill the numbers in by hand.
- **Roll** rolls d20 + bonus for one row, **Roll all** for everyone, **Sort** orders by initiative
  (ties: higher bonus, then the order they were in). **Next** moves the turn on; after the last
  creature the round counter goes up. **Reset round** goes back to round 1.
- In the HP field type a number to set it, or `-5` / `+3` to change it. Max HP is the next field.
- Reorder by dragging the handle, or with the up/down buttons.
- **Clear** and **Delete** ask for a second press.

### Storage

```ts
interface EncounterStorage {
  list(): Promise<{ id: string; name: string }[]>;
  load(id: string): Promise<TrackerState | null>;
  save(id: string | null, state: TrackerState): Promise<string>; // null = new, resolves to the id
  remove(id: string): Promise<void>;
}
```

The default `LocalStorageEncounterStorage({ prefix = 'it-tracker', storage? })` keeps encounters in
the browser; it treats damaged JSON as empty and rejects `save` (instead of throwing) when the disk
is full. The tracker also autosaves the working state under the reserved id `LAST_SESSION_ID`
(`'_last_session'`) and restores it on start, so a custom storage must accept that id and should
not count it as one of the user's encounters.

The package sets no limits. A host that wants to cap saved encounters rejects `save` with an error
whose `code` is `'LIMIT'`; the tracker then calls `onLimit(error.message)` and shows the message
without blocking.

### Creature data

`srdCreatures` has the monsters and NPCs of the D&D 5e SRD 5.1: `{ id, name, ac, hp, hitDice, dex, cr }`.
The initiative bonus is `floor((dex - 10) / 2)`. A `CreatureTemplate` may give `initiativeBonus`
directly instead of `dex`. To regenerate the file (it is committed), download the SRD 5.1 PDF
(Creative Commons edition) from the page named below and run:

```
npm install --no-save pdfjs-dist@4
node packages/initiative-tracker/scripts/build-creatures.mjs path/to/SRD_CC_v5.1.pdf
```

### Accessibility

Every input has a label, every button an `aria-label`, and focus is always visible. The current
turn is marked with the text "Turn" and a bar, not only a colour, and announced in a polite live
region ("Round 2, turn: Goblin"); messages like "Saved" use another. Rows can be reordered with
buttons as well as dragging, and the name field is an ARIA combobox (arrow keys, Enter, Escape).

## Attribution

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

A host app that offers the built-in creature list should show this notice too.

## Tests

`npm test` runs the unit and DOM tests (happy-dom). `npm run e2e -w @dm-tabletop/initiative-tracker`
builds the demo page and runs one Playwright smoke test on port 4174 (needs
`npx playwright install chromium` once).
