// Generates src/data/srd-creatures.json from the official System Reference Document 5.1 (CC-BY-4.0).
//
// Source: the SRD 5.1 PDF published by Wizards of the Coast, linked from
//   https://dnd.wizards.com/resources/systems-reference-document
// (the "SRD_CC_v5.1.pdf" Creative Commons edition). Only the stat blocks printed in that
// document (the "Monsters" chapter and the "Nonplayer Characters" appendix) are read, so nothing
// outside the SRD can end up in the list.
//
// Usage:
//   node scripts/build-creatures.mjs <SRD_CC_v5.1.pdf | extracted-text.txt> [output.json]
//
// A .pdf input is read with `pdfjs-dist`, which is deliberately NOT a dependency of this package
// (it is only needed when regenerating the data). Install it for a one-off run with
//   npm install --no-save pdfjs-dist@4
// A .txt input is the same text, one line per visual line, from any PDF text extractor.
//
// Output fields: id (slug), name, ac, hp, hitDice ("3d8+3"), dex, cr (number, 1/8 = 0.125).
// The tracker derives the initiative bonus as floor((dex - 10) / 2).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
const output = process.argv[3] || join(here, '..', 'src', 'data', 'srd-creatures.json');
if (!input) {
  console.error(
    'usage: node scripts/build-creatures.mjs <SRD_CC_v5.1.pdf | text.txt> [output.json]',
  );
  process.exit(2);
}

async function pdfToLines(path) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error(
      'Reading a PDF needs pdfjs-dist: run `npm install --no-save pdfjs-dist@4` first.',
    );
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 })
    .promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = '';
    let y = null;
    for (const item of content.items) {
      const itemY = item.transform[5];
      if (y !== null && Math.abs(itemY - y) > 2) {
        lines.push(line);
        line = '';
      }
      line += item.str;
      y = itemY;
    }
    lines.push(line);
  }
  return lines;
}

// The PDF uses typographic hyphens, a real minus sign and curly quotes; normalise to ASCII.
function clean(text) {
  return text
    .replace(/-?[­‐‑]+/g, '-')
    .replace(/[−–]/g, '-')
    .replace(/[’‘]/g, "'")
    .trim();
}

const SIZE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/;
// SRD headings that are printed "Group, Variant" but are better read as "Variant Group".
const RENAME = {
  'Elf, Drow': 'Drow',
  'Gnome, Deep (Svirfneblin)': 'Deep Gnome (Svirfneblin)',
};

function parseCr(text) {
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number);
    return a / b;
  }
  return Number(text);
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parse(rawLines) {
  const lines = rawLines.map(clean);
  const first = lines.findIndex((l, i) => l === 'Monsters (A)' && lines[i + 1] === 'Aboleth');
  if (first < 0) throw new Error('Could not find the start of the Monsters chapter');
  const out = [];
  for (let i = first; i < lines.length; i++) {
    const ac = lines[i].match(/^Armor Class (\d+)/);
    if (!ac) continue;
    // Name: walk back over the size/type/alignment line (it can wrap onto a second line).
    let n = i - 1;
    while (n > first && !SIZE.test(lines[n])) n--;
    const name = RENAME[lines[n - 1]] || lines[n - 1];
    let hp = null;
    let dice = null;
    let dex = null;
    let cr = null;
    for (let j = i; j < i + 30 && j < lines.length; j++) {
      const h = lines[j].match(/^Hit Points (\d+)(?: \(([^)]*)\))?/);
      if (h) {
        hp = Number(h[1]);
        dice = h[2] ? h[2].replace(/\s+/g, '').toLowerCase() : null;
      }
      const d = lines[j].match(/^\d+ \([+-]?\d+\) (\d+) \(/);
      if (d && dex === null) dex = Number(d[1]);
      const c = lines[j].match(/^Challenge ([\d/]+) /);
      if (c) {
        cr = parseCr(c[1]);
        break;
      }
    }
    if (hp === null || dex === null || cr === null) {
      throw new Error(`Incomplete stat block for "${name}" near line ${i}`);
    }
    out.push({ id: slug(name), name, ac: Number(ac[1]), hp, hitDice: dice || `${hp}`, dex, cr });
  }
  return out;
}

const lines = input.endsWith('.pdf')
  ? await pdfToLines(input)
  : readFileSync(input, 'utf8').split('\n');
const creatures = parse(lines);

const ids = new Set();
for (const c of creatures) {
  if (ids.has(c.id)) throw new Error(`Duplicate id ${c.id}`);
  ids.add(c.id);
}
creatures.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(output, JSON.stringify(creatures, null, 2) + '\n');
console.log(`Wrote ${creatures.length} creatures to ${output}`);
