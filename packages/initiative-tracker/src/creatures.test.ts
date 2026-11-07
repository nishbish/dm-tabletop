import { describe, expect, it } from 'vitest';
import {
  defaultCreatures,
  initiativeBonusFromDex,
  pf2eCreatures,
  searchCreatures,
  srdCreatures,
} from './creatures';

describe('built-in Pathfinder creature data (Monster Core, ORC License)', () => {
  it('is well formed, with unique ids that do not clash with the SRD ones', () => {
    const ids = new Set(srdCreatures.map((c) => c.id));
    for (const c of pf2eCreatures) {
      expect(c.id).toMatch(/^pf2e-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.ruleset).toBe('PF2e');
      for (const key of ['ac', 'hp', 'initiativeBonus', 'level'] as const) {
        expect(Number.isInteger(c[key])).toBe(true);
      }
      expect(c.hp).toBeGreaterThan(0);
      expect(c.hitDice).toBeUndefined(); // Pathfinder creatures have fixed hit points
    }
    expect(pf2eCreatures.length).toBeGreaterThan(850);
    expect(defaultCreatures.length).toBe(srdCreatures.length + pf2eCreatures.length);
  });

  it('leaves out names that are Reserved Material (deities, planes, places, named characters)', () => {
    const names = pf2eCreatures.map((c) => c.name).join('|');
    for (const reserved of [
      'Pharasma',
      'Leng',
      'Tindalos',
      'Treerazer',
      'Grisantian',
      'Shade (',
      // unique creatures (named individuals)
      'Volnagur',
      'Sorvuth-Ka',
      'Grim Reaper',
    ]) {
      expect(names).not.toContain(reserved);
    }
  });

  it('matches the book for a sample creature', () => {
    expect(pf2eCreatures.find((c) => c.name === 'Goblin Warrior')).toMatchObject({
      id: 'pf2e-goblin-warrior',
      ac: 16,
      hp: 6,
      initiativeBonus: 2,
      level: -1,
    });
  });
});

describe('built-in SRD 5.1 creature data', () => {
  it('is well formed', () => {
    const ids = new Set<string>();
    for (const c of srdCreatures) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      for (const key of ['ac', 'hp', 'dex', 'cr'] as const) {
        expect(typeof c[key]).toBe('number');
        expect(isFinite(c[key])).toBe(true);
      }
      expect(c.ac).toBeGreaterThan(0);
      expect(c.hp).toBeGreaterThan(0);
      expect(c.dex).toBeGreaterThanOrEqual(1);
      expect(c.dex).toBeLessThanOrEqual(30);
      expect(c.hitDice).toMatch(/^\d+d\d+([+-]\d+)?$/);
    }
  });

  it('has about as many creatures as the SRD', () => {
    expect(srdCreatures.length).toBeGreaterThanOrEqual(300);
    expect(srdCreatures.length).toBeLessThanOrEqual(340);
  });

  it('has hit points that match the hit dice', () => {
    for (const c of srdCreatures) {
      const m = c.hitDice.match(/^(\d+)d(\d+)([+-]\d+)?$/);
      const average = Math.floor((Number(m[1]) * (Number(m[2]) + 1)) / 2) + Number(m[3] || 0);
      expect(Math.abs(average - c.hp), c.name).toBeLessThanOrEqual(1);
    }
  });

  it('does not contain creatures that are not in the SRD', () => {
    const present = new Set(srdCreatures.map((c) => c.name.toLowerCase()));
    for (const name of [
      'Beholder',
      'Beholder Zombie',
      'Abominable Yeti',
      'Yeti',
      'Adult Blue Dracolich',
      'Aarakocra',
      'Mind Flayer',
      'Displacer Beast',
      'Githyanki Warrior',
      'Death Knight',
    ]) {
      expect(present.has(name.toLowerCase()), name).toBe(false);
    }
  });

  it('has some well-known SRD entries with their book values', () => {
    const byName = (n: string) => srdCreatures.find((c) => c.name === n);
    expect(byName('Goblin')).toMatchObject({ ac: 15, hp: 7, hitDice: '2d6', dex: 14, cr: 0.25 });
    expect(byName('Tarrasque')).toMatchObject({ ac: 25, hp: 676, cr: 30 });
  });
});

describe('initiativeBonusFromDex', () => {
  it('is floor((dex - 10) / 2)', () => {
    expect([1, 8, 9, 10, 11, 14, 15, 20, 30].map(initiativeBonusFromDex)).toEqual([
      -5, -1, -1, 0, 0, 2, 2, 5, 10,
    ]);
  });
});

describe('searchCreatures', () => {
  it('lists prefix matches before substring matches, ignoring case', () => {
    const found = searchCreatures(srdCreatures, 'GOB', 20).map((c) => c.name);
    expect(found[0]).toBe('Goblin');
    const dragons = searchCreatures(srdCreatures, 'red dragon', 50).map((c) => c.name);
    expect(dragons[0]).toMatch(/^Red Dragon/);
    expect(dragons).toContain('Adult Red Dragon');
  });

  it('returns nothing for blank text and caps the count', () => {
    expect(searchCreatures(srdCreatures, '  ')).toEqual([]);
    expect(searchCreatures(srdCreatures, 'a', 5)).toHaveLength(5);
  });
});
