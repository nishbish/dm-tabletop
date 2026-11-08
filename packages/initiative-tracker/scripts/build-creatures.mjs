// Generates the creature data from the official System Reference Document 5.1 (CC-BY-4.0):
//   src/data/srd-creatures.json  the short list the tracker's name field autocompletes from
//   src/data/srd-monsters.json   the full stat blocks (shown by the stat block panel and pages)
//
// Source: the SRD 5.1 PDF published by Wizards of the Coast, linked from
//   https://dnd.wizards.com/resources/systems-reference-document
// (the "SRD_CC_v5.1.pdf" Creative Commons edition). Only the stat blocks printed in that
// document (the "Monsters" chapter and its appendices of creatures and nonplayer characters) are
// read, so nothing outside the SRD can end up in the lists.
//
// Usage:
//   node scripts/build-creatures.mjs <SRD_CC_v5.1.pdf> [out-dir]
//
// The PDF is read with `pdfjs-dist`, which is deliberately NOT a dependency of this package (it
// is only needed when regenerating the data). Install it for a one-off run with
//   npm install --no-save pdfjs-dist@4
//
// The stat block layout is read from the fonts: the creature's name is the 12pt bold heading
// followed by an italic size/type line, field labels ("Armor Class") are bold, trait and action
// names ("Amphibious.") are bold italic, and "Actions", "Reactions" and "Legendary Actions" are
// 10.8pt bold headings. Italic text inside a description is kept as *text*.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
const outDir = process.argv[3] || join(here, '..', 'src', 'data');
if (!input || !input.endsWith('.pdf')) {
  console.error('usage: node scripts/build-creatures.mjs <SRD_CC_v5.1.pdf> [out-dir]');
  process.exit(2);
}

/** Every text run in the PDF: page, position, font id, size and text. */
async function pdfItems(path) {
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
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const it of content.items) {
      if (!it.str) continue;
      items.push({
        page: p,
        x: it.transform[4],
        y: it.transform[5],
        size: Math.round(it.transform[0] * 10) / 10,
        font: it.fontName,
        text: it.str,
      });
    }
  }
  return items;
}

