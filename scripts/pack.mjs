import { packager } from '@electron/packager';

const paths = await packager({
  dir: '.',
  out: 'out',
  name: 'ur-agents',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: false,
  // Everything the app needs is bundled into dist/, so nothing else ships.
  ignore: (file) => file !== '' && !/^\/(package\.json|dist(\/|$))/.test(file) || file.endsWith('.map'),
});

console.log('packed:', paths.join('\n'));
