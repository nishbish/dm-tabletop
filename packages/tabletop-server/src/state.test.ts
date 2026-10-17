import { describe, expect, it } from 'vitest';
import { createEmptyState, migrate } from './state';

describe('migrate', () => {
  it('passes current-version states through', () => {
    const state = createEmptyState('x');
    expect(migrate(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('rejects states it cannot understand', () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate({ name: 'no version' })).toThrow();
    expect(() => migrate({ version: 999 })).toThrow(/newer/);
  });
});
