// Wraps the packed app (out/ur-agents-win32-x64) into a one-click Windows installer (Squirrel) in out/installer.
// Installing puts the app under %LOCALAPPDATA%\ur_agents and adds Desktop and Start Menu shortcuts; no admin rights needed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createWindowsInstaller } from 'electron-winstaller';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const appDirectory = path.resolve('out', 'ur-agents-win32-x64');
const outputDirectory = path.resolve('out', 'installer');
if (!fs.existsSync(path.join(appDirectory, 'ur-agents.exe'))) throw new Error('Run "npm run pack" first.');

// electron-winstaller picks the 7-Zip build for this machine in an install script that npm may block.
const vendor = path.join(path.dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
for (const ext of ['exe', 'dll']) {
  const target = path.join(vendor, `7z.${ext}`);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(vendor, `7z-${process.arch === 'arm64' ? 'arm64' : 'x64'}.${ext}`), target);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
await createWindowsInstaller({
  appDirectory,
  outputDirectory,
  name: 'ur_agents',
  title: 'ur-agents',
  productName: 'ur-agents',
  description: pkg.description,
  authors: 'ur-agents',
  version: pkg.version,
  exe: 'ur-agents.exe',
  setupExe: `ur-agents-Setup-${pkg.version}.exe`,
  setupIcon: path.resolve('build', 'icon.ico'),
  noMsi: true,
});

for (const f of fs.readdirSync(outputDirectory)) console.log(f, Math.round(fs.statSync(path.join(outputDirectory, f)).size / 1024 / 1024) + ' MB');
