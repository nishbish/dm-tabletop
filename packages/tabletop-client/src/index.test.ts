import { describe, expect, it } from 'vitest';
import { tabletopClientName } from './index';

describe('tabletop-client', () => {
  it('exposes its package name', () => {
    expect(tabletopClientName()).toBe('tabletop-client');
  });
});
