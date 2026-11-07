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

Every colour, the font, the corner cut, the shadow and the control height are CSS custom
properties named `--it-*`. Set them on `:root`, on a wrapper element or on `.it-root`; anything
you leave unset keeps the built-in value. The built-in set is a light and a dark palette
(dark green rows on a cream panel, as on the first DM Tools tracker); the dark one follows `prefers-color-scheme`.
The widget never reads variables of the host page, so mapping your own design tokens is one
small rule:

```css
:root {
  --it-bg: var(--my-card);
  --it-fg: var(--my-text);
  --it-accent: var(--my-brand);
  --it-cut: 8px; /* chamfered corners, like the edge of a die */
}
```

| Variable              | Light default                                              | Dark default                     | Used for                                                                                              |
| --------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--it-bg`             | `#f4f1e4`                                                  | `#0e2a24`                        | Background of the whole widget                                                                        |
| `--it-fg`             | `#16261f`                                                  | `#eef0e2`                        | Main text on the background                                                                           |
| `--it-muted`          | `#4d5b52`                                                  | `#b6c4b9`                        | Secondary text and labels                                                                             |
| `--it-border-strong`  | `#5f6f63`                                                  | `#8fae9f`                        | Borders of fields and buttons                                                                         |
| `--it-surface`        | `#e7e5d2`                                                  | `#17382f`                        | Buttons and raised parts                                                                              |
| `--it-input-bg`       | `#ffffff`                                                  | `#0a211c`                        | Fill of text fields                                                                                   |
| `--it-rule`           | `#c9c9ad`                                                  | `#dbdbc7`                        | The panel behind the creature list, which shows as the lines between the cells (a gradient works too) |
| `--it-head-bg`        | `#244e44`                                                  | `#2b5a4e`                        | Background of the column headings                                                                     |
| `--it-head-fg`        | `#f4f1e4`                                                  | same                             | Text of the column headings                                                                           |
| `--it-row-bg`         | `#244e44`                                                  | `#1c4137`                        | Fill of a creature row                                                                                |
| `--it-row-fg`         | `#f4f1e4`                                                  | `#eef0e2`                        | Text in a creature row                                                                                |
| `--it-active-bg`      | `#2f7a5e`                                                  | same                             | Fill of the row whose turn it is                                                                      |
| `--it-down-bg`        | `#7a3535`                                                  | `#773636`                        | Fill of a row whose creature is down (0 hit points)                                                   |
| `--it-accent`         | `#1d6a4c`                                                  | `#9be3b4`                        | Primary buttons and markers                                                                           |
| `--it-accent-fg`      | `#ffffff`                                                  | `#07241a`                        | Text and icons on the accent colour                                                                   |
| `--it-focus`          | `#a35200`                                                  | `#ffc566`                        | Keyboard focus ring                                                                                   |
| `--it-danger`         | `#a4161a`                                                  | `#ff9a9d`                        | Clear and Delete buttons                                                                              |
| `--it-remove`         | `#8c3a35`                                                  | `#8a4540`                        | The small remove button on each row (a muted red)                                                     |
| `--it-cut`            | `0px`                                                      | same                             | Size of the cut corners of the widget, the creature list, buttons and fields (0 = square)             |
| `--it-font`           | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | same                             | Font family                                                                                           |
| `--it-weight`         | `500`                                                      | same                             | Normal font weight                                                                                    |
| `--it-weight-strong`  | `700`                                                      | same                             | Bold font weight (buttons, headings, the round number)                                                |
| `--it-shadow`         | `0 2px 10px rgba(0, 0, 0, 0.12)`                           | `0 2px 12px rgba(0, 0, 0, 0.45)` | Shadow of the suggestion list and of a row being dragged                                              |
| `--it-control-height` | `44px`                                                     | same                             | Minimum height of buttons and fields (touch target)                                                   |
| `--it-pad`            | `14px`                                                     | same                             | Padding inside the widget                                                                             |

The same list is exported as `themeVariables` (name, defaults, description). Layout classes all
start with `it-`; they are not a stable API, the variables are.

### Options

