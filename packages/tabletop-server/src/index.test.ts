import { describe, expect, it } from 'vitest';
import { tabletopServerName } from './index';

describe('tabletop-server', () => {
  it('exposes its package name', () => {
    expect(tabletopServerName()).toBe('tabletop-server');
  });
});
