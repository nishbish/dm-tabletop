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

// Where a token is on screen once the camera has finished gliding to it after the load.
async function steadyScreenPosition(page: Page, tokenId: string) {
  const at = () =>
    page.evaluate((id) => (window as any).tabletop.getTokenScreenPosition(id), tokenId);
  let last = await at();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(300);
        const now = await at();
        const moved = Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
        last = now;
        return moved;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBeLessThan(0.5);
  return last;
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

test('2D view: drawn from above, tokens still move, and the choice is remembered', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  const orthographic = () =>
    page.evaluate(() => {
      const map = (window as any).tabletop.debug.map;
      return !!map.objects.camera.isOrthographicCamera;
    });
  await page.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
  await page.locator('.pane:visible .pane-close-button').click(); // the demo's welcome message
  const tokenId = (await stats(page)).tokenIds[0];

  const turn = () =>
    page.evaluate(() => (window as any).tabletop.debug.map.orbitControls.getAzimuthalAngle());
  const turn3d = await turn();
  expect(Math.abs(turn3d)).toBeGreaterThan(0.01);

  await page.locator('[data-button="view2d"]').click();
  expect(await orthographic()).toBe(true);
  expect(await page.evaluate(() => (window as any).tabletop.debug.map.skybox.visible)).toBe(false);
  // north is up, and right-dragging does not turn it
  expect(await turn()).toBeCloseTo(0, 5);
  await page.mouse.move(300, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(420, 300, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect(await turn()).toBeCloseTo(0, 5);
  // a host's overlay still gets a camera with perspective, now straight above the same spot
  const view = await page.evaluate(() => (window as any).tabletop.getView());
  expect(view.fov).toBeGreaterThan(0);
  expect(Math.abs(view.position[0] - view.target[0])).toBeLessThan(0.01);
  expect(view.position[1]).toBeGreaterThan(view.target[1]);

  const before = await page.evaluate(
    (id) => (window as any).tabletop.getTokenPosition(id),
    tokenId,
  );
  const from = await steadyScreenPosition(page, tokenId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const now = await page.evaluate(
        (id) => (window as any).tabletop.getTokenPosition(id),
        tokenId,
      );
      return Math.abs(now.x - before.x) + Math.abs(now.z - before.z);
    })
    .toBeGreaterThan(0.5);

  await page.reload();
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  expect(await orthographic()).toBe(true);
  await page.locator('[data-button="view2d"]').click();
  expect(await orthographic()).toBe(false);
});

test('camera slides across the floor at one height, like a strategy game', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  await page.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
  await page.locator('.pane:visible .pane-close-button').click(); // the demo's welcome message
  // skip the glide to the first token, and no easing, so each move has finished by the next frame
  await expect
    .poll(() => page.evaluate(() => (window as any).tabletop.debug.map.orbitControls.animating))
    .toBe(true);
  await page.evaluate(() => {
    const map = (window as any).tabletop.debug.map;
    const c = map.orbitControls;
    map.objects.camera.position.copy(c.newPosition);
    c.target.copy(c.newTarget);
    c.animating = false;
    map.settings.cameraDamping = 0;
    c.enableDamping = false;
  });
  const camera = () =>
    page.evaluate(() => {
      const map = (window as any).tabletop.debug.map;
      const c = map.orbitControls;
      return {
        y: map.objects.camera.position.y,
        target: c.target.toArray(),
        tilt: c.getPolarAngle(),
        turn: c.getAzimuthalAngle(),
      };
    });
  const steady = async () => {
    let last = await camera();
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(200);
          const now = await camera();
          const moved = Math.abs(now.y - last.y) + Math.abs(now.target[0] - last.target[0]);
          last = now;
          return moved;
        },
        { timeout: 30_000, intervals: [0] },
      )
      .toBeLessThan(1e-4);
    return last;
  };
  const across = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[2] - a[2]);

  // left drag on the sky above the room: the view slides, its height stays put
  let before = await steady();
  await page.mouse.move(400, 40);
  await page.mouse.down();
  await page.mouse.move(250, 120, { steps: 6 });
  await page.mouse.up();
  let after = await camera();
  expect(across(before.target, after.target)).toBeGreaterThan(0.5);
  expect(after.y).toBeCloseTo(before.y, 4);
  expect(after.target[1]).toBeCloseTo(before.target[1], 4);

  // W slides forward, the way the camera faces, at the same height
  before = after;
  // held until it has gone some way: software WebGL on CI draws only a few frames a second
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => across(before.target, (await camera()).target), { timeout: 20_000 })
    .toBeGreaterThan(0.5);
  await page.keyboard.up('KeyW');
  after = await camera();
  const forward = [-Math.sin(before.turn), -Math.cos(before.turn)];
  const moved = [after.target[0] - before.target[0], after.target[2] - before.target[2]];
  expect(moved[0] * forward[0] + moved[1] * forward[1]).toBeGreaterThan(0.5);
  expect(after.y).toBeCloseTo(before.y, 4);

  // Q turns the view round the spot it looks at, without tilting or lifting it
  before = after;
  await page.keyboard.down('KeyQ');
  await expect
    .poll(async () => Math.abs((await camera()).turn - before.turn), { timeout: 20_000 })
    .toBeGreaterThan(0.2);
  await page.keyboard.up('KeyQ');
  after = await camera();
  expect(after.tilt).toBeCloseTo(before.tilt, 4);
  expect(after.y).toBeCloseTo(before.y, 4);

  // the keys do nothing while typing in a text box
  before = after;
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing-test';
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  after = await camera();
  expect(across(before.target, after.target)).toBeLessThan(1e-6);
  await page.evaluate(() => document.getElementById('typing-test')!.remove());

  // the wheel changes the height
  before = after;
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 400);
  after = await steady();
  expect(after.y).toBeGreaterThan(before.y + 0.5);

  // right drag tilts, but never down to level with the floor
  await page.mouse.move(400, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(400, 20, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  after = await steady();
  expect(after.tilt).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-6);
});

