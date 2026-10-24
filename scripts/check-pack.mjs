// Checks that `npm pack` of the three publishable packages contains everything a consumer needs at
// run time (run after the packages are built). Packages are consumed as tarballs by hosts that do
// not have this repository next to them.
// Usage: node scripts/check-pack.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = {
  'tabletop-server': [
    'package.json',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/server.js',
    'dist/cli.js',
  ],
  'tabletop-client': [
    'package.json',
    'dist/tabletop-client.js',
    'dist/tabletop-client.css',
    'types/index.d.ts',
  ],
  'initiative-tracker': ['package.json', 'dist/initiative-tracker.js', 'dist/types/index.d.ts'],
};
// Never ship sources, tests, dev pages, source maps of the bundles or local state.
const forbidden = [
  /^src\//,
  /^e2e\//,
  /^dev\//,
  /^dist\/dev\//,
  /\.test\./,
  /^node_modules\//,
  /\.env/,
];

let failed = false;
for (const [name, files] of Object.entries(required)) {
  const dir = path.join(root, 'packages', name);
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const listed = JSON.parse(out)[0].files.map((f) => f.path);
  const missing = files.filter((f) => !listed.includes(f));
  const bad = listed.filter((f) => forbidden.some((re) => re.test(f)));
  if (missing.length || bad.length) {
    failed = true;
    console.error(`${name}: missing [${missing.join(', ')}] unexpected [${bad.join(', ')}]`);
  } else {
    console.log(`${name}: ok (${listed.length} files)`);
  }
}
process.exit(failed ? 1 : 0);
