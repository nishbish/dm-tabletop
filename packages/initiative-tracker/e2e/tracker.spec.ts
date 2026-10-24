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
  await expect(page.locator('.it-row')).toHaveCount(2);
  // Autocomplete filled the stats (SRD goblin: AC 15, 7 HP).
  await expect(page.getByLabel(/^Armor class, Goblin/)).toHaveValue('15');
  await expect(page.getByLabel(/^Hit points, Goblin/)).toHaveValue('7');

  await page.getByRole('button', { name: 'Roll all initiatives' }).click();
  await page.getByRole('button', { name: 'Sort by initiative' }).click();

  const rows = page.locator('.it-row');
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
  await expect(page.locator('.it-row')).toHaveCount(2);
  await expect(page.locator('.it-round-num')).toHaveText('2');
  await expect(page.getByLabel(/^Armor class, /).first()).not.toHaveValue('');
  await expect(page.locator('.it-row').first()).toHaveAttribute('aria-current', 'true');
});

test('dragging a row moves it under the pointer while the others slide, then reorders', async ({
  page,
}) => {
  await page.goto('/');
  await addCreature(page, 'gobl', 'Goblin');
  await addCreature(page, 'ogre', 'Ogre');
  await addCreature(page, 'orc', 'Orc');
  const rows = page.locator('.it-row');
  await expect(rows).toHaveCount(3);
  const first = await rows.nth(0).boundingBox();
  const grip = await rows.nth(0).locator('[data-grip]').boundingBox();
  const startX = grip!.x + grip!.width / 2;
  const startY = grip!.y + grip!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 40, { steps: 4 });
  // in real time: the dragged row has moved with the pointer
  const moved = await rows.nth(0).boundingBox();
  expect(moved!.y - first!.y).toBeGreaterThan(30);
  await page.mouse.move(startX, startY + 130, { steps: 6 });
  // the second row has slid up into the vacated place
  await expect(rows.nth(1)).toHaveClass(/it-row--shifted/);
  const second = await rows.nth(1).boundingBox();
  expect(second!.y).toBeLessThan(first!.y + first!.height);
  await page.mouse.up();
  await expect(rows.nth(0).locator('input.it-name')).toHaveValue('Ogre', { timeout: 3000 });
  await expect(rows.nth(2).locator('input.it-name')).toHaveValue('Goblin');
});
