import { describe, expect, it } from 'vitest';
import monsters from './data/srd-monsters.json';
import { srdCreatures } from './creatures';
import { abilityModifier, Monster, renderStatBlock, SRD_CREDIT_HTML } from './statblock';

const all = monsters as Monster[];
const byId = (id: string) => all.find((m) => m.id === id);
const names = (list: { name: string }[] = []) => list.map((e) => e.name);

describe('SRD stat blocks', () => {
  it('has every creature of the short list, with the same numbers', () => {
    expect(all).toHaveLength(317);
    expect(all.map((m) => m.id)).toEqual(srdCreatures.map((c) => c.id));
    for (const c of srdCreatures) {
      const m = byId(c.id);
      expect([m.name, m.ac, m.hp, m.hitDice, m.dex, m.cr]).toEqual([
        c.name,
        c.ac,
        c.hp,
        c.hitDice,
        c.dex,
        c.cr,
      ]);
    }
  });

  it('keeps only SRD creatures (no beholder, mind flayer and the like)', () => {
    for (const id of [
      'beholder',
      'mind-flayer',
      'displacer-beast',
      'githyanki-warrior',
      'yuan-ti',
    ]) {
      expect(byId(id)).toBeUndefined();
    }
  });

  // Each value below was read off the printed stat block in SRD_CC_v5.1.pdf.
  it('matches the PDF: Aboleth (page 261)', () => {
    expect(byId('aboleth')).toMatchObject({
      size: 'Large',
      type: 'aberration',
      alignment: 'lawful evil',
      armorClass: '17 (natural armor)',
      hp: 135,
      hitDice: '18d10+36',
      speed: '10 ft., swim 40 ft.',
      str: 21,
      dex: 9,
      con: 15,
      int: 18,
      wis: 15,
      cha: 18,
      saves: 'Con +6, Int +8, Wis +6',
      skills: 'History +12, Perception +10',
      senses: 'darkvision 120 ft., passive Perception 20',
      languages: 'Deep Speech, telepathy 120 ft.',
      challenge: '10',
      xp: 5900,
    });
    const m = byId('aboleth');
    expect(names(m.traits)).toEqual(['Amphibious', 'Mucous Cloud', 'Probing Telepathy']);
    expect(m.traits[0].text).toBe('The aboleth can breathe air and water.');
    expect(names(m.actions)).toEqual(['Multiattack', 'Tentacle', 'Tail', 'Enslave (3/Day)']);
    expect(m.actions[0].text).toBe('The aboleth makes three tentacle attacks.');
    expect(names(m.legendary.actions)).toEqual([
      'Detect',
      'Tail Swipe',
      'Psychic Drain (Costs 2 Actions)',
    ]);
  });

  it('matches the PDF: Goblin (page 315)', () => {
    const m = byId('goblin');
    expect(m).toMatchObject({
      size: 'Small',
      type: 'humanoid (goblinoid)',
      alignment: 'neutral evil',
      armorClass: '15 (leather armor, shield)',
      hp: 7,
      hitDice: '2d6',
      speed: '30 ft.',
      skills: 'Stealth +6',
      senses: 'darkvision 60 ft., passive Perception 9',
      languages: 'Common, Goblin',
      challenge: '1/4',
      cr: 0.25,
      xp: 50,
    });
    expect([m.str, m.dex, m.con, m.int, m.wis, m.cha]).toEqual([8, 14, 10, 10, 8, 8]);
    expect(m.traits).toEqual([
      {
        name: 'Nimble Escape',
        text: 'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.',
      },
    ]);
    expect(m.actions).toEqual([
      {
        name: 'Scimitar',
        text: '*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 5 (1d6 + 2) slashing damage.',
      },
      {
        name: 'Shortbow',
        text: '*Ranged Weapon Attack:* +4 to hit, range 80/320 ft., one target. *Hit:* 5 (1d6 + 2) piercing damage.',
      },
    ]);
    expect(m.legendary).toBeUndefined();
  });

  it('matches the PDF: Adult Red Dragon (page 287), a value wrapped onto a second line', () => {
    const m = byId('adult-red-dragon');
    expect(m).toMatchObject({
      size: 'Huge',
      hp: 256,
      hitDice: '19d12+133',
      speed: '40 ft., climb 40 ft., fly 80 ft.',
      saves: 'Dex +6, Con +13, Wis +7, Cha +11',
      damageImmunities: 'fire',
      senses: 'blindsight 60 ft., darkvision 120 ft., passive Perception 23',
      challenge: '17',
      xp: 18000,
    });
    expect(names(m.traits)).toEqual(['Legendary Resistance (3/Day)']);
    expect(m.actions[0]).toEqual({
      name: 'Multiattack',
      text: 'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.',
    });
    expect(m.legendary.intro).toMatch(/^The dragon can take 3 legendary actions/);
  });

  it('matches the PDF: Lich (page 325)', () => {
    const m = byId('lich');
    expect(m).toMatchObject({
      alignment: 'any evil alignment',
      damageResistances: 'cold, lightning, necrotic',
      damageImmunities: 'poison; bludgeoning, piercing, and slashing from nonmagical attacks',
      conditionImmunities: 'charmed, exhaustion, frightened, paralyzed, poisoned',
      senses: 'truesight 120 ft., passive Perception 19',
      languages: 'Common plus up to five other languages',
      xp: 33000,
    });
    expect(names(m.traits).slice(0, 2)).toEqual(['Legendary Resistance (3/Day)', 'Rejuvenation']);
  });

  it('matches the PDF: Mage (page 400), one paragraph per line of the spell list', () => {
    const m = byId('mage');
    expect(m.armorClass).toBe('12 (15 with mage armor)');
    const lines = m.traits.find((t) => t.name === 'Spellcasting').text.split('\n');
    expect(lines[0]).toMatch(/^The mage is a 9th-level spellcaster\./);
    expect(lines.slice(1, 4)).toEqual([
      'Cantrips (at will): *fire bolt*, *light*, *mage hand*, *prestidigitation*',
      '1st level (4 slots): *detect magic*, *mage armor*, *magic missile*, *shield*',
      '2nd level (3 slots): *misty step*, *suggestion*',
    ]);
  });

  it('reads the odd layouts: a label part-way along a line, a full stop in the body font', () => {
    expect(byId('wereboar').senses).toBe('passive Perception 12');
    expect(byId('werebear').armorClass).toBe(
      '10 in humanoid form, 11 (natural armor) in bear and hybrid form',
    );
    expect(byId('clay-golem').traits[0].name).toBe('Acid Absorption');
    expect(byId('basilisk').traits[0].name).toBe('Petrifying Gaze');
    expect(byId('swarm-of-bats').languages).toBe('—');
  });

  it('keeps the description printed after a stat block apart from it', () => {
    const m = byId('acolyte');
    expect(m.description[0]).toMatch(/^Acolytes are junior members of a clergy/);
    expect(names(m.actions)).toEqual(['Club']);
    expect(m.actions[0].text).not.toMatch(/Acolytes/);
  });
});

