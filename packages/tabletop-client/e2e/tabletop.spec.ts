/* eslint-disable @typescript-eslint/no-explicit-any -- `window.tabletop` is the viewer handle, only typed inside the page */
import { expect, test, Page } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const PORT = 3123;
const SERVER = `ws://127.0.0.1:${PORT}`;

// Runs the real server (tsx cli) with file storage in a temp dir; can be stopped and restarted.
class ServerProcess {
  child: ChildProcess | null = null;
  constructor(private dataDir: string) {}

  async start(): Promise<void> {
    this.child = spawn(
      join(repoRoot, 'node_modules', '.bin', 'tsx'),
      [join(repoRoot, 'packages', 'tabletop-server', 'src', 'cli.ts')],
      {
        env: {
          ...process.env,
          PORT: String(PORT),
          STORAGE: 'file',
          DATA_DIR: this.dataDir,
          SAVE_DEBOUNCE_MS: '100',
          LOG_LEVEL: 'warn',
        },
        stdio: 'inherit',
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('server did not start');
  }

  // SIGTERM = graceful: the server saves every room before it exits.
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
  }
}

async function stats(page: Page) {
  return page.evaluate(() => (window as any).tabletop.getSceneStats());
}

async function waitConnected(page: Page) {
  await expect.poll(async () => (await stats(page))?.status, { timeout: 30_000 }).toBe('connected');
}

test('two players share a room, see token moves, and survive a server restart', async ({
  browser,
}) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tabletop-e2e-'));
  const server = new ServerProcess(dataDir);
  await server.start();

  try {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const errors: string[] = [];
    for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));

    const url = (token: string) => `/?server=${encodeURIComponent(SERVER)}&room=e2e&token=${token}`;

    // first one in is host
    await host.goto(url('host'));
    await waitConnected(host);
    await guest.goto(url('guest'));
    await waitConnected(guest);
    expect((await stats(host)).isHost).toBe(true);
    expect((await stats(guest)).isHost).toBe(false);

    // the host sees the guest in the player list
    await expect.poll(async () => (await stats(host)).users).toBe(2);

    // host: right click the floor -> Add Token -> pick the first built-in token
    await host.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
    await host.mouse.click(700, 500, { button: 'right' });
    await host
      .locator('.show-context-menu-default')
      .getByText('Add Token', { exact: true })
      .click();
    await host.locator('.pane-item-image').first().click();

    // the id comes from the server: first a client-side temporary one, then the real one
    await expect.poll(async () => (await stats(host)).tokenIds).toEqual(['1']);
    // so the guest sees the very same token
    await expect.poll(async () => (await stats(guest)).tokenIds.length).toBe(1);
    const tokenId = (await stats(host)).tokenIds[0];
    expect(/^l/.test(tokenId)).toBe(false); // no longer a client-side temporary id
    expect((await stats(guest)).tokenIds).toEqual([tokenId]);

    // host drags it
    const start = await host.evaluate(
      (id) => (window as any).tabletop.getTokenScreenPosition(id),
      tokenId,
    );
    const before = await host.evaluate(
      (id) => (window as any).tabletop.getTokenPosition(id),
      tokenId,
    );
    await host.mouse.move(start.x, start.y);
    await host.mouse.down();
    await host.mouse.move(start.x + 40, start.y + 10, { steps: 5 });
    await host.mouse.move(start.x + 140, start.y + 30, { steps: 10 });
    await host.mouse.up();

    await expect
      .poll(async () => {
        const p = await host.evaluate(
          (id) => (window as any).tabletop.getTokenPosition(id),
          tokenId,
        );
        return p.x !== before.x || p.z !== before.z;
      })
      .toBe(true);
    const moved = await host.evaluate(
      (id) => (window as any).tabletop.getTokenPosition(id),
      tokenId,
    );

    // the guest sees the token at the new position
    await expect
      .poll(
        async () => guest.evaluate((id) => (window as any).tabletop.getTokenPosition(id), tokenId),
        { timeout: 15_000 },
      )
      .toEqual(moved);

    // restart the server twice; both clients reconnect and the scene is rebuilt, never doubled
    for (let round = 1; round <= 2; round++) {
      await server.stop();
      await expect(host.locator('#dmt-banner')).toBeVisible({ timeout: 15_000 });
      await server.start();
      await waitConnected(host);
      await waitConnected(guest);
      for (const page of [host, guest]) {
        const s = await stats(page);
        expect(s.tokens, `round ${round}`).toBe(1);
        expect(s.tokenIds).toEqual([tokenId]);
        expect(s.users, `round ${round}`).toBe(2);
        expect(s.planes + s.doors + s.wallPoints).toBe(0);
        expect(
          await page.evaluate((id) => (window as any).tabletop.getTokenPosition(id), tokenId),
        ).toEqual(moved);
      }
      await expect(host.locator('#dmt-banner')).toBeHidden();
    }

    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('offline demo works with no server', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens).toBe(4);
  const s = await stats(page);
  expect(s.isHost).toBe(true);
  expect(s.doors).toBe(2);
  await expect(page.locator('#demo-text')).toHaveText('DEMO');
});
