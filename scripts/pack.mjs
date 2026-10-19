import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';

const paths = await packager({
  dir: '.',
  out: 'out',
  name: 'ur-agents',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: false,
  icon: 'build/icon.ico',
  win32metadata: { CompanyName: 'ur-agents', FileDescription: 'ur-agents', ProductName: 'ur-agents', OriginalFilename: 'ur-agents.exe' },
  // Everything the app needs is bundled into dist/, so nothing else ships.
  ignore: (file) => file !== '' && !/^\/(package\.json|dist(\/|$))/.test(file) || file.endsWith('.map'),
});

console.log('packed:', paths.join('\n'));
for (const directory of paths) {
  fs.copyFileSync('build/icon.ico', path.join(directory, 'resources', 'ur-agents.ico'));
}
