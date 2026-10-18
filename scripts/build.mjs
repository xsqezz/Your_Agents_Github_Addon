import { build } from 'esbuild';
import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true, logLevel: 'warning' };

await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs' }),
  build({ ...node, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs' }),
  build({
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'dist/renderer.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    sourcemap: true,
    logLevel: 'warning',
  }),
]);

fs.mkdirSync('dist/bridge', { recursive: true });
for (const f of ['extension.mjs', 'core.mjs', 'protocol.mjs']) fs.copyFileSync(`bridge/${f}`, `dist/bridge/${f}`);
for (const f of ['index.html', 'styles.css']) fs.copyFileSync(`src/renderer/${f}`, `dist/${f}`);
console.log('build ok');
