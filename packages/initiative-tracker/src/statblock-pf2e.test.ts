import { describe, expect, it } from 'vitest';
import monsters from './data/pf2e-monsters.json';
import { pf2eCreatures } from './creatures';
import { Pf2eMonster, renderAnyStatBlock, renderPf2eStatBlock } from './statblock';
// plain JavaScript build script helpers (no type declarations)
import {
  checkText,
  damageText,
  foundryText,
  templateText,
  traitLabel,
} from '../scripts/pf2e-text.mjs';
import { RESERVED_TEXT } from '../scripts/pf2e-block.mjs';

const all = monsters as unknown as Pf2eMonster[];
const bySlug = (slug: string) => all.find((m) => m.slug === slug);

describe('Pathfinder stat blocks', () => {
  it('has one for every Pathfinder creature of the tracker list, with the same numbers', () => {
    expect(all.length).toBe(pf2eCreatures.length);
    for (const c of pf2eCreatures) {
      const m = all.find((x) => x.id === c.id);
      expect(m, c.id).toBeTruthy();
      expect([m.name, m.ac, m.hp, m.perception, m.level]).toEqual([
        c.name,
        c.ac,
        c.hp,
        c.initiativeBonus,
        c.level,
      ]);
      expect(m.id).toBe('pf2e-' + m.slug);
    }
  });

  it('holds no Reserved Material of the setting', () => {
    expect(RESERVED_TEXT.exec(JSON.stringify(all))).toBeNull();
    for (const name of ['Volnagur', 'Sorvuth-Ka', 'Treerazer', 'Grim Reaper']) {
      expect(all.find((m) => m.name === name)).toBeUndefined();
    }
  });

  // From the Foundry VTT PF2e data (Monster Core, ORC entries)
  it('reads the Goblin Warrior', () => {
    const m = bySlug('goblin-warrior');
    expect(m).toMatchObject({
      name: 'Goblin Warrior',
      level: -1,
      size: 'Small',
      traits: ['goblin', 'humanoid'],
      source: 'Monster Core',
      perception: 2,
      senses: 'darkvision',
      skills: 'Acrobatics +5, Athletics +2, Nature +1, Stealth +5',
      ac: 16,
      fort: 5,
      ref: 7,
      will: 3,
      hp: 6,
      speed: '25 feet',
    });
    expect(m.strikes[0]).toEqual({
      kind: 'Melee',
      name: 'dogslicer',
      bonus: 7,
      traits: ['agile', 'backstabber', 'finesse'],
      damage: '1d6 slashing',
    });
    expect(m.strikes[1]).toMatchObject({ kind: 'Ranged', name: 'shortbow' });
    expect(m.defenses[0]).toEqual({
      name: 'Goblin Scuttle',
      actions: 'reaction',
      text: '**Trigger** A goblin ally ends a move action adjacent to the goblin.\n**Effect** The goblin warrior Steps.',
    });
  });

  it('reads an adult dragon: spells, area damage and saves in the text', () => {
    const m = bySlug('conspirator-dragon-adult');
    expect(m.perceptionNote).toBe('(+25 to Sense Motive)');
    expect(m.saveNote).toBe('+2 status to all saves vs. occult');
    expect(m.immunities).toBe('controlled, paralyzed, sleep');
    expect(m.spells[0]).toMatchObject({ name: 'Occult Innate Spells', dc: 32, attack: 24 });
    const detonate = m.offenses.find((a) => a.name === 'Detonate Disguise');
    expect(detonate.actions).toBe('2');
    expect(detonate.text).toContain(
      'deals 13d6 bludgeoning damage to creatures in a 5-foot emanation with a DC 31 basic Reflex save',
    );
    // Foundry's helper entries for printed bonuses are left out
    expect(m.defenses.map((a) => a.name)).toEqual(['Retract Body']);
  });
});

describe('Foundry text', () => {
  it('turns damage, checks and areas into words', () => {
    expect(damageText('(2d6+4)[fire],1d6[persistent,fire]|options:x')).toBe(
      '2d6+4 fire plus 1d6 persistent fire',
    );
    expect(checkText('reflex|dc:31|basic|options:area-effect')).toBe('DC 31 basic Reflex');
    expect(checkText('athletics|dc:20')).toBe('DC 20 Athletics');
    expect(templateText('cone|distance:50')).toBe('50-foot cone');
    expect(traitLabel('reach-10')).toBe('reach 10 feet');
    expect(traitLabel('deadly-d10')).toBe('deadly d10');
  });

  it('keeps bold, italic and paragraphs and drops the rest', () => {
    expect(
      foundryText(
        '<p><strong>Trigger</strong> A foe is @UUID[Compendium.pf2e.conditionitems.Item.Off-Guard].</p><hr /><p><strong>Effect</strong> Deals @Damage[2d6[fire]] (@Check[will|dc:20]) for [[/gmr 1d4 #Recharge]]{1d4 rounds}.</p><p>@Localize[PF2E.NPC.Abilities.Glossary.Grab]</p>',
      ),
    ).toBe(
      '**Trigger** A foe is Off-Guard.\n**Effect** Deals 2d6 fire (DC 20 Will) for 1d4 rounds.',
    );
    expect(foundryText('<p>Cast <em>fireball</em> <span class="action-glyph">2</span></p>')).toBe(
      'Cast *fireball* [two-actions]',
    );
  });
});

describe('renderPf2eStatBlock', () => {
  it('draws the stat block in the book order', () => {
    const html = renderPf2eStatBlock(bySlug('goblin-warrior'), { headingLevel: 1, headingId: 'x' });
    expect(html).toContain('<h1 class="sb-name" id="x">Goblin Warrior</h1>');
    expect(html).toContain('Creature −1');
    expect(html).toContain('<li class="sb-tag sb-tag-size">Small</li>');
    expect(html).toContain('<dt>Perception</dt> <dd>+2; darkvision</dd>');
    expect(html).toContain('<strong>Fort</strong> +5');
    expect(html).toContain('aria-label="Reaction"');
    expect(html).toContain('<strong>Trigger</strong> A goblin ally');
    expect(html).toContain(
      '<strong>Melee</strong> <span class="sb-act" role="img" aria-label="Single Action"',
    );
    const order = ['Perception', 'Skills', '<dt>AC</dt>', 'Goblin Scuttle', 'Speed', 'Melee'];
    const at = order.map((t) => html.indexOf(t));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('is chosen by renderAnyStatBlock for a pf2e id, and escapes', () => {
    const m = { ...bySlug('goblin-warrior'), name: '<b>x</b>' };
    const html = renderAnyStatBlock(m);
    expect(html).toContain('sb-pf2e');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
