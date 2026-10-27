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

    // host drags it. Software-rendered WebGL on CI is slow, so wait for the token's screen position
    // to settle first, and retry the drag if the first attempt did not pick the token up.
    const position = () =>
      host.evaluate((id) => (window as any).tabletop.getTokenPosition(id), tokenId);
    const screenPosition = () =>
      host.evaluate((id) => (window as any).tabletop.getTokenScreenPosition(id), tokenId);
    let last = await screenPosition();
    await expect
      .poll(async () => {
        const now = await screenPosition();
        const settled = Math.abs(now.x - last.x) < 1 && Math.abs(now.y - last.y) < 1;
        last = now;
        return settled;
      })
      .toBe(true);

    const before = await position();
    let dragged = false;
    for (let attempt = 1; attempt <= 3 && !dragged; attempt++) {
      const start = await screenPosition();
      await host.mouse.move(start.x, start.y);
      await host.mouse.down();
      await host.mouse.move(start.x + 40, start.y + 10, { steps: 5 });
      await host.mouse.move(start.x + 140, start.y + 30, { steps: 10 });
      await host.mouse.up();
      try {
        await expect
          .poll(
            async () => {
              const p = await position();
              return p.x !== before.x || p.z !== before.z;
            },
            { timeout: 8_000 },
          )
          .toBe(true);
        dragged = true;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
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
  // the first build of the scene can take more than the default 5 s on a busy machine
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  const s = await stats(page);
  expect(s.isHost).toBe(true);
  expect(s.doors).toBe(2);
  await expect(page.locator('#demo-text')).toHaveText('DEMO');
});

// A token's vision, as the area of the polygon the fog is drawn from, after dragging it along `path`.
// Walls stop tokens only when the host's light view is off, so it is turned off first.
async function dragAndLook(page, tokenId: string, path: number[][]) {
  return page.evaluate(
    ([tokenId, path]) => {
      const map = (window as any).tabletop.debug.map;
      map.local.dmLight = 0;
      let seen = [];
      const setVision = map.mask.fog.setVision;
      map.mask.fog.setVision = (points) => {
        seen = points || [];
        return setVision(points);
      };
      const token = map.objects.tokens[tokenId];
      const controls = map.translateControls.token;
      controls.object = token;
      controls.translateGroupObjects = [token];
      controls.translatestart({});
      for (const [x, z] of path as number[][]) {
        token.position.x = x;
        token.position.z = z;
        controls.translate({});
      }
      controls.translateend({});
      map.mask.fog.setVision = setVision;
      let area = 0;
      seen.forEach((p, i) => {
        const q = seen[(i + 1) % seen.length];
        area += p.x * q.z - q.x * p.z;
      });
      return { x: token.position.x, z: token.position.z, area: Math.abs(area / 2) };
    },
    [tokenId, path] as [string, number[][]],
  );
}

test('tokens keep out of walls through mid-square and still see in a double doorway', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  // the inner wall runs through the middle of the squares at x = 11: the token stops beside it
  const atWall = await dragAndLook(page, '1', [
    [8, 10],
    [10, 10],
    [11.6, 10],
    [12.5, 10],
  ]);
  expect(atWall.x).toBe(10);
  expect(atWall.area).toBeGreaterThan(20);

  // the front wall (z = 18) has a two-square gap: a double door, both leaves open
  await page.evaluate(() => {
    const update = (window as any).tabletop.debug.updateClient;
    update.updateDoorTransform({ doorId: '1', x: 9.5, z: 18, rotation: 0 });
    update.updateDoorTransform({ doorId: '2', x: 10.5, z: 18, rotation: 0 });
    update.updateDoorState({ doorId: '1', open: 1 });
    update.updateDoorState({ doorId: '2', open: 1 });
  });
  await page.waitForTimeout(500); // the leaves swing open over 250 ms
  const inside = await dragAndLook(page, '2', [[10, 17]]);
  const doorway = await dragAndLook(page, '2', [
    [10, 17.6],
    [10, 18],
  ]);
  expect([doorway.x, doorway.z]).toEqual([10, 18]);
  // it sees both rooms, at least as much as from inside the building
  expect(doorway.area).toBeGreaterThan(inside.area);
});

// A one-box glTF (1 x 2 x 0.2), made here so no third-party model is needed.
function boxGltf(): string {
  const p = [
    [-0.5, 0, -0.1],
    [0.5, 0, -0.1],
    [0.5, 2, -0.1],
    [-0.5, 2, -0.1],
    [-0.5, 0, 0.1],
    [0.5, 0, 0.1],
    [0.5, 2, 0.1],
    [-0.5, 2, 0.1],
  ].flat();
  const idx = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 0, 4,
    7, 0, 7, 3,
  ];
  const buf = Buffer.concat([
    Buffer.from(new Float32Array(p).buffer),
    Buffer.from(new Uint16Array(idx).buffer),
  ]);
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.2, 1], metallicFactor: 0 } },
    ],
    buffers: [
      {
        byteLength: buf.length,
        uri: 'data:application/octet-stream;base64,' + buf.toString('base64'),
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: idx.length * 2 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-0.5, 0, -0.1],
        max: [0.5, 2, 0.1],
      },
      { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  });
}

test('walls drawn with a model, and the loading title', async ({ page }) => {
  await page.route('**/test-wall.gltf', (route) =>
    route.fulfill({ contentType: 'model/gltf+json', body: boxGltf() }),
  );
  await page.goto('/?demo=1&wallModel=test-wall.gltf&title=Dungeons');
  await expect(page.locator('#load-text')).toHaveText('Dungeons');
  await expect(page.locator('.load-slice')).toHaveCount(6);
  await expect.poll(async () => (await stats(page))?.tokens).toBe(4);
  const read = () =>
    page.evaluate(() => {
      const scene = (window as any).tabletop.debug.map.scene;
      let tiles = 0;
      let boxesShown = 0;
      scene.traverse((o) => {
        if (o.name === 'wall model') tiles += o.count;
        if (o.name === 'wall mesh' && o.visible) boxesShown++;
      });
      return { tiles, boxesShown };
    });
  await expect.poll(async () => (await read()).tiles).toBeGreaterThan(4);
  expect((await read()).boxesShown).toBe(0);
});
