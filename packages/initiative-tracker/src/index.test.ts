import { describe, expect, it } from 'vitest';
import { initiativeTrackerName } from './index';

describe('initiative-tracker', () => {
  it('exposes its package name', () => {
    expect(initiativeTrackerName()).toBe('initiative-tracker');
  });
});
