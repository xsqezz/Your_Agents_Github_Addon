import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

/** Stores the Agents API key only as an OS-protected blob (DPAPI on Windows). */
export class AgentsApiKeyStore {
  private readonly file: string;

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, 'agents-api-key.bin');
  }

  available(): boolean {
    return fs.existsSync(this.file);
  }

  read(): string | null {
    if (!this.available() || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = fs.readFileSync(this.file);
      const key = safeStorage.decryptString(encrypted).trim();
      return key || null;
    } catch {
      return null;
    }
  }

  save(key: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
    const encrypted = safeStorage.encryptString(key.trim());
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    }
  }

  remove(): void {
    fs.rmSync(this.file, { force: true });
  }
}
