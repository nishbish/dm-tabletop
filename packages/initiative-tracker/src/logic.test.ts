import { describe, expect, it } from 'vitest';
import {
  addRow,
  applyHpInput,
  clear,
  createState,
  migrate,
  moveRow,
  nextTurn,
  removeRow,
  resetRound,
  rollInitiative,
  sortByInitiative,
} from './logic';
import { TrackerState } from './types';

function withRows(specs: Array<[string, number, number?]>): TrackerState {
  let s = createState();
  for (const [name, initiative, bonus] of specs) {
    s = addRow(s, { name, initiative, initiativeBonus: bonus || 0 }, name);
  }
  return s;
}
const names = (s: TrackerState) => s.rows.map((r) => r.name);

describe('sortByInitiative', () => {
  it('orders highest first', () => {
    expect(
      names(
        sortByInitiative(
          withRows([
            ['a', 5],
            ['b', 18],
            ['c', 11],
          ]),
        ),
      ),
    ).toEqual(['b', 'c', 'a']);
  });

  it('is stable for equal initiative and bonus', () => {
    const s = withRows([
      ['a', 10],
      ['b', 10],
      ['c', 10],
      ['d', 12],
    ]);
    expect(names(sortByInitiative(s))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('breaks ties with the higher bonus, then original order', () => {
    const s = withRows([
      ['a', 10, 1],
      ['b', 10, 4],
      ['c', 10, 4],
      ['d', 10, 0],
    ]);
    expect(names(sortByInitiative(s))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('does not mutate its input', () => {
    const s = withRows([
      ['a', 1],
      ['b', 2],
    ]);
    sortByInitiative(s);
    expect(names(s)).toEqual(['a', 'b']);
  });

  it('keeps the active creature active once combat has started', () => {
    let s = withRows([
      ['a', 1],
      ['b', 20],
      ['c', 10],
    ]);
    s = { ...s, turn: 0, round: 2 }; // a is active in round 2
    const sorted = sortByInitiative(s);
    expect(names(sorted)).toEqual(['b', 'c', 'a']);
    expect(sorted.rows[sorted.turn].name).toBe('a');
  });

  it('starts at the top before combat has started', () => {
    expect(
      sortByInitiative(
        withRows([
          ['a', 1],
          ['b', 20],
        ]),
      ).turn,
    ).toBe(0);
  });
});

describe('nextTurn', () => {
  it('advances, then wraps and increments the round', () => {
    let s = withRows([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    s = nextTurn(s);
    expect([s.turn, s.round]).toEqual([1, 1]);
    s = nextTurn(s);
    expect([s.turn, s.round]).toEqual([2, 1]);
    s = nextTurn(s);
    expect([s.turn, s.round]).toEqual([0, 2]);
  });

  it('with one row, every press is a new round', () => {
    let s = withRows([['a', 3]]);
    s = nextTurn(s);
    expect([s.turn, s.round]).toEqual([0, 2]);
    s = nextTurn(s);
    expect([s.turn, s.round]).toEqual([0, 3]);
  });

  it('with no rows, nothing changes', () => {
    const s = createState();
    expect(nextTurn(s)).toEqual(s);
  });
});

describe('resetRound, clear, removeRow, moveRow', () => {
  it('resetRound goes back to round 1, first turn', () => {
    const s = resetRound({
      ...withRows([
        ['a', 1],
        ['b', 2],
      ]),
      round: 5,
      turn: 1,
    });
    expect([s.round, s.turn]).toEqual([1, 0]);
  });

  it('clear removes rows and resets, keeping the name', () => {
    const s = clear({ ...withRows([['a', 1]]), name: 'Ambush', round: 3 });
    expect(s).toMatchObject({ name: 'Ambush', rows: [], round: 1, turn: 0 });
  });

  it('removeRow keeps the active creature active', () => {
    const s = {
      ...withRows([
        ['a', 3],
        ['b', 2],
        ['c', 1],
      ]),
      turn: 2,
    };
    const r = removeRow(s, 'a');
    expect(r.rows[r.turn].name).toBe('c');
  });

  it('removeRow of the active last row wraps the turn to the top', () => {
    const s = {
      ...withRows([
        ['a', 3],
        ['b', 2],
      ]),
      turn: 1,
    };
    expect(removeRow(s, 'b').turn).toBe(0);
  });

  it('removeRow of an unknown id changes nothing', () => {
    const s = withRows([['a', 1]]);
    expect(removeRow(s, 'zzz')).toBe(s);
  });

  it('moveRow swaps neighbours and ignores moves off the ends', () => {
    const s = withRows([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    expect(names(moveRow(s, 'c', -1))).toEqual(['a', 'c', 'b']);
    expect(names(moveRow(s, 'a', -1))).toEqual(['a', 'b', 'c']);
    expect(names(moveRow(s, 'c', 1))).toEqual(['a', 'b', 'c']);
  });

  it('moveRow keeps the active creature active', () => {
    const s = {
      ...withRows([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
      turn: 1,
    };
    const m = moveRow(s, 'c', -2);
    expect(m.rows[m.turn].name).toBe('b');
  });
});

describe('rollInitiative', () => {
  it('maps the rng onto 1..20 and adds the bonus', () => {
    expect(rollInitiative(0, () => 0)).toBe(1);
    expect(rollInitiative(0, () => 0.999999)).toBe(20);
    expect(rollInitiative(3, () => 0.5)).toBe(14);
    expect(rollInitiative(-2, () => 0.5)).toBe(9);
  });

  it('never exceeds 20 + bonus even if the rng returns 1', () => {
    expect(rollInitiative(2, () => 1)).toBe(22);
  });

  it('stays in range with the real rng', () => {
    for (let i = 0; i < 500; i++) {
      const v = rollInitiative(4);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(24);
    }
  });
});

describe('applyHpInput', () => {
  it('applies relative changes, clamped to 0 and max', () => {
    expect(applyHpInput('-5', 12, 20)).toEqual({ hp: 7, maxHp: 20 });
    expect(applyHpInput('+3', 12, 20)).toEqual({ hp: 15, maxHp: 20 });
    expect(applyHpInput('-50', 12, 20).hp).toBe(0);
    expect(applyHpInput('+50', 12, 20).hp).toBe(20);
    expect(applyHpInput('+50', 12, 0).hp).toBe(62);
  });

  it('sets absolute values and raises max when needed', () => {
    expect(applyHpInput('8', 12, 20)).toEqual({ hp: 8, maxHp: 20 });
    expect(applyHpInput('30', 12, 20)).toEqual({ hp: 30, maxHp: 30 });
  });

  it('ignores junk', () => {
    expect(applyHpInput('abc', 12, 20)).toEqual({ hp: 12, maxHp: 20 });
    expect(applyHpInput('', 12, 20)).toEqual({ hp: 12, maxHp: 20 });
  });
});

describe('migrate', () => {
  it('returns a fresh state for junk', () => {
    expect(migrate(null).rows).toEqual([]);
    expect(migrate('x').version).toBe(1);
    expect(migrate(42).round).toBe(1);
  });

  it('keeps a valid state unchanged', () => {
    const s = addRow(
      createState(),
      { name: 'Orc', hp: 15, maxHp: 15, ac: 13, monsterId: 'orc' },
      'x1',
    );
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('fills in missing fields and fixes bad ones', () => {
    const s = migrate({
      round: 0,
      turn: 99,
      rows: [{ name: 'A', hp: '7', initiative: 'x' }, null, { id: 'dup' }, { id: 'dup', ac: -4 }],
    });
    expect(s.version).toBe(1);
    expect(s.round).toBe(1);
    expect(s.rows).toHaveLength(3);
    expect(s.turn).toBe(2);
    expect(s.rows[0]).toMatchObject({ name: 'A', hp: 7, maxHp: 7, initiative: 0, ac: 10 });
    expect(new Set(s.rows.map((r) => r.id)).size).toBe(3);
    expect(s.rows[2].ac).toBe(0);
  });

  it('accepts a state with no version', () => {
    expect(migrate({ name: 'Old', rows: [] }).name).toBe('Old');
  });
});
