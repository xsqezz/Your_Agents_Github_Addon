import { DatabaseSync } from 'node:sqlite';

export interface AppSessionRow {
  id: string;
  title?: string | null;
  session_type?: string | null;
  mode?: string | null;
  model?: string | null;
  is_running?: number | null;
  updated_at?: string | null;
  archived_at?: string | null;
  context_current_tokens?: number | null;
  context_input_token_limit?: number | null;
  total_nano_aiu?: number | null;
}

export interface AppSessionInfo extends AppSessionRow {
  branch?: string | null;
  workspaceName?: string | null;
  project?: string | null;
}

/**
 * Read-only access to the Copilot app database. Only the tables and columns listed here are ever
 * queried: credentials (accounts, settings) are deliberately not part of the allowlist.
 */
const ALLOWED: Record<string, string[]> = {
  sessions: [
    'id', 'title', 'session_type', 'mode', 'model', 'is_running', 'updated_at', 'archived_at',
    'context_current_tokens', 'context_input_token_limit', 'total_nano_aiu',
  ],
  workspaces: ['session_id', 'branch', 'name', 'project_id'],
  projects: ['id', 'name'],
};

export class AppDb {
  private file: string;
  private db: DatabaseSync | null = null;
  private columns = new Map<string, Set<string>>();

  constructor(file: string) {
    this.file = file;
  }

  private open(): DatabaseSync | null {
    if (this.db) return this.db;
    try {
      this.db = new DatabaseSync(this.file, { readOnly: true });
      this.db.exec('PRAGMA busy_timeout = 1500');
      this.columns.clear();
    } catch {
      this.db = null;
    }
    return this.db;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
    this.db = null;
  }

  private select(table: keyof typeof ALLOWED, where?: string, order?: string, limit?: number): Record<string, any>[] {
    const db = this.open();
    if (!db) return [];
    let have = this.columns.get(table);
    if (!have) {
      have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      this.columns.set(table, have);
    }
    const cols = ALLOWED[table].filter((c) => have!.has(c));
    if (!cols.length) return [];
    const w = where && cols.includes(where.split(' ')[0]) ? ` WHERE ${where}` : '';
    const o = order && cols.includes(order.split(' ')[0]) ? ` ORDER BY ${order}` : '';
    const l = limit ? ` LIMIT ${Math.floor(limit)}` : '';
    return db.prepare(`SELECT ${cols.join(', ')} FROM ${table}${w}${o}${l}`).all() as Record<string, any>[];
  }

  listSessions(): AppSessionInfo[] {
    try {
      const sessions = this.select('sessions', 'archived_at IS NULL', 'updated_at DESC', 300) as AppSessionRow[];
      const workspaces = this.select('workspaces');
      const projects = new Map(this.select('projects').map((p) => [p.id, p.name as string]));
      const bySession = new Map<string, Record<string, any>>();
      for (const w of workspaces) if (w.session_id) bySession.set(w.session_id, w);
      return sessions.map((s) => {
        const w = bySession.get(s.id);
        return { ...s, branch: w?.branch ?? null, workspaceName: w?.name ?? null, project: w ? (projects.get(w.project_id) ?? null) : null };
      });
    } catch {
      this.close();
      return [];
    }
  }
}
