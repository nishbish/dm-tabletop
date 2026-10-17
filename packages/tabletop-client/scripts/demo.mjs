// `npm run demo`: starts the real tabletop server (in-memory storage, default open login, port
// 3000) and the viewer's dev page on port 5173. Open the printed link in two browser tabs: the
// first tab is host, the second a player, and token moves show up in both.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const bin = (name) => join(repoRoot, 'node_modules', '.bin', name);

const children = [
  spawn(bin('tsx'), [join(repoRoot, 'packages', 'tabletop-server', 'src', 'cli.ts')], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3000', STORAGE: 'memory', LOG_LEVEL: 'warn' },
  }),
  spawn(bin('vite'), ['dev/', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: join(here, '..'),
    stdio: 'inherit',
  }),
];

console.log('\nTabletop demo\n');
console.log('  server  ws://localhost:3000   (health: http://localhost:3000/health)');
console.log('  viewer  http://127.0.0.1:5173/?room=demo&token=alice');
console.log(
  '          http://127.0.0.1:5173/?room=demo&token=bob   <- open this one in a second tab\n',
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
