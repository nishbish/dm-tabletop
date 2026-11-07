// Builds one full Pathfinder 2e stat block (the shape of `Pf2eMonster` in src/statblock-pf2e.ts)
// from a Foundry VTT PF2e creature. Used by build-pf2e-creatures.mjs.
import { foundryText, traitLabel } from './pf2e-text.mjs';

const SIZES = {
  tiny: 'Tiny',
  sm: 'Small',
  med: 'Medium',
  lg: 'Large',
  huge: 'Huge',
  grg: 'Gargantuan',
};
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const GEAR = [
  'weapon',
  'armor',
  'shield',
  'equipment',
  'consumable',
  'ammo',
  'treasure',
  'backpack',
];

const words = (slug) => String(slug).replace(/-/g, ' ');
const capWords = (slug) => words(slug).replace(/\b[a-z]/g, (c) => c.toUpperCase());
const signed = (n) => (n >= 0 ? `+${n}` : `−${-n}`);
const ordinal = (n) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${s}`;
};

function sense(s) {
  let out = words(s.type);
  if (s.acuity && s.acuity !== 'precise') out += ` (${s.acuity})`;
  if (s.range) out += ` ${s.range} feet`;
  return out;
}

// "physical 5 (except silver)", "fire 10, double resistance vs. non-magical"
function iwr(list, withValue) {
  return (list || [])
    .map((x) => {
      let out = words(x.type);
      if (withValue && x.value != null) out += ` ${x.value}`;
      const exceptions = (x.exceptions || []).map((e) =>
        typeof e === 'string' ? words(e) : words(e.label || e.definition || ''),
      );
      if (exceptions.length) out += ` (except ${exceptions.join(' or ')})`;
      const double = (x.doubleVs || []).map(words);
      if (double.length) out += ` (double resistance vs. ${double.join(', ')})`;
      return out;
    })
    .join(', ');
}

function actionsOf(sys) {
  const type = sys.actionType && sys.actionType.value;
  if (type === 'action') return String((sys.actions && sys.actions.value) || 1);
  if (type === 'reaction' || type === 'free') return type;
  return undefined;
}

function ability(item) {
  const sys = item.system;
  const out = { name: item.name };
  const actions = actionsOf(sys);
  if (actions) out.actions = actions;
  const traits = (sys.traits && sys.traits.value) || [];
  if (traits.length) out.traits = traits.map(traitLabel);
  out.text = foundryText(sys.description && sys.description.value);
  return out;
}

function strike(item, byId) {
  const sys = item.system;
  const traits = ((sys.traits && sys.traits.value) || []).map(traitLabel);
  const ranged = !!sys.range || traits.some((t) => /^(range|thrown|range increment) /.test(t));
  const damage = Object.values(sys.damageRolls || {})
    .map((r) =>
      [r.damage, r.category === 'persistent' ? 'persistent' : r.category, r.damageType]
        .filter(Boolean)
        .join(' '),
    )
    .join(' plus ');
  const effects = ((sys.attackEffects && sys.attackEffects.value) || []).map((slug) => {
    const named = byId.get(slug);
    return named || capWords(slug);
  });
  return {
    kind: ranged ? 'Ranged' : 'Melee',
    name: item.name.toLowerCase(),
    bonus: sys.bonus.value,
    traits,
    damage: [damage, ...effects].filter(Boolean).join(' plus '),
  };
}

const ORDER = (label) => (label.startsWith('Cantrips') ? 1 : label.startsWith('Constant') ? 2 : 0);

function spellLists(items) {
  const entries = items.filter((i) => i.type === 'spellcastingEntry');
  return entries.map((entry) => {
    const sys = entry.system;
    const groups = new Map();
    for (const spell of items.filter(
      (i) => i.type === 'spell' && i.system.location && i.system.location.value === entry._id,
    )) {
      const s = spell.system;
      const rank = s.location.heightenedLevel || s.level.value;
      const cantrip = (s.traits.value || []).includes('cantrip');
      let name = spell.name;
      let constant = false;
      // "Tongues (Constant)" -> constant; other notes stay, lower case: "(at will)", "(self only)"
      name = name.replace(/\s*\(([^)]*)\)/g, (_, note) => {
        const notes = note
          .split(/[,;]\s*/)
          .filter((n) => {
            if (/^constant$/i.test(n.trim())) {
              constant = true;
              return false;
            }
            return true;
          })
          .map((n) => n.trim().toLowerCase());
        return notes.length ? ` (${notes.join(', ')})` : '';
      });
      const label = constant
        ? `Constant (${ordinal(rank)})`
        : cantrip
          ? `Cantrips (${ordinal(rank)})`
          : ordinal(rank);
      const key = `${ORDER(label)}|${String(99 - rank).padStart(2, '0')}|${label}`;
      if (!groups.has(key)) groups.set(key, { label, spells: [] });
      groups.get(key).spells.push(name.toLowerCase());
    }
    const ranks = Array.from(groups.keys())
      .sort()
      .map((k) => {
        const g = groups.get(k);
        // a spell prepared twice: "fireball (x2)"
        const counted = [];
        for (const s of g.spells) {
          const last = counted[counted.length - 1];
          if (last && last.name === s) last.n++;
          else counted.push({ name: s, n: 1 });
        }
        return {
          label: g.label,
          spells: counted.map((c) => (c.n > 1 ? `${c.name} (×${c.n})` : c.name)),
        };
      });
    const out = { name: entry.name };
    if (sys.spelldc && sys.spelldc.dc) out.dc = sys.spelldc.dc;
    if (sys.spelldc && sys.spelldc.value) out.attack = sys.spelldc.value;
    out.ranks = ranks;
    return out;
  });
}

export function fullBlock(j, id, slug, source) {
  const s = j.system;
  const a = s.attributes;
  const items = j.items || [];
  // "+2 to Sense Motive", "+2 Status to All Saves vs. Occult": Foundry's own helper entries for a
  // bonus the stat block already prints beside Perception or the saves
  const helper = (i) => /^[+\u2212-]\d/.test(i.name) && !foundryText(i.system.description.value);
  const actions = items.filter((i) => i.type === 'action' && !helper(i));
  // attack effects name an ability of the creature by its slug ("grab", "sinful-bite")
  const bySlug = new Map();
  for (const i of actions) {
    const key = i.system.slug || i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    bySlug.set(key, i.name);
  }

  const traits = (s.traits.value || []).map(traitLabel);
  const skills = Object.entries(s.skills || {})
    .map(([k, v]) => `${capWords(k)} ${signed(v.base)}`)
    .concat(
      items.filter((i) => i.type === 'lore').map((i) => `${i.name} ${signed(i.system.mod.value)}`),
    )
    .sort((x, y) => x.localeCompare(y));
  const gear = items
    .filter((i) => GEAR.includes(i.type))
    .map((i) => {
      const n = i.system.quantity;
      const name = i.name.toLowerCase();
      return n > 1 ? `${name} (${n})` : name;
    });
  const speeds = [`${a.speed.value} feet`]
    .concat((a.speed.otherSpeeds || []).map((o) => `${words(o.type)} ${o.value} feet`))
    .concat(a.speed.details ? [a.speed.details] : []);
  const languages = (s.details.languages.value || []).map(capWords);
  if (s.details.languages.details) languages.push(s.details.languages.details);

  const block = {
    id,
    slug,
    name: j.name,
    level: s.details.level.value,
    rarity: s.traits.rarity,
    size: SIZES[s.traits.size.value] || capWords(s.traits.size.value),
    traits,
    source,
    perception: s.perception.mod,
    perceptionNote: s.perception.details || '',
    senses: (s.perception.senses || []).map(sense).join(', '),
    languages: languages.join(', '),
    skills: skills.join(', '),
  };
  for (const k of ABILITIES) block[k] = s.abilities[k].mod;
  block.items = gear.join(', ');
  block.interactions = actions.filter((i) => i.system.category === 'interaction').map(ability);
  block.ac = a.ac.value;
  block.acNote = a.ac.details || '';
  block.fort = s.saves.fortitude.value;
  block.ref = s.saves.reflex.value;
  block.will = s.saves.will.value;
  block.saveNote = (a.allSaves && a.allSaves.value) || '';
  block.hp = a.hp.max;
  block.hpNote = a.hp.details || '';
  block.immunities = iwr(a.immunities, false);
  block.weaknesses = iwr(a.weaknesses, true);
  block.resistances = iwr(a.resistances, true);
  block.defenses = actions.filter((i) => i.system.category === 'defensive').map(ability);
  block.speed = speeds.join(', ');
  block.strikes = items.filter((i) => i.type === 'melee').map((i) => strike(i, bySlug));
  block.spells = spellLists(items);
  block.offenses = actions
    .filter((i) => !['interaction', 'defensive'].includes(i.system.category))
    .map(ability);
  return block;
}

// ---------- Reserved Material ----------
// Proper nouns of the Pathfinder setting are Reserved Material under the ORC License and must not
// be reproduced: deities, Pathfinder-specific planes, places and regional languages, named
// characters. Found by listing every capitalised word in the generated text (2026-11-07). Words
// that are also plain English or shared cosmology (Heaven, Hell, Universe, Ethereal Plane, Void
// as a damage type) are kept. `RESERVED_TEXT` must not appear anywhere after the edits below; the
// build fails if it does, so a new book or data update is caught.
export const RESERVED_TEXT =
  /\b(Pharasma|Desna|Magdh|Droskar|Rovagug|Dagon|Iovett|Reshmit|Thassilon\w*|Jistka\w*|Mwangi|Hallit|Vudrani|Golarion|Absalom|Boneyard|Nirvana|Elysium|Axis|Outer Rifts|Creation's Forge|Netherworld|Maelstrom Lore|Styx|Dis|Paizo|Kothogaz|Ulunat|Xotani|Chemnosit|Volnagur|Sorvuth-ka|Dead Roads)\b/;

// Creatures that are named individuals (two Spawn of Rovagug): left out entirely.
export const RESERVED_CREATURES = /^(Volnagur|Sorvuth-ka)$/i;

// [pattern, replacement] edits, applied to every text of a stat block, most specific first
const EDITS = [
  // Foundry editors' notes are not book text
  [/\s*\*?Note: A DC was not provided[^\n]*/g, ''],
  [/, like Desna, Magdh, or Pharasma,/g, ','],
  [
    / or have been judged to be redeemed by Pharasma\./g,
    ' or have been judged to be redeemed by the god of death.',
  ],
  [/invokes Droskar's name/g, "invokes their god's name"],
  [/ as defned by the ancient empire of Thassilon/g, ''],
  [/Energy from Creation's Forge erupts/g, 'Creative energy erupts'],
  [/ the endless chorus of the Outer Rifts/g, ' an endless, maddening chorus'],
  [/the Netherworld/g, 'the plane of shadow'],
  [/teleport to Nirvana or The Boneyard/g, 'teleport to the lands of the afterlife'],
  [/the Dead Roads that connect the Boneyard/g, 'the roads that connect the land of the dead'],
  [/\b[Tt]he Boneyard\b/g, 'the land of the dead'],
  [/\b[Tt]he Dead Roads\b/g, 'the roads of the dead'],
  [/ \(such as Jistkan\)/g, ''],
  [/Trident of Dis/g, 'Infernal Trident'],
];
const edit = (text) => EDITS.reduce((t, [re, to]) => t.replace(re, to), text || '');

const RESERVED_LANGUAGES = /^(Thassilonian|Hallit|Vudrani|Mwangi)$/;

/** Removes the setting's proper nouns; throws if any are left. */
export function scrub(block) {
  // lore skills about a reserved place or deity ("Boneyard Lore +11"), regional languages
  block.skills = block.skills
    .split(', ')
    .filter((s) => !RESERVED_TEXT.test(s))
    .join(', ');
  block.languages = block.languages
    .split(', ')
    .filter((l) => !RESERVED_LANGUAGES.test(l))
    .map(edit)
    .join(', ');
  for (const key of ['interactions', 'defenses', 'offenses']) {
    for (const a of block[key]) {
      a.name = edit(a.name);
      a.text = edit(a.text);
      // a whole description about named patrons: the name stays, the text goes
      if (/Forsaken patron/.test(a.text)) a.text = '';
    }
  }
  for (const s of block.strikes) {
    s.name = edit(s.name);
    s.damage = edit(s.damage);
  }
  for (const key of [
    'items',
    'senses',
    'perceptionNote',
    'saveNote',
    'hpNote',
    'acNote',
    'speed',
  ]) {
    block[key] = edit(block[key]);
  }
  for (const entry of block.spells) {
    entry.name = edit(entry.name);
    for (const r of entry.ranks) r.spells = r.spells.map(edit);
  }
  const json = JSON.stringify(block);
  const left = RESERVED_TEXT.exec(json);
  if (left && process.env.RESERVED_REPORT) {
    const all = new RegExp(RESERVED_TEXT.source, 'g');
    for (const m of json.matchAll(all))
      console.log(
        `${block.name} | ${m[1]} | ${json.slice(Math.max(0, m.index - 70), m.index + 40)}`,
      );
  } else if (left) {
    const at = json.slice(Math.max(0, left.index - 80), left.index + 40);
    throw new Error(
      `${block.name}: Reserved Material "${left[1]}" is still in the stat block: ${at}`,
    );
  }
  return block;
}
