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
  projectId?: string | null;
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
  workspaces: ['id', 'session_id', 'branch', 'name', 'project_id'],
  workspace_session_aliases: ['session_id', 'workspace_id'],
  projects: ['id', 'name', 'show_in_sidebar', 'main_repo_path'],
  app_state: ['key', 'value'],
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

  /** Projects shown in the app's Sessions sidebar, in the user's own order. */
  listProjects(): { id: string; name: string; dir?: string }[] {
    try {
      const rows = this.select('projects').filter((p) => p.show_in_sidebar == null || p.show_in_sidebar === 1);
      let order: string[] = [];
      const state = this.select('app_state').find((r) => r.key === 'project-order');
      if (state) {
        try {
          const parsed = JSON.parse(String(state.value));
          if (Array.isArray(parsed?.state?.projectOrder)) order = parsed.state.projectOrder.filter((x: unknown) => typeof x === 'string');
        } catch {
          /* unreadable order: fall back to the table order */
        }
      }
      const rank = (id: string): number => {
        const i = order.indexOf(id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      return rows
        .map((p) => ({ id: String(p.id), name: String(p.name ?? p.id), dir: p.main_repo_path ? String(p.main_repo_path) : undefined }))
        .sort((a, b) => rank(a.id) - rank(b.id));
    } catch {
      this.close();
      return [];
    }
  }

  listSessions(): AppSessionInfo[] {
    try {
      const sessions = this.select('sessions', 'archived_at IS NULL', 'updated_at DESC', 400) as AppSessionRow[];
      const workspaces = this.select('workspaces');
      const aliases = this.select('workspace_session_aliases');
      const projects = new Map(this.select('projects').map((p) => [String(p.id), String(p.name)]));
      const byId = new Map<string, Record<string, any>>();
      const bySession = new Map<string, Record<string, any>>();
      for (const w of workspaces) {
        byId.set(String(w.id), w);
        if (w.session_id) bySession.set(String(w.session_id), w);
      }
      for (const a of aliases) {
        const w = byId.get(String(a.workspace_id));
        if (w && !bySession.has(String(a.session_id))) bySession.set(String(a.session_id), w);
      }
      return sessions.map((s) => {
        const w = bySession.get(s.id);
        const projectId = w?.project_id ? String(w.project_id) : null;
        return {
          ...s,
          branch: w?.branch ?? null,
          workspaceName: w?.name ?? null,
          projectId,
          project: projectId ? (projects.get(projectId) ?? null) : null,
        };
      });
    } catch {
      this.close();
      return [];
    }
  }
}
