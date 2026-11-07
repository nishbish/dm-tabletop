// Builds src/data/pf2e-creatures.json: the creatures of Pathfinder Monster Core and Monster Core 2
// (Paizo, under the ORC License; see NOTICE.md), for the tracker's name suggestions.
//
// Input: a checkout of the Foundry VTT PF2e system (https://github.com/foundryvtt/pf2e), which keeps
// each creature as JSON under packs/pf2e/pathfinder-monster-core{,-2}/. Only plain game numbers are
// taken (name, level, AC, HP, Perception), no descriptions or art, and only entries the data marks
// as published under the ORC License.
//
//   node scripts/build-pf2e-creatures.mjs <foundry-pf2e checkout> [output.json]
//
// Reserved Material under the ORC License (proper nouns: deities, planes and other locations,
// named characters) is never used: a creature is left out when its name contains one (RESERVED
// below), and unique creatures (named individuals) are left out too. Check new names against that
// rule whenever the source books change.
import * as fs from 'node:fs';
import * as path from 'node:path';

const BOOKS = ['pathfinder-monster-core', 'pathfinder-monster-core-2'];

// Proper nouns of the setting found in Monster Core names (checked by hand, 2026-11-07). A Shade is
// named after a plane in brackets, so every Shade variant is left out.
const RESERVED = [
  /^Shade \(/,
  /\bPharasma\b/,
  /\bLeng\b/,
  /\bTindalos\b/,
  /\bTreerazer\b/,
  /\bGrisantian\b/,
];

const [root, out = path.join(import.meta.dirname, '../src/data/pf2e-creatures.json')] =
  process.argv.slice(2);
if (!root) {
  console.error(
    'usage: node scripts/build-pf2e-creatures.mjs <foundry-pf2e checkout> [output.json]',
  );
  process.exit(1);
}

const creatures = [];
const left = { reserved: [], unique: [], notOrc: 0 };
for (const book of BOOKS) {
  const dir = path.join(root, 'packs/pf2e', book);
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (j.type !== 'npc') continue;
    const s = j.system;
    const pub = s.details.publication || {};
    if (pub.license !== 'ORC') {
      left.notOrc++;
      continue;
    }
    if ((s.traits.value || []).includes('unique')) {
      left.unique.push(j.name);
      continue;
    }
    if (RESERVED.some((re) => re.test(j.name))) {
      left.reserved.push(j.name);
      continue;
    }
    // Pathfinder rolls initiative with Perception
    creatures.push({
      name: j.name,
      ac: s.attributes.ac.value,
      hp: s.attributes.hp.max,
      initiativeBonus: s.perception.mod,
      level: s.details.level.value,
    });
  }
}

creatures.sort((a, b) => a.name.localeCompare(b.name));
// the id is made from the name when the list is loaded (src/creatures.ts), so names must be unique
const names = new Set();
for (const c of creatures) {
  if (names.has(c.name)) throw new Error('duplicate name ' + c.name);
  names.add(c.name);
  for (const key of ['ac', 'hp', 'initiativeBonus', 'level']) {
    if (!Number.isInteger(c[key])) throw new Error(`${c.name}: ${key} is ${c[key]}`);
  }
}
// Compact rows, [name, AC, HP, initiative bonus, level], to keep the download small.
const rows = creatures.map((c) => [c.name, c.ac, c.hp, c.initiativeBonus, c.level]);
fs.writeFileSync(out, '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
console.log(
  `${creatures.length} creatures written to ${out}; left out: ${left.reserved.length} with reserved names, ` +
    `${left.unique.length} unique, ${left.notOrc} not ORC`,
);
console.log('reserved:', left.reserved.join(', '));
