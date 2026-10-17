// `npm run demo`: starts the real tabletop server (in-memory storage, default open login, port
// 3000) and the viewer's dev page on port 5173. Open the printed link in two browser tabs: the
// first tab is host, the second a player, and token moves show up in both.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const bin = (name) => join(repoRoot, 'node_modules', '.bin', name);

// Ask the OS for a free port, starting from the preferred one, so the demo still works when
// another program already uses 3000 or 5173.
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(findFreePort(preferred + 1)));
    probe.listen(preferred, '127.0.0.1', () => probe.close(() => resolve(preferred)));
  });
}

// Check both the IPv4 and IPv6 "localhost", since the server listens on all addresses.
async function pickPort(preferred) {
  let port = preferred;
  for (;;) {
    port = await findFreePort(port);
    const ok = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '::', () => probe.close(() => resolve(true)));
    });
    if (ok) return port;
    port += 1;
  }
}

const serverPort = await pickPort(Number(process.env.DEMO_SERVER_PORT) || 3000);
const viewerPort = await pickPort(Number(process.env.DEMO_VIEWER_PORT) || 5173);
const serverParam = `server=ws://localhost:${serverPort}`;

const children = [
  spawn(bin('tsx'), [join(repoRoot, 'packages', 'tabletop-server', 'src', 'cli.ts')], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(serverPort), STORAGE: 'memory', LOG_LEVEL: 'warn' },
  }),
  spawn(
    bin('vite'),
    ['dev/', '--host', '127.0.0.1', '--port', String(viewerPort), '--strictPort'],
    { cwd: join(here, '..'), stdio: 'inherit' },
  ),
];

console.log('\nTabletop demo\n');
console.log(
  `  server  ws://localhost:${serverPort}   (health: http://localhost:${serverPort}/health)`,
);
console.log(`  viewer  http://127.0.0.1:${viewerPort}/?room=demo&token=alice&${serverParam}`);
console.log(
  `          http://127.0.0.1:${viewerPort}/?room=demo&token=bob&${serverParam}   <- open this one in a second tab\n`,
);
console.log('The first person into a room is its host. Ctrl+C stops both.\n');

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', stop));
