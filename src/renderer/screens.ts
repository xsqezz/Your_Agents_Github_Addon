import * as THREE from 'three';
import type { FeedItem, SessionSummary, ToolCategory } from '../core/types.ts';
import { FAMILY_LABEL } from '../core/family.ts';
import { STATE_COLOR, stateText } from './theme.ts';

export const SCREEN_W = 640;
export const SCREEN_H = 400;

const MONO = '"Cascadia Mono","Cascadia Code",Consolas,ui-monospace,monospace';
const UI = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const C = {
  bg: '#0a1017', bar: '#131b26', text: '#dbe5f1', dim: '#7c8da3', faint: '#3a4759',
  green: '#4be3a1', red: '#ff6b7d', amber: '#ffc247', blue: '#7db2ff', violet: '#b99bff', orange: '#ff9a4d',
};
const LH = 29;
const PAD = 22;

const CAT_COLOR: Record<ToolCategory, string> = { shell: C.green, read: C.blue, write: C.orange, web: C.violet, task: C.violet, input: C.amber, other: C.dim };
const CAT_ICON: Record<ToolCategory, string> = { shell: '>_', read: '◎', write: '✎', web: '◍', task: '⧉', input: '?', other: '•' };
const CAT_TITLE: Record<ToolCategory, string> = { shell: 'Terminal', read: 'File', write: 'Patch', web: 'Web', task: 'Sub-agents', input: 'Question', other: 'Tool' };

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      let w = word;
      while (ctx.measureText(w).width > maxW) {
        let n = w.length;
        while (n > 1 && ctx.measureText(w.slice(0, n)).width > maxW) n--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

function header(ctx: CanvasRenderingContext2D, title: string, right: string, color: string, rightColor = C.dim): void {
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, 0, SCREEN_W, 46);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(PAD + 6, 23, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 22px ${UI}`;
  ctx.fillStyle = C.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, PAD + 22, 24);
  ctx.textAlign = 'right';
  ctx.font = `500 19px ${UI}`;
  ctx.fillStyle = rightColor;
  ctx.fillText(fit(ctx, right, 330), SCREEN_W - PAD, 24);
  ctx.textAlign = 'left';
}

export function drawOff(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

function statusGlyph(it: FeedItem, phase: number): [string, string] {
  if (it.status === 'running') return [phase % 2 ? '●' : '○', C.green];
  if (it.status === 'fail') return ['✕', C.red];
  if (it.status === 'pending') return ['!', C.amber];
  if (it.status === 'ok') return ['✓', C.green];
  return ['', C.dim];
}

function feedStyle(it: FeedItem): { icon: string; color: string; title: string } {
  if (it.kind === 'tool') {
    const cat = it.category ?? 'other';
    return { icon: CAT_ICON[cat], color: CAT_COLOR[cat], title: it.title };
  }
  if (it.kind === 'user') return { icon: '›', color: C.blue, title: 'You' };
  if (it.kind === 'assistant') return { icon: '◆', color: C.text, title: 'Agent' };
  if (it.kind === 'permission') return { icon: '!', color: C.amber, title: 'Permission' };
  if (it.kind === 'subagent') return { icon: '⧉', color: C.violet, title: it.title };
  return { icon: '·', color: C.dim, title: it.title };
}

/** Left monitor: the agent's recent activity, newest at the bottom. */
export function drawActivity(ctx: CanvasRenderingContext2D, s: SessionSummary, phase: number): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  header(ctx, 'Activity', `${FAMILY_LABEL[s.family]} · ${s.model || '?'}`, STATE_COLOR[s.state]);
  ctx.textBaseline = 'middle';
  const items = s.feed.slice(-11);
  if (!items.length) {
    ctx.font = `500 22px ${UI}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('no activity yet', PAD, 90);
    return;
  }
  let y = SCREEN_H - 20 - (items.length - 1) * LH;
  for (const it of items) {
    const st = feedStyle(it);
    const [glyph, gcol] = statusGlyph(it, phase);
    ctx.font = `700 21px ${MONO}`;
    ctx.fillStyle = st.color;
    ctx.fillText(st.icon, PAD, y);
    ctx.font = `700 21px ${MONO}`;
    const tw = ctx.measureText(st.title).width;
    ctx.fillText(fit(ctx, st.title, 150), PAD + 40, y);
    ctx.font = `500 21px ${MONO}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(fit(ctx, it.text, SCREEN_W - PAD * 2 - 40 - Math.min(150, tw) - 44), PAD + 40 + Math.min(150, tw) + 14, y);
    ctx.font = `700 21px ${MONO}`;
    ctx.fillStyle = gcol;
    ctx.textAlign = 'right';
    ctx.fillText(glyph, SCREEN_W - PAD, y);
    ctx.textAlign = 'left';
    y += LH;
  }
}

function elapsed(ts: number, now: number): string {
  const s = Math.max(0, (now - ts) / 1000);
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function lineColor(text: string): string {
  if (/^\s*\+/.test(text)) return C.green;
  if (/^\s*-/.test(text)) return C.red;
  if (/\b(FAIL|failed|error|Error|✕|✖)\b/.test(text)) return C.red;
  if (/\b(pass|passed|ok|✓|✔|done)\b/i.test(text)) return C.green;
  return C.text;
}

function body(ctx: CanvasRenderingContext2D, lines: string[], from: number, color?: (l: string) => string, gutter = false, startNo = 1): void {
  ctx.font = `500 21px ${MONO}`;
  ctx.textBaseline = 'middle';
  const rows = Math.floor((SCREEN_H - from - 8) / LH);
  const shown = lines.slice(0, rows);
  shown.forEach((line, i) => {
    const y = from + 14 + i * LH;
    let x = PAD;
    if (gutter) {
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'right';
      ctx.fillText(String(startNo + i), PAD + 34, y);
      ctx.textAlign = 'left';
      x = PAD + 50;
    }
    ctx.fillStyle = color ? color(line) : C.text;
    ctx.fillText(fit(ctx, line, SCREEN_W - x - PAD), x, y);
  });
}

/** Right monitor: what the agent is working on right now. */
export function drawFocus(ctx: CanvasRenderingContext2D, s: SessionSummary, phase: number, now: number): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const f = s.focus;
  const cursor = phase % 2 ? '▌' : ' ';
  const maxW = SCREEN_W - PAD * 2;

  if (s.state === 'awaiting-permission' && s.pending) {
    header(ctx, 'Permission needed', s.pending.kind, C.amber, C.amber);
    ctx.font = `500 23px ${MONO}`;
    const lines = wrap(ctx, s.pending.text, maxW - 24).slice(0, 7);
    ctx.fillStyle = '#16202c';
    ctx.fillRect(PAD, 66, maxW, lines.length * 32 + 24);
    ctx.fillStyle = C.text;
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, PAD + 12, 94 + i * 32));
    ctx.font = `700 22px ${UI}`;
    ctx.fillStyle = phase % 2 ? C.amber : C.dim;
    ctx.fillText('waiting for your approval…', PAD, SCREEN_H - 30);
    return;
  }
  if (s.state === 'awaiting-input' && s.pending) {
    header(ctx, 'Question for you', 'waiting', C.amber, C.amber);
    ctx.font = `600 26px ${UI}`;
    ctx.fillStyle = C.text;
    ctx.textBaseline = 'middle';
    wrap(ctx, s.pending.text, maxW).slice(0, 8).forEach((l, i) => ctx.fillText(l, PAD, 90 + i * 38));
    return;
  }
  if (s.state === 'compacting') {
    header(ctx, 'Compacting context', stateText(s), C.violet, C.violet);
    ctx.fillStyle = '#16202c';
    ctx.fillRect(PAD, 170, maxW, 26);
    const w = ((phase * 0.37) % 1) * (maxW - 120);
    ctx.fillStyle = C.violet;
    ctx.fillRect(PAD + w, 170, 120, 26);
    ctx.font = `500 22px ${UI}`;
    ctx.fillStyle = C.dim;
    ctx.textBaseline = 'middle';
    ctx.fillText('summarising the conversation so it fits…', PAD, 230);
    return;
  }
  if (s.state === 'error') {
    header(ctx, 'Error', 'failed', C.red, C.red);
    ctx.font = `500 23px ${MONO}`;
    ctx.fillStyle = C.red;
    ctx.textBaseline = 'middle';
    wrap(ctx, s.activity, maxW).slice(0, 9).forEach((l, i) => ctx.fillText(l, PAD, 90 + i * 32));
    return;
  }
  if (s.state === 'stalled') {
    header(ctx, 'Stalled', 'no signal', C.dim);
    ctx.font = `500 22px ${UI}`;
    ctx.fillStyle = C.dim;
    ctx.textBaseline = 'middle';
    ctx.fillText('open work, but nothing is running', PAD, 100);
    return;
  }
  if (s.state === 'done') {
    header(ctx, 'Done', 'task complete', C.green, C.green);
    ctx.font = `700 64px ${UI}`;
    ctx.fillStyle = C.green;
    ctx.textBaseline = 'middle';
    ctx.fillText('✓', PAD, 140);
    ctx.font = `500 22px ${MONO}`;
    ctx.fillStyle = C.dim;
    if (f) wrap(ctx, f.text, maxW).slice(0, 6).forEach((l, i) => ctx.fillText(l, PAD, 210 + i * 30));
    return;
  }

  const cat: ToolCategory | undefined = f?.kind === 'tool' ? (f.category ?? 'other') : s.category;
  if (s.state === 'tool' && s.category === 'task') {
    header(ctx, 'Sub-agents', `${s.subagents.filter((a) => a.status === 'running').length} running`, C.violet);
    ctx.textBaseline = 'middle';
    s.subagents.slice(-8).forEach((a, i) => {
      const y = 78 + i * 38;
      ctx.font = `700 21px ${MONO}`;
      ctx.fillStyle = a.status === 'failed' ? C.red : a.status === 'done' ? C.dim : C.violet;
      ctx.fillText(a.status === 'running' ? (phase % 2 ? '●' : '○') : a.status === 'done' ? '✓' : '✕', PAD, y);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, a.displayName, 170), PAD + 34, y);
      ctx.font = `500 20px ${MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(fit(ctx, a.currentTool ?? a.model, 300), PAD + 220, y);
    });
    return;
  }

  if (!f || (s.state === 'thinking' && f.kind !== 'tool')) {
    header(ctx, 'Thinking', stateText(s), C.blue);
    ctx.font = `500 22px ${UI}`;
    ctx.fillStyle = C.text;
    ctx.textBaseline = 'middle';
    const lines = f ? wrap(ctx, f.text, maxW) : [];
    const tail = lines.slice(-9);
    tail.forEach((l, i) => ctx.fillText(i === tail.length - 1 ? `${l}${cursor}` : l, PAD, 80 + i * 32));
    if (!f) {
      ctx.fillStyle = C.dim;
      ctx.fillText(`waiting for the model${'.'.repeat(1 + (phase % 3))}`, PAD, 90);
    }
    return;
  }

  const running = f.status === 'running';
  const right = running ? elapsed(f.ts, now) : f.status === 'fail' ? 'failed' : f.status === 'ok' ? 'done' : '';
  const title = f.kind === 'tool' ? `${CAT_TITLE[cat ?? 'other']} · ${f.title}` : f.title;
  header(ctx, title, right, CAT_COLOR[cat ?? 'other'], f.status === 'fail' ? C.red : running ? C.green : C.dim);

  const lines = f.text.split('\n').filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim()));
  const first = lines[0] ?? '';
  const rest = lines.slice(1).filter((l) => l.trim());
  ctx.textBaseline = 'middle';

  if (cat === 'shell') {
    ctx.font = `700 21px ${MONO}`;
    ctx.fillStyle = C.green;
    ctx.fillText(fit(ctx, `$ ${first}`, maxW), PAD, 70);
    const out = rest.slice(-Math.floor((SCREEN_H - 90) / LH) + 1);
    body(ctx, out.map((l) => l), 78, lineColor);
    if (running) {
      ctx.fillStyle = C.green;
      ctx.fillText(cursor, PAD, 78 + 14 + Math.min(out.length, 9) * LH);
    }
  } else if (cat === 'read') {
    ctx.font = `600 20px ${MONO}`;
    ctx.fillStyle = C.blue;
    ctx.fillText(fit(ctx, first, maxW), PAD, 70);
    body(ctx, rest, 80, () => C.text, true);
  } else if (cat === 'write') {
    ctx.font = `600 20px ${MONO}`;
    ctx.fillStyle = C.orange;
    ctx.fillText(fit(ctx, first, maxW), PAD, 70);
    body(ctx, rest, 80, lineColor);
  } else if (cat === 'web') {
    ctx.font = `600 24px ${UI}`;
    ctx.fillStyle = C.violet;
    wrap(ctx, first, maxW).slice(0, 3).forEach((l, i) => ctx.fillText(l, PAD, 84 + i * 34));
    body(ctx, rest, 200, () => C.dim);
  } else {
    ctx.font = `500 22px ${UI}`;
    ctx.fillStyle = C.text;
    const wrapped = wrap(ctx, lines.join('\n'), maxW).slice(0, 10);
    wrapped.forEach((l, i) => ctx.fillText(l, PAD, 82 + i * 32));
  }
}

