import { expect, test, Page } from '@playwright/test';

// A new encounter has five empty rows: fill the first one that has no name yet.
async function addCreature(page: Page, typed: string, option: string) {
  const names = page.locator('input.it-name');
  const values = await names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const free = values.indexOf('');
  if (free < 0) await page.getByRole('button', { name: 'Add creature' }).click();
  const field = free < 0 ? names.last() : names.nth(free);
  await field.fill(typed);
  await page.getByRole('option', { name: option }).first().click();
}

test('add, roll, sort, next, and restore after reload', async ({ page }) => {
  await page.goto('/');

  await addCreature(page, 'gobl', 'Goblin');
  await addCreature(page, 'ogre', 'Ogre');
  await expect(page.locator('.it-row')).toHaveCount(5);
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

  await page.getByRole('button', { name: 'Next turn' }).click(); // the empty rows are skipped
  await expect(page.locator('.it-round-num')).toHaveText('2');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');

  // Autosave is debounced; wait for it to land in localStorage before reloading.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('it-tracker:enc:_last_session')))
    .toContain('"round":2');

  await page.reload();
  await expect(page.locator('.it-row')).toHaveCount(5);
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
  await expect(rows).toHaveCount(5);
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

test('HP - / + buttons change HP by the amount, from mouse and keyboard', async ({ page }) => {
  await page.goto('/');
  await addCreature(page, 'gobl', 'Goblin');
  const hp = page.getByLabel(/^Hit points, Goblin/);
  const down = page.getByRole('button', { name: /^Subtract the amount from hit points, Goblin/ });
  const up = page.getByRole('button', { name: /^Add the amount to hit points, Goblin/ });
  await expect(down).toBeHidden();
  await hp.click();
  await expect(down).toBeVisible();
  await down.click();
  await expect(hp).toHaveValue('6');
  await page.getByLabel(/^Amount to add or subtract, Goblin/).fill('3');
  await down.click();
  await expect(hp).toHaveValue('3');
  await up.click();
  await up.click();
  await expect(hp).toHaveValue('9'); // above the goblin's max of 7: the DM's call
  await page.screenshot({ path: 'e2e/.results/hp-box.png' });

  // keyboard: Tab from HP reaches the box, Enter / Space press the buttons, Escape closes it
  await hp.focus();
  await page.keyboard.press('Tab'); // max HP
  await page.keyboard.press('Tab');
  await expect(down).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(hp).toHaveValue('6');
  await page.keyboard.press('Escape');
  await expect(down).toBeHidden();
  await expect(hp).toBeFocused();
  await page.locator('.it-enc-name').click();
  await expect(down).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test('tapping the HP field shows the box and taps change HP', async ({ page }) => {
    await page.goto('/');
    await addCreature(page, 'gobl', 'Goblin');
    const hp = page.getByLabel(/^Hit points, Goblin/);
    await hp.tap();
    const down = page.getByRole('button', { name: /^Subtract the amount from hit points, Goblin/ });
    await expect(down).toBeVisible();
    await down.tap();
    await down.tap();
    await expect(hp).toHaveValue('5');
    // the box stays inside the screen
    const box = await page.locator('.it-c-hp--open .it-hp-pop').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: 'e2e/.results/hp-box-phone.png' });
  });
});

test('a new encounter autosaves and is opened again from the folder button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.it-row')).toHaveCount(5);
  await page.getByLabel('Encounter name').fill('Bridge');
  await addCreature(page, 'gobl', 'Goblin');
  await page.getByRole('button', { name: 'New encounter' }).click();
  await expect(page.getByLabel('Encounter name')).toHaveValue('New encounter');
  await expect(page.locator('input.it-name').first()).toHaveValue('');

  await page.getByRole('button', { name: 'Saved encounters' }).click();
  await page.getByRole('button', { name: 'Bridge', exact: true }).click();
  await expect(page.getByLabel('Encounter name')).toHaveValue('Bridge');
  await expect(page.locator('input.it-name').first()).toHaveValue('Goblin');
});

test('initiative - / + buttons, and the d20 shows on hover', async ({ page }) => {
  await page.goto('/');
  const cell = page.locator('.it-row').first().locator('.it-c-init');
  const d20 = cell.getByRole('button', { name: /^Roll initiative/ });
  await expect(d20).toHaveCSS('opacity', '0');
  await cell.hover();
  await expect(d20).toHaveCSS('opacity', '1');
  await cell.locator('[data-field="initiative"]').fill('10');
  await cell.getByRole('button', { name: /^Add the amount to initiative/ }).click();
  await expect(cell.locator('[data-field="initiative"]')).toHaveValue('11');
});

test('the book button opens the stat block beside the tracker; Escape closes it', async ({
  page,
}) => {
  await page.goto('/');
  await addCreature(page, 'adult red', 'Adult Red Dragon');
  const book = page.getByRole('button', { name: 'Stat block for Adult Red Dragon' });
  await book.click();
  const panel = page.getByRole('dialog', { name: 'Adult Red Dragon' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Legendary Actions' })).toBeVisible();
  await expect(panel).toContainText('256 (19d12 + 133)');
  await expect(panel).toContainText('System Reference Document 5.1');
  // the panel is at the right of the window and the tracker is still usable beside it
  const box = await panel.boundingBox();
  const width = page.viewportSize().width;
  expect(Math.round(box.x + box.width)).toBe(width);
  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('on a phone the stat block is a sheet along the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await addCreature(page, 'gobl', 'Goblin');
  await page.getByRole('button', { name: 'Stat block for Goblin' }).click();
  const panel = page.getByRole('dialog', { name: 'Goblin' });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(800);
  expect(box.width).toBe(390);
  expect(box.height).toBeLessThanOrEqual(800 * 0.72 + 1);
});

test('a Pathfinder creature shows its own stat block and the ORC notice', async ({ page }) => {
  await page.goto('/');
  await addCreature(page, 'goblin warr', 'Goblin Warrior');
  await page.getByRole('button', { name: 'Stat block for Goblin Warrior' }).click();
  const panel = page.getByRole('dialog', { name: 'Goblin Warrior' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Creature −1');
  await expect(panel).toContainText('Goblin Scuttle');
  await expect(panel.getByRole('img', { name: 'Reaction' }).first()).toBeVisible();
  await expect(panel).toContainText('ORC License');
});