// The PDF uses typographic hyphens, a real minus sign and curly quotes; normalise to ASCII.
function clean(text) {
  return text
    .replace(/-?[­‐‑]+/g, '-')
    .replace(/[−–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/**
 * Groups the runs into visual lines. The pages have two columns, written column by column, so a
 * new line starts whenever the baseline moves. Each line keeps its runs (font and text).
 */
function toLines(items) {
  const lines = [];
  let line = null;
  for (const it of items) {
    if (!line || line.page !== it.page || Math.abs(line.y - it.y) > 2) {
      line = { page: it.page, x: it.x, y: it.y, col: it.x > 300 ? 1 : 0, runs: [] };
      lines.push(line);
    }
    line.runs.push(it);
  }
  for (const l of lines) l.text = clean(l.runs.map((r) => r.text).join('')).trim();
  return lines.filter((l) => l.text);
}

const SIZE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/;
// SRD headings that are printed "Group, Variant" but are better read as "Variant Group".
const RENAME = {
  'Elf, Drow': 'Drow',
  'Gnome, Deep (Svirfneblin)': 'Deep Gnome (Svirfneblin)',
};
const FIELDS = {
  'Saving Throws': 'saves',
  Skills: 'skills',
  'Damage Vulnerabilities': 'damageVulnerabilities',
  'Damage Resistances': 'damageResistances',
  'Damage Immunities': 'damageImmunities',
  'Condition Immunities': 'conditionImmunities',
  Senses: 'senses',
  Languages: 'languages',
};
// The lines of a spell list ("Cantrips (at will): ...", "3/day each: ...") are paragraphs of their own.
const SPELL_LINE = /^(Cantrips \(at will\)|\d+(st|nd|rd|th) level \(|At will:|\d+\/day)/;
const SECTIONS = { Actions: 'actions', Reactions: 'reactions', 'Legendary Actions': 'legendary' };

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

function parse(lines) {
  const first = lines.findIndex(
    (l, i) => l.text === 'Monsters (A)' && lines[i + 1].text === 'Aboleth',
  );
  if (first < 0) throw new Error('Could not find the start of the Monsters chapter');

  // Learn the font ids from the first stat block (the Aboleth) rather than hard-coding them.
  const at = (text) => lines.slice(first).find((l) => l.text.startsWith(text));
  const fonts = {
    heading: at('Aboleth').runs[0].font,
    italic: at('Large aberration').runs[0].font,
    label: at('Armor Class').runs[0].font,
    body: at('Armor Class').runs.at(-1).font,
    entry: at('Amphibious.').runs[0].font,
    title: at('Monsters (A)').runs[0].font,
  };
  const isName = (l) => l.runs[0].font === fonts.heading && l.runs[0].size === 12;
  const isSection = (l) => l.runs[0].font === fonts.heading && l.runs[0].size === 10.8;
  const isTitle = (l) => l.runs[0].font === fonts.title; // chapter titles and page numbers
  const isFooter = (l) => /^(\d+ )?(System Reference Document 5\.1)?( \d+)?$/.test(l.text);

  // Descriptions printed after some stat blocks (mostly in the appendices) use their own fonts.
  const blockFonts = new Set([fonts.body, fonts.italic, fonts.entry, fonts.label]);
  const italics = new Set([fonts.italic]);
  const isLore = (l) => !blockFonts.has(l.runs.find((r) => r.text.trim()).font);

  /** A line's text with the italic runs wrapped in *...* (a word split over two runs is one). */
  const marked = (runs) => {
    let out = '';
    let open = false;
    for (const r of runs) {
      const t = clean(r.text);
      const italic = italics.has(r.font) && t.trim() !== '';
      if (italic && !open) {
        out += t.match(/^\s*/)[0] + '*' + t.trimStart();
        open = true;
      } else if (!italic && open && t.trim() !== '') {
        out = out.replace(/(\s*)$/, '*$1') + t;
        open = false;
      } else out += t;
    }
    if (open) out = out.replace(/(\s*)$/, '*$1');
    return out.replace(/\s+/g, ' ');
  };

  /** Joins wrapped lines: a word broken with a hyphen at the end of a line is put back together. */
  const joinLine = (a, b) => {
    if (!a) return b;
    if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
  };

  const out = [];
  for (let i = first; i < lines.length; i++) {
    const ac = lines[i].text.match(/^Armor Class (\d+)/);
    if (!ac) continue;
    // Name: walk back over the size/type/alignment line (it can wrap onto a second line).
    let n = i - 1;
    while (n > first && !SIZE.test(lines[n].text)) n--;
    const rawName = lines[n - 1].text;
    const name = RENAME[rawName] || rawName;
    const meta = lines
      .slice(n, i)
      .map((l) => l.text)
      .join(' ');
    const m = meta.match(/^(\S+) (.+), ([^,]+)$/);
    if (!m) throw new Error(`Cannot read the size/type line of "${name}": ${meta}`);

    const block = {
      id: slug(name),
      name,
      size: m[1],
      type: m[2],
      alignment: m[3],
      armorClass: lines[i].text.replace(/^Armor Class /, ''),
      ac: Number(ac[1]),
    };
    // The header fields, one per line (a long value wraps onto the next line).
    let j = i + 1;
    let field = 'armorClass';
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (isFooter(l) || isTitle(l)) continue;
      const t = l.text;
      let h;
      if ((h = t.match(/^Hit Points (\d+)(?: \(([^)]*)\))?/))) {
        block.hp = Number(h[1]);
        block.hitDice = h[2] ? h[2].replace(/\s+/g, '').toLowerCase() : `${h[1]}`;
        field = null;
      } else if (t.startsWith('Speed ')) {
        block.speed = t.slice(6);
        field = 'speed';
      } else if (/^STR\s*DEX\s*CON\s*INT\s*WIS\s*CHA$/.test(t)) {
        field = null;
      } else if (
        (h = t.match(
          /^(\d+) \([+-]?\d+\) (\d+) \([+-]?\d+\) (\d+) \([+-]?\d+\) (\d+) \([+-]?\d+\) (\d+) \([+-]?\d+\) (\d+) \([+-]?\d+\)$/,
        ))
      ) {
        const [str, dex, con, int, wis, cha] = h.slice(1).map(Number);
        Object.assign(block, { str, dex, con, int, wis, cha });
        field = null;
      } else if ((h = t.match(/^Challenge ([\d/]+) \(([\d,]+) XP\)/))) {
        block.challenge = h[1];
        block.cr = parseCr(h[1]);
        block.xp = Number(h[2].replace(/,/g, ''));
        j++;
        break;
      } else {
        // A field label can also start part-way along a line (the Wereboar's Senses).
        const parts = [];
        let from = 0;
        l.runs.forEach((r, x) => {
          if (x > 0 && r.font === fonts.label && FIELDS[r.text.trim()]) {
            parts.push(l.runs.slice(from, x));
            from = x;
          }
        });
        parts.push(l.runs.slice(from));
        for (const part of parts) {
          const pt = clean(part.map((r) => r.text).join('')).trim();
          const label = Object.keys(FIELDS).find((key) => pt.startsWith(key + ' '));
          if (label) {
            field = FIELDS[label];
            block[field] = pt.slice(label.length + 1);
          } else if (field) {
            block[field] = joinLine(block[field], pt);
          } else throw new Error(`Unexpected line in the header of "${name}": ${pt}`);
        }
      }
    }
    if (block.hp == null || block.dex == null || block.cr == null) {
      throw new Error(`Incomplete stat block for "${name}" near line ${i}`);
    }

    // Traits, then the Actions / Reactions / Legendary Actions sections, until the next creature.
    block.traits = [];
    let list = block.traits;
    let entry = null;
    let prev = null;
    let legendaryIntro = null;
    let lore = null;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (isFooter(l)) continue;
      if (isTitle(l) || isName(l)) break;
      if (lines[j + 1] && SIZE.test(lines[j + 1].text) && l.runs[0].font === fonts.heading) break;
      if (isSection(l)) {
        const key = SECTIONS[l.text];
        if (!key) break; // some other heading: the stat block is over
        block[key] = [];
        list = block[key];
        entry = null;
        prev = null;
        continue;
      }
      if (lore || isLore(l)) {
        // A description after the stat block: kept as paragraphs for the full page.
        const text = marked(l.runs).trim();
        const gap = !lore || prev.page !== l.page || prev.col !== l.col || prev.y - l.y > 13;
        if (!lore) lore = [];
        if (gap && (!lore.length || /[.:"]$/.test(lore.at(-1)))) lore.push(text);
        else lore[lore.length - 1] = joinLine(lore[lore.length - 1], text);
        prev = l;
        continue;
      }
      // A paragraph starts with a bold italic (sometimes just bold) name ending in a full stop, or
      // after a gap larger than a line.
      let k = 0;
      while (
        k < l.runs.length &&
        (l.runs[k].font === fonts.entry || l.runs[k].font === fonts.label)
      )
        k++;
      const head = clean(
        l.runs
          .slice(0, k)
          .map((r) => r.text)
          .join(''),
      ).trim();
      let rest = marked(l.runs.slice(k)).trim();
      // the full stop after the name is sometimes printed in the body font
      const dotAfter = k > 0 && !/\.$/.test(head) && rest.startsWith('.');
      if (dotAfter) rest = rest.slice(1).trim();
      const startsEntry = k > 0 && (/\.$/.test(head) || dotAfter);
      const gap = prev && (prev.page !== l.page || prev.col !== l.col || prev.y - l.y > 13);
      if (startsEntry) {
        entry = { name: head.replace(/\.$/, ''), text: rest };
        list.push(entry);
      } else if (!entry) {
        if (list === block.legendary)
          legendaryIntro = joinLine(legendaryIntro, marked(l.runs).trim());
        else throw new Error(`Text with no trait name in "${name}": ${l.text}`);
      } else if ((gap && /[.:]$/.test(entry.text)) || SPELL_LINE.test(l.text)) {
        entry.text += '\n' + marked(l.runs).trim();
      } else {
        entry.text = joinLine(entry.text, marked(l.runs).trim());
      }
      prev = l;
    }
    // "*misty* *step*" (an italic phrase wrapped over two lines) becomes "*misty step*".
    const tidy = (text) => text.replace(/\*( +)\*/g, '$1');
    for (const key of ['traits', 'actions', 'reactions', 'legendary']) {
      for (const e of block[key] || []) e.text = tidy(e.text);
    }
    if (legendaryIntro) legendaryIntro = tidy(legendaryIntro);
    if (lore) block.description = lore.map(tidy);
    if (block.legendary) {
      block.legendary = { intro: legendaryIntro || '', actions: block.legendary };
    }
    i = j - 1;
    out.push(block);
  }
  return out;
}

const monsters = parse(toLines(await pdfItems(input)));

const ids = new Set();
for (const c of monsters) {
  if (ids.has(c.id)) throw new Error(`Duplicate id ${c.id}`);
  ids.add(c.id);
}
monsters.sort((a, b) => a.name.localeCompare(b.name));
const short = monsters.map((c) => ({
  id: c.id,
  name: c.name,
  ac: c.ac,
  hp: c.hp,
  hitDice: c.hitDice,
  dex: c.dex,
  cr: c.cr,
}));
writeFileSync(join(outDir, 'srd-creatures.json'), JSON.stringify(short, null, 2) + '\n');
writeFileSync(join(outDir, 'srd-monsters.json'), JSON.stringify(monsters) + '\n');
console.log(`Wrote ${monsters.length} creatures to ${outDir}`);
