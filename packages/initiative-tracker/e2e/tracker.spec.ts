import { expect, test, Page } from '@playwright/test';

async function addCreature(page: Page, typed: string, option: string) {
  await page.getByRole('button', { name: 'Add creature' }).click();
  const names = page.locator('input.it-name');
  const field = names.last();
  await field.fill(typed);
  await page.getByRole('option', { name: option }).first().click();
}

test('add, roll, sort, next, and restore after reload', async ({ page }) => {
  await page.goto('/');

  await addCreature(page, 'gobl', 'Goblin');
  await addCreature(page, 'ogre', 'Ogre');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  // Autocomplete filled the stats (SRD goblin: AC 15, 7 HP).
  await expect(page.getByLabel(/^Armor class, Goblin/)).toHaveValue('15');
  await expect(page.getByLabel(/^Hit points, Goblin/)).toHaveValue('7');

  await page.getByRole('button', { name: 'Roll all initiatives' }).click();
  await page.getByRole('button', { name: 'Sort by initiative' }).click();

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.it-round-num')).toHaveText('1');

  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(1)).toContainText('Turn');
  await expect(page.locator('.it-turn')).toContainText('Round 1, turn:');

  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(page.locator('.it-round-num')).toHaveText('2');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');

  // Autosave is debounced; wait for it to land in localStorage before reloading.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('it-tracker:enc:_last_session')))
    .toContain('"round":2');

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('.it-round-num')).toHaveText('2');
  await expect(page.getByLabel(/^Armor class, /).first()).not.toHaveValue('');
  await expect(page.locator('tbody tr').first()).toHaveAttribute('aria-current', 'true');
});