describe('renderStatBlock', () => {
  it('renders the parts in order, with italics and the minus sign', () => {
    const html = renderStatBlock(byId('goblin'), { headingLevel: 1, headingId: 'x' });
    expect(html).toContain('<h1 class="sb-name" id="x">Goblin</h1>');
    expect(html).toContain('<em>Small humanoid (goblinoid), neutral evil</em>');
    expect(html).toContain('<dt>Hit Points</dt> <dd>7 (2d6)</dd>');
    expect(html).toContain('<dt>STR</dt><dd>8 (−1)</dd>');
    expect(html).toContain('<dt>Challenge</dt> <dd>1/4 (50 XP)</dd>');
    expect(html).toContain('<h2 class="sb-section">Actions</h2>');
    expect(html).toContain('<strong><em>Scimitar.</em></strong> <em>Melee Weapon Attack:</em> +4');
    expect(html.indexOf('Nimble Escape')).toBeLessThan(html.indexOf('Actions'));
  });

  it('formats hit dice with spaces and thousands in XP', () => {
    const html = renderStatBlock(byId('adult-red-dragon'));
    expect(html).toContain('<dd>256 (19d12 + 133)</dd>');
    expect(html).toContain('17 (18,000 XP)');
    expect(html).toContain('<h3 class="sb-section">Legendary Actions</h3>');
  });

  it('escapes the text', () => {
    const m = {
      ...byId('goblin'),
      name: '<b>x</b>',
      traits: [{ name: 'A&B', text: '<i>"hi"</i>' }],
    };
    const html = renderStatBlock(m);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('A&amp;B.');
    expect(html).toContain('&lt;i&gt;&quot;hi&quot;&lt;/i&gt;');
  });

  it('shows the description only when asked', () => {
    expect(renderStatBlock(byId('acolyte'))).not.toContain('junior members');
    expect(renderStatBlock(byId('acolyte'), { description: true })).toContain('junior members');
  });

  it('modifiers and the credit line', () => {
    expect([1, 9, 10, 11, 30].map(abilityModifier)).toEqual(['−5', '−1', '+0', '+0', '+10']);
    expect(SRD_CREDIT_HTML).toContain('creativecommons.org/licenses/by/4.0');
    expect(SRD_CREDIT_HTML).toContain('Wizards of the Coast');
  });
});