test('ping, and a pane opened from the token menu closes the menu', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  const pings = () =>
    page.evaluate(() => {
      const map = (window as any).tabletop.debug.map;
      return map.scene.children.filter((c) => c.name == 'ping' && c.visible).length;
    });
  await page.evaluate(() => {
    const map = (window as any).tabletop.debug.map;
    map.ping(null, '0xa83232', { x: 3, z: 3 }, false);
    map.ping(null, 0x3232a8, { x: 6, z: 3 }, false);
  });
  expect(await pings()).toBe(4); // ripple and beam each
  await expect.poll(pings).toBe(0);

  await page.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
  await page.locator('.pane:visible .pane-close-button').click(); // the demo's welcome message
  const tokenId = (await stats(page)).tokenIds[0];
  const at = await steadyScreenPosition(page, tokenId);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.locator('.show-context-menu-default');
  await menu.locator('.context-menu-default-text', { hasText: 'Edit' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#iconColorInput')).toBeVisible();
  // no upload hook in this demo: the form saves to the token, and there is no saving to a picture
  await expect(page.locator('.pane:visible .pane-header-title')).toHaveText('Edit Token');
  await expect(page.getByText('Token Size (grid)')).toBeVisible();
  await expect(page.locator('#token-picture-button')).toBeHidden();

  await page.evaluate(() => {
    const input = document.querySelector('#iconColorInput') as HTMLInputElement;
    input.value = '#d63a2f';
    input.dispatchEvent(new Event('input'));
  });
  const colors = () =>
    page.evaluate((id) => {
      const token = (window as any).tabletop.debug.map.objects.tokens[id];
      const face = token.avatar.querySelector('.avatar-face');
      return [
        token.meshes.body.material.color.getHex(),
        token.base.material.color.getHex(),
        face.style.backgroundColor,
        face.textContent,
      ];
    }, tokenId);
  // the demo's tokens are plain pawns: the base and the portrait take the colour too
  expect(await colors()).toEqual([0xd63a2f, 0xd63a2f, 'rgb(214, 58, 47)', '']);

  await page.locator('.pane-color-reset').click();
  const [body, base] = await colors();
  expect(body).toBe(base);
  expect(body).not.toBe(0xd63a2f);
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

test('box select: the rectangle goes away however the drag ends', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  await page.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
  await page.locator('.pane:visible .pane-close-button').click(); // the demo's welcome message
  const at = await steadyScreenPosition(page, (await stats(page)).tokenIds[0]);
  const rectangle = page.locator('.selectBox');
  const selected = () =>
    page.evaluate(() => (window as any).tabletop.debug.map.outlinePass.selectedObjects.length);
  const clearSelection = async () => {
    await page.evaluate(() => {
      (window as any).tabletop.debug.map.outlinePass.selectedObjects = [];
    });
  };
  const startDrag = async () => {
    await page.keyboard.down('Shift');
    await page.mouse.move(at.x - 50, at.y - 50);
    await page.mouse.down();
    await page.mouse.move(at.x + 50, at.y + 50, { steps: 6 });
    await expect(rectangle).toBeVisible();
  };

  // Shift held for the whole drag
  await startDrag();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(rectangle).toHaveCount(0);
  expect(await selected()).toBeGreaterThan(0);

  // Shift let go before the button: the drag still selects, and the rectangle still goes
  await clearSelection();
  await startDrag();
  await page.keyboard.up('Shift');
  await page.mouse.move(at.x + 60, at.y + 60, { steps: 2 });
  await expect(rectangle).toBeVisible();
  await page.mouse.up();
  await expect(rectangle).toHaveCount(0);
  expect(await selected()).toBeGreaterThan(0);
  // and select mode is off again: a plain drag turns the camera instead of drawing a box
  expect(await page.evaluate(() => (window as any).tabletop.debug.map.selectModeActive)).toBe(
    false,
  );

  // the window loses focus mid-drag (the Shift keyup then goes elsewhere)
  await startDrag();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(rectangle).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => (window as any).tabletop.debug.map.selectModeActive)).toBe(
    false,
  );
});

