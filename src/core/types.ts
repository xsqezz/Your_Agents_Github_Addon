export type Family = 'claude' | 'gpt' | 'gemini' | 'grok' | 'mai' | 'generic';

export type AgentState =
  | 'offline'
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'awaiting-input'
  | 'awaiting-permission'
  | 'compacting'
  | 'error'
  | 'done'
  | 'stalled';

export type ToolCategory = 'shell' | 'read' | 'write' | 'web' | 'task' | 'input' | 'other';

export interface RawEvent {
  type: string;
  data?: any;
  id?: string;
  timestamp?: string;
  parentId?: string | null;
  agentId?: string;
}

export interface TimelineItem {
  id: string;
  rev: number;
  ts: number;
  kind: 'user' | 'assistant' | 'tool' | 'permission' | 'subagent' | 'system';
  agentId?: string;
  title: string;
  body?: string;
  status?: 'running' | 'ok' | 'fail' | 'pending' | 'info' | 'warn';
  category?: ToolCategory;
  durationMs?: number;
}

export interface SubAgentInfo {
  agentId: string;
  name: string;
  displayName: string;
  model: string;
  family: Family;
  tier: number;
  description?: string;
  background: boolean;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'failed';
  toolCalls?: number;
  currentTool?: string;
}

export interface FeedItem {
  ts: number;
  kind: TimelineItem['kind'];
  category?: ToolCategory;
  status?: TimelineItem['status'];
  title: string;
  text: string;
}

/** What the agent is looking at right now: the running tool, or its latest output. */
export interface FocusInfo {
  kind: TimelineItem['kind'];
  category?: ToolCategory;
  status?: TimelineItem['status'];
  title: string;
  text: string;
  ts: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  kind: 'project' | 'chats' | 'other';
  /** A new agent can be started here (the room has a folder on disk). */
  canLaunch?: boolean;
}

export interface Snapshot {
  rooms: RoomInfo[];
  sessions: SessionSummary[];
}

export interface SessionSummary {
  id: string;
  /** Room (project folder, "chats" or "other") the session belongs to. */
  room: string;
  title: string;
  project?: string;
  branch?: string;
  model: string;
  family: Family;
  tier: number;
  mode?: string;
  state: AgentState;
  stateSince: number;
  activity: string;
  category?: ToolCategory;
  live: boolean;
  lastEventAt: number;
  contextPct?: number;
  contextTokens?: number;
  contextLimit?: number;
  costAiu?: number;
  premiumRequests?: number;
  toolCalls: number;
  turns: number;
  hooks: number;
  subagents: SubAgentInfo[];
  pending?: { kind: string; text: string };
  feed: FeedItem[];
  focus?: FocusInfo;
  hasEvents: boolean;
}

export interface SessionDetail {
  id: string;
  rev: number;
  items: TimelineItem[];
  source?: string;
}