/** One physical monitor: bezel, stand and a live canvas for the screen. */
export class Monitor {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private screenMat: THREE.MeshBasicMaterial;
  private led: THREE.MeshBasicMaterial;
  private lastKey = '';

  constructor(side: -1 | 1) {
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
    drawOff(this.ctx);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.led = new THREE.MeshBasicMaterial({ color: 0x2a2f36 });

    const frame = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.45, metalness: 0.5 });
    const W = 1.92;
    const H = 1.2;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.06), frame);
    bezel.castShadow = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, (W - 0.1) * (SCREEN_H / SCREEN_W)), this.screenMat);
    screen.position.z = 0.032;
    const ledDot = new THREE.Mesh(new THREE.CircleGeometry(0.016, 10), this.led);
    ledDot.position.set(W / 2 - 0.08, -H / 2 + 0.03, 0.033);
    const tilt = new THREE.Group();
    tilt.add(bezel, screen, ledDot);
    tilt.position.y = 0.92;
    this.group.add(tilt);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.05), frame);
    neck.position.set(0, 0.21, -0.05);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.025, 0.38), frame);
    foot.position.set(0, 0.0125, 0.02);
    this.group.add(neck, foot);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = side * -0.1;
    tilt.rotation.x = -0.3;
  }

  /** Redraws only when the content (or the blink phase while animating) changed. */
  render(draw: ((ctx: CanvasRenderingContext2D) => void) | null, key: string, ledColor: number): void {
    this.led.color.set(ledColor);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (draw) draw(this.ctx);
    else drawOff(this.ctx);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.screenMat.dispose();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
  }
}
