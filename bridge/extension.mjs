// ur-agents bridge: lets the ur-agents desktop app talk to this Copilot session (send messages, stop, answer
// questions, approve or reject permission requests). Files in this folder are copied here by the app.
// stdout is reserved for JSON-RPC, so nothing is ever printed from this file.
import fs from 'node:fs';
import path from 'node:path';
import { joinSession } from '@github/copilot-sdk/extension';
import { createBridge } from './core.mjs';
import { dataDir } from './protocol.mjs';

const file = path.join(dataDir(), 'bridge.json');

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg || typeof cfg.port !== 'number' || typeof cfg.token !== 'string') return null;
    try {
      process.kill(cfg.pid, 0);
    } catch (e) {
      if (e && e.code !== 'EPERM') return null;
    }
    return cfg;
  } catch {
    return null;
  }
}

// No tools, hooks or permission/input handlers are registered, so the session keeps behaving exactly as before.
const session = await joinSession({});
const bridge = createBridge(session, { readConfig });
bridge.start();