| Option          | Type                       | Default        | Meaning                                                                                       |
| --------------- | -------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `storage`       | `EncounterStorage \| null` | localStorage   | Where encounters are saved. `null` turns saving off and hides the folder and new buttons.     |
| `creatures`     | `CreatureTemplate[]`       | `srdCreatures` | Autocomplete list. It replaces the built-in list; spread `srdCreatures` into yours to extend. |
| `rng`           | `() => number` in [0, 1)   | `Math.random`  | Random source for rolls (inject a fake one in tests).                                         |
| `onChange`      | `(state) => void`          | none           | Called after every change the user makes (not after `setState`).                              |
| `onRowEdit`     | `(row) => void`            | none           | Called when the user changes the HP, max HP or AC of a linked row.                            |
| `onLoad`        | `(state) => void`          | none           | Called after an encounter was opened or the last session restored.                            |
| `onLinkClick`   | `(row) => void`            | none           | When given, linked rows show a button that calls this.                                        |
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
`removeRow`, `clear`, `moveRow`, `applyHpInput`, `changeHp`) are exported too.

### Linking rows

A row can carry a `link`, a string the tracker only stores, to tie it to something outside it such as a token on a map. `tracker.linkRow(link, fields)` finds the row that has the link, else the first unlinked row with the same name, else the first empty row, else adds one, and returns it. `tracker.updateLinked(link, patch)` changes the linked row (`link: undefined` unties it) without calling `onRowEdit`, so two sides can follow each other without a loop.

### Using it

- A new encounter starts with five empty rows; **Add creature** (the big **+**) adds more. Type a
  name: suggestions come from the creature list, and picking one fills AC, HP and the initiative
  bonus, shown in brackets beside the initiative ("(+2)"). Any other name is fine, fill the
  numbers in by hand; players give their total, so there is no bonus to type in. Empty rows show
  empty fields.
- The d20 button in the initiative cell (shown on hover, or while the cell is in use on a touch
  screen) rolls d20 + bonus for one row, **Roll all** for every filled-in row, **Sort** orders by
  initiative with empty rows last (ties: higher bonus, then the order they were in). **Next** moves
  the turn on, skipping empty rows; after the last creature the round counter goes up. **Reset
  round** goes back to round 1.
- While the initiative field has focus, a small box under it has an amount (1 to start with) and
  **-** / **+** buttons that change the initiative by that much.
- In the HP field type a number to set it, or `-5` / `+3` to change it. Max HP is the next field.
  While the HP field has focus, a small box under it has an amount (1 to start with) and **-** /
  **+** buttons that take that many hit points away or add them, by the same rules: never below 0,
  never above max HP when one is set. **Escape** closes the box.
- Reorder by dragging the handle (the row follows the pointer while the others slide aside), or
  focus the handle and press the up and down arrow keys.
- The encounter's name sits above the list. Changes are saved on their own a moment after the
  last one (there is no Save button): an encounter is kept once it has a filled-in row, without
  its empty rows. The folder button beside the name lists the saved encounters, to open one or
  delete it; the **+** beside it starts a new encounter.
- **Clear** (which leaves five empty rows) and deleting a saved encounter ask for a second press.

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
is full. The tracker autosaves the open encounter with `save(id, state)` (`save(null, state)` the first
time), and the working state under the reserved id `LAST_SESSION_ID` (`'_last_session'`), which it
restores on start. That copy carries `encounterId`, so after a reload the tracker carries on saving
into the same encounter; a custom storage must accept the reserved id, keep `encounterId`, and
should not count it as one of the user's encounters. If `save(id, ...)` rejects with `status` 404
or `code` `'NOT_FOUND'` (deleted elsewhere), the tracker saves the encounter again as a new one.

The package sets no limits. A host that wants to cap saved encounters rejects `save` with an error
whose `code` is `'LIMIT'`; the tracker then calls `onLimit(error.message)` and shows the message
beside the name without blocking. It stops trying to create that encounter until one is deleted
or another is started.

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
region ("Round 2, turn: Goblin") that is not shown on screen; other messages ("Opened Lair") use
another, shown only when something went wrong. Rows can be reordered with
the arrow keys on their handle as well as dragging, and the name field is an ARIA combobox (arrow keys, Enter, Escape).

## Attribution

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

A host app that offers the built-in creature list should show this notice too.

## Tests

`npm test` runs the unit and DOM tests (happy-dom). `npm run e2e -w @dm-tabletop/initiative-tracker`
builds the demo page and runs one Playwright smoke test on port 4174 (needs
`npx playwright install chromium` once).
