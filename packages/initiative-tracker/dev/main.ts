// Demo page: the tracker with its default options (localStorage encounters, built-in SRD list),
// plus the stat block panel.
import { createTracker } from '../src/index';
import type { Monster, Pf2eMonster } from '../src/index';

const app = document.getElementById('app');
// The stat blocks are loaded only when one is first opened (their own chunk).
const tracker = createTracker(app, {
  statBlocks: {
    load: async (id) => {
      const all = (
        id.startsWith('pf2e-')
          ? (await import('../src/data/pf2e-monsters.json')).default
          : (await import('../src/data/srd-monsters.json')).default
      ) as (Monster | Pf2eMonster)[];
      return all.find((m) => m.id === id) || null;
    },
  },
});
// Handy in the browser console and for tests.
(window as unknown as { tracker: unknown }).tracker = tracker;