test('map images: the floor and image menus, and Change Image keeps the place', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect.poll(async () => (await stats(page))?.tokens, { timeout: 30_000 }).toBe(4);
  await page.waitForSelector('#load-screen', { state: 'hidden', timeout: 30_000 });
  await page.locator('.pane:visible .pane-close-button').click(); // the demo's welcome message
  await steadyScreenPosition(page, (await stats(page)).tokenIds[0]);

  const square =
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><rect width='20' height='20' fill='green'/></svg>";
  const wide =
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='red'/></svg>";
  const items = () =>
    page.locator('.show-context-menu-default .context-menu-default-text').allTextContents();
  const planes = () =>
    page.evaluate(() =>
      Object.entries<any>((window as any).tabletop.debug.map.objects.planes).map(([id, p]) => ({
        id,
        src: p.src,
        x: p.position.x,
        z: p.position.z,
        scale: p.scale.x,
        rotation: p.rotation.z,
        renderOrder: p.renderOrder,
        width: p.geometry.parameters ? p.geometry.parameters.width : 0,
        height: p.geometry.parameters ? p.geometry.parameters.height : 0,
      })),
    );
  // the floor: a spot left of the demo building, away from tokens and the image
  const floor = { x: 260, y: 520 };
  const imageAt = async () =>
    page.evaluate(() => {
      const map = (window as any).tabletop.debug.map;
      const p: any = Object.values(map.objects.planes)[0];
      const v = p.position.clone().project(map.objects.camera);
      const r = map.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
  const pickUrl = async (url: string) => {
    const pane = page
      .locator('.pane:visible')
      .filter({ has: page.locator('.pane-header-title', { hasText: 'Images' }) });
    await pane.locator('.pane-item', { hasText: 'Image URL' }).locator('input').fill(url);
    await pane.getByText('Add image from URL', { exact: true }).click();
  };

  // outside Edit Map the floor offers tokens and images
  await page.mouse.click(floor.x, floor.y, { button: 'right' });
  expect(await items()).toEqual(['Add Token', 'Add Image']);
  await page.locator('.show-context-menu-default').getByText('Add Image', { exact: true }).click();
  await pickUrl(square);
  await expect.poll(async () => (await planes()).length).toBe(1);
  await expect.poll(async () => (await planes())[0].width).toBe(5);

  // editing images: the floor offers images only
  await page.locator('[data-button="editMap"]').click();
  await page.locator('[data-button="planeMode"]').click();
  await page.mouse.click(floor.x + 300, floor.y - 300, { button: 'right' });
  expect(await items()).toEqual(['Add Image']);

  // an image offers Change Image, Add Image (to layer another) and Remove Image; selected first,
  // so its handles show
  const at = await imageAt();
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  expect(await items()).toEqual(['Change Image', 'Add Image', 'Remove Image']);
  const before = (await planes())[0];
  await page
    .locator('.show-context-menu-default')
    .getByText('Change Image', { exact: true })
    .click();
  await pickUrl(wide);
  // the same image, a new picture: id, place, turn and layer stay, the shape follows the picture
  await expect.poll(async () => (await planes())[0].height).toBe(2.5);
  const after = await planes();
  expect(after).toEqual([{ ...before, src: wide, width: 5, height: 2.5 }]);

  // and Add Image from an image's menu still adds a second one
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.locator('.show-context-menu-default').getByText('Add Image', { exact: true }).click();
  await pickUrl(square);
  await expect.poll(async () => (await planes()).length).toBe(2);

  // Remove Image
  const top = await imageAt();
  await page.mouse.click(top.x, top.y, { button: 'right' });
  await page
    .locator('.show-context-menu-default')
    .getByText('Remove Image', { exact: true })
    .click();
  await expect.poll(async () => (await planes()).length).toBe(1);
});
