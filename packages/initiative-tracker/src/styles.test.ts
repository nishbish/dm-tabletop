import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { css, themeVariables } from './styles';

describe('theme variables', () => {
  it('are all documented in the README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const v of themeVariables) expect(readme).toContain('`--it-' + v.name + '`');
  });

  it('are read from the public name with a built-in fallback, in both palettes', () => {
    for (const v of themeVariables) {
      expect(css).toContain(`--_${v.name}: var(--it-${v.name}, ${v.light});`);
      expect(css).toContain(`--_${v.name}: var(--it-${v.name}, ${v.dark});`);
    }
  });

  it('follows the system colour scheme', () => {
    expect(css).toContain('prefers-color-scheme: dark');
  });

  it('uses no literal colours outside the variable table', () => {
    const rules = css.replace(/--_[a-z-]+: var\([^;]*\);/g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
