import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { AgentState, Family, ToolCategory } from '../core/types.ts';

export type Pose = 'sleep' | 'think' | 'shell' | 'read' | 'write' | 'web' | 'task' | 'hand' | 'sign' | 'pack' | 'error' | 'done' | 'stalled' | 'off';

export function poseFor(state: AgentState, category?: ToolCategory): Pose {
  switch (state) {
    case 'offline': return 'off';
    case 'idle': return 'sleep';
    case 'thinking': return 'think';
    case 'awaiting-input': return 'hand';
    case 'awaiting-permission': return 'sign';
    case 'compacting': return 'pack';
    case 'error': return 'error';
    case 'done': return 'done';
    case 'stalled': return 'stalled';
    case 'tool':
      return category === 'read' ? 'read' : category === 'write' ? 'write' : category === 'web' ? 'web' : category === 'task' ? 'task' : 'shell';
  }
}

interface Look {
  color: number;
  limb: number;
  w: number;
  h: number;
  d: number;
  radius: number;
  eyes: 'rect' | 'screen' | 'round' | 'slash' | 'round-dark' | 'rect-light';
  eyeColor: number;
  legs: 4 | 2;
}

export const LOOKS: Record<Family, Look> = {
  claude: { color: 0xf26b1d, limb: 0xe85f12, w: 1.35, h: 0.95, d: 0.85, radius: 0.12, eyes: 'rect', eyeColor: 0x0b0b0d, legs: 4 },
  gpt: { color: 0x202638, limb: 0x2c3348, w: 1.1, h: 1.15, d: 0.9, radius: 0.3, eyes: 'screen', eyeColor: 0x35e8ff, legs: 2 },
  gemini: { color: 0x4f7dff, limb: 0x3f69e6, w: 1.2, h: 1.05, d: 0.95, radius: 0.45, eyes: 'round', eyeColor: 0xffffff, legs: 2 },
  grok: { color: 0x2d323c, limb: 0x1e222a, w: 1.0, h: 1.2, d: 0.75, radius: 0.14, eyes: 'slash', eyeColor: 0xf4f7fb, legs: 2 },
  mai: { color: 0x6fd3c0, limb: 0x58b8a6, w: 1.2, h: 1.0, d: 0.9, radius: 0.35, eyes: 'round-dark', eyeColor: 0x10302b, legs: 2 },
  generic: { color: 0x8b95a3, limb: 0x727c8a, w: 1.15, h: 1.0, d: 0.85, radius: 0.2, eyes: 'rect-light', eyeColor: 0xeaf2ff, legs: 2 },
};

interface Target {
  x: number; y: number; rx: number; ry: number; rz: number; sy: number; sxz: number;
  alx: number; alz: number; arx: number; arz: number;
  open: number; wide: number; dx: number; dy: number;
}

const zero = (): Target => ({ x: 0, y: 0, rx: 0, ry: 0, rz: 0, sy: 1, sxz: 1, alx: 0, alz: 0, arx: 0, arz: 0, open: 1, wide: 1, dx: 0, dy: 0 });

const textures = new Map<string, THREE.CanvasTexture>();
const GREY = new THREE.Color(0x777b83);

function bubbleTexture(text: string, bg = '#f4f7fb', fg = '#141a22'): THREE.CanvasTexture {
  const key = `${text}|${bg}|${fg}`;
  let tex = textures.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(8, 8, 144, 90, 28);
  g.fill();
  g.beginPath();
  g.moveTo(66, 96);
  g.lineTo(80, 122);
  g.lineTo(94, 96);
  g.fill();
  g.fillStyle = fg;
  g.font = `700 ${text.length > 3 ? 40 : 52}px "Segoe UI Emoji","Segoe UI",system-ui,sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 80, 56);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, tex);
  return tex;
}

const BUBBLE: Partial<Record<Pose, string>> = {
  sleep: 'Zzz', shell: '>_', read: '🔍', write: '✏️', web: '🌐', task: '👥', hand: '!', pack: '📦', error: '✖', done: '✔', stalled: '?',
};
const DOTS = ['.', '..', '...'];

function mat(color: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.04, clearcoat: 0.35, clearcoatRoughness: 0.35, ...extra });
}

function rbox(w: number, h: number, d: number, r: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m);
  mesh.castShadow = true;
  return mesh;
}

/** A chunky vinyl-toy robot. Local origin is the centre of its seat contact; it faces +z. */
export class Figure {
  readonly root = new THREE.Group();
  readonly family: Family;
  readonly tier: number;
  private look: Look;
  private body = new THREE.Group();
  private bodyMat: THREE.MeshPhysicalMaterial;
  private baseColor: THREE.Color;
  private eyes = new THREE.Group();
  private eyeZ = 0;
  private eyeMeshes: THREE.Object3D[] = [];
  private eyeX = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private props: Record<string, THREE.Object3D> = {};
  private smoke: THREE.Mesh[] = [];
  private boxes: THREE.Mesh[] = [];
  private bubble: THREE.Sprite;
  private pose: Pose = 'sleep';
  private cur = zero();
  private phase = Math.random() * 20;
  private reduced: boolean;
  private tint = 0;
  private grey = 0;
  private err = 0;
  private tintMode: 'none' | 'error' | 'stalled' = 'none';
  private disposables: { dispose(): void }[] = [];

  constructor(family: Family, tier: number, scale = 1, reducedMotion = false) {
    this.family = family;
    this.tier = tier;
    this.reduced = reducedMotion;
    this.look = LOOKS[family];
    this.baseColor = new THREE.Color(this.look.color);
    this.bodyMat = mat(this.look.color);
    this.disposables.push(this.bodyMat);
    this.build();
    const s = scale * (tier === 1 ? 0.9 : tier === 3 ? 1.08 : 1);
    this.root.scale.setScalar(s);
    this.root.add(this.body);

    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('Zzz'), transparent: true, depthWrite: false }));
    this.bubble.scale.set(0.8, 0.64, 1);
    this.bubble.position.set(0, this.look.h + 0.78, 0.2);
    this.root.add(this.bubble);
  }

  setPose(p: Pose): void {
    this.pose = p;
    this.root.visible = p !== 'off';
    this.tintMode = p === 'error' ? 'error' : p === 'stalled' ? 'stalled' : 'none';
    const show = (name: string, on: boolean) => {
      if (this.props[name]) this.props[name].visible = on;
    };
    show('paper', p === 'read');
    show('pen', p === 'write');
    show('globe', p === 'web');
    show('sign', p === 'sign');
    for (const b of this.boxes) b.visible = p === 'pack';
    for (const s of this.smoke) s.visible = p === 'error';
    this.eyeX.visible = p === 'error';
    for (const e of this.eyeMeshes) e.visible = p !== 'error';
    const label = p === 'think' ? undefined : BUBBLE[p];
    this.bubble.visible = p !== 'think' ? !!label : true;
    if (label) (this.bubble.material as THREE.SpriteMaterial).map = bubbleTexture(label);
  }

  update(t: number, dt: number): void {
    if (this.pose === 'off') return;
    const tt = this.reduced ? 0 : t + this.phase;
    const g = zero();
    this.target(this.pose, tt, g);
    const a = this.reduced ? 1 : 1 - Math.exp(-dt * 9);
    const c = this.cur as unknown as Record<string, number>;
    for (const k of Object.keys(g) as (keyof Target)[]) c[k] += (g[k] - c[k]) * a;

    this.body.position.set(this.cur.x, this.cur.y, 0);
    this.body.rotation.set(this.cur.rx, this.cur.ry, this.cur.rz);
    this.body.scale.set(this.cur.sxz, this.cur.sy, this.cur.sxz);
    this.armL.rotation.set(this.cur.alx, 0, this.cur.alz);
    this.armR.rotation.set(this.cur.arx, 0, this.cur.arz);

    const blink = !this.reduced && this.pose !== 'sleep' && (t * 0.23 + this.phase) % 1 < 0.025 ? 0.1 : 1;
    this.eyes.position.set(this.cur.dx, this.cur.dy, this.eyeZ);
    this.eyes.scale.set(this.cur.wide, Math.max(0.08, this.cur.open * this.cur.wide * blink), 1);

    this.animateProps(tt, dt);
    this.animateTint(tt, dt);
    this.animateBubble(tt);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    for (const d of this.disposables) d.dispose();
  }

  private target(p: Pose, t: number, o: Target): void {
    const h = this.look.h;
    switch (p) {
      case 'sleep':
        o.sy = 1 + Math.sin(t * 1.5) * 0.025; o.rz = 0.04; o.open = 0.08; o.ry = 0.12; o.arz = 0.05; o.alz = -0.05;
        break;
      case 'think':
        o.rz = Math.sin(t * 1.1) * 0.09; o.dy = h * 0.07; o.dx = Math.sin(t * 0.7) * 0.05; o.arz = 0.9; o.arx = -0.3; o.open = 0.9;
        break;
      case 'shell':
        o.rx = 0.1; o.y = Math.abs(Math.sin(t * 7)) * 0.015; o.alx = Math.sin(t * 14) * 0.55; o.arx = Math.sin(t * 14 + Math.PI) * 0.55; o.dy = -h * 0.05; o.open = 0.85;
        break;
      case 'read':
        o.ry = Math.sin(t * 1.8) * 0.28; o.rx = 0.05; o.alx = -0.7; o.arx = -0.7; o.dx = Math.sin(t * 1.8) * 0.07; o.open = 0.9;
        break;
      case 'write':
        o.rx = 0.12; o.arx = Math.sin(t * 9) * 0.35 - 0.5; o.arz = 0.3 + Math.sin(t * 4.5) * 0.15; o.alx = -0.3; o.dy = -h * 0.06; o.open = 0.85;
        break;
      case 'web':
        o.ry = Math.sin(t * 0.9) * 0.45; o.wide = 1.18; o.alx = -0.4; o.arx = -0.4; o.y = Math.sin(t * 2) * 0.02;
        break;
      case 'task':
        o.arz = 1.0 + Math.sin(t * 5) * 0.4; o.wide = 1.1; o.rz = Math.sin(t * 2.5) * 0.04; o.alx = Math.sin(t * 10) * 0.3;
        break;
      case 'hand':
        o.y = Math.abs(Math.sin(t * 3)) * 0.14; o.arz = 1.45 + Math.sin(t * 7) * 0.18; o.wide = 1.3; o.alz = -0.1;
        break;
      case 'sign':
        o.alz = -0.9; o.arz = 0.9; o.alx = -0.5; o.arx = -0.5; o.wide = 1.12; o.rz = Math.sin(t * 2) * 0.03;
        break;
      case 'pack':
        o.sy = 0.84 + 0.1 * Math.sin(t * 6); o.sxz = 1.06 - 0.05 * Math.sin(t * 6); o.open = 0.35; o.arz = 0.5; o.alz = -0.5;
        break;
      case 'error':
        o.x = Math.sin(t * 38) * 0.02; o.alz = -0.7; o.arz = 0.7; o.rz = Math.sin(t * 19) * 0.03; o.wide = 1.1;
        break;
      case 'done':
        o.y = Math.abs(Math.sin(t * 2.4)) * 0.12; o.alz = -1.25; o.arz = 1.25; o.open = 0.45; o.wide = 1.05;
        break;
      case 'stalled':
        o.rz = -0.07; o.open = 0.12; o.sy = 0.98;
        break;
      case 'off':
        break;
    }
  }

  private animateProps(t: number, dt: number): void {
    const globe = this.props.globe;
    if (globe?.visible) globe.rotation.y += dt * 1.6;
    const star = this.props.star;
    if (star) {
      star.rotation.y += dt * 1.4;
      star.position.y = this.look.h + 0.32 + Math.sin(t * 2) * 0.04;
    }
    const pen = this.props.pen;
    if (pen?.visible) pen.rotation.z = Math.sin(t * 9) * 0.1;
    this.boxes.forEach((b, i) => {
      const ang = t * 1.6 + (i * Math.PI * 2) / this.boxes.length;
      b.position.set(Math.cos(ang) * 0.95, 0.45 + Math.sin(t * 3 + i) * 0.08, Math.sin(ang) * 0.95 + 0.1);
      b.rotation.y = ang;
    });
    this.smoke.forEach((s, i) => {
      const k = (t * 0.7 + i / this.smoke.length) % 1;
      s.position.set(Math.sin(t * 2 + i) * 0.12 + (i - 1) * 0.18, this.look.h + 0.1 + k * 0.7, 0);
      s.scale.setScalar(0.6 + k * 0.9);
      (s.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    });
  }

  private animateTint(t: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.grey += ((this.tintMode === 'stalled' ? 1 : 0) - this.grey) * k;
    this.err += ((this.tintMode === 'error' ? 1 : 0) - this.err) * k;
    this.bodyMat.color.copy(this.baseColor).lerp(GREY, this.grey);
    this.bodyMat.emissive.set(0xff2438);
    this.bodyMat.emissiveIntensity = this.err * (0.25 + 0.25 * Math.sin(t * 12));
  }

  private animateBubble(t: number): void {
    const b = this.bubble;
    const base = this.look.h + 0.78;
    b.position.y = base + Math.sin(t * 2.4) * 0.04 + (this.pose === 'hand' ? Math.abs(Math.sin(t * 3)) * 0.16 : 0);
    if (this.pose === 'think') (b.material as THREE.SpriteMaterial).map = bubbleTexture(DOTS[Math.floor(t * 2.2) % 3]);
  }

  private build(): void {
    const L = this.look;
    const limbMat = mat(L.limb);
    this.disposables.push(limbMat);

    const torso = rbox(L.w, L.h, L.d, L.radius, this.bodyMat);
    torso.position.y = L.h / 2;
    this.body.add(torso);

    this.buildFace();

    const armY = L.h * 0.42;
    for (const [pivot, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      pivot.position.set(side * (L.w / 2 - 0.02), armY, 0.05);
      const arm = rbox(0.28, 0.22, 0.3, 0.07, limbMat);
      arm.position.set(side * 0.13, 0, 0);
      pivot.add(arm);
      this.body.add(pivot);
    }

    const xs = L.legs === 4 ? [-0.5, -0.27, 0.27, 0.5].map((x) => x * (L.w / 1.35)) : [-0.28, 0.28];
    for (const x of xs) {
      const leg = rbox(L.legs === 4 ? 0.15 : 0.3, 0.17, 0.42, 0.06, limbMat);
      leg.position.set(x, -0.04, L.d / 2 + 0.12);
      this.body.add(leg);
    }

    this.buildAccessory(limbMat);
    this.buildProps();
  }

  private buildFace(): void {
    const L = this.look;
    const front = L.d / 2 + 0.03;
    this.eyeZ = front;
    this.eyes.position.z = front;
    const eyeMat = new THREE.MeshBasicMaterial({ color: L.eyeColor });
    this.disposables.push(eyeMat);
    const y = L.h * 0.64;
    const sx = L.w * 0.22;

    if (L.eyes === 'screen') {
      const bezel = rbox(L.w * 0.9, L.h * 0.74, 0.05, 0.12, mat(0x6b7491, { metalness: 0.5, roughness: 0.35 }));
      bezel.position.set(0, y, front - 0.03);
      const screen = rbox(L.w * 0.8, L.h * 0.62, 0.05, 0.1, new THREE.MeshBasicMaterial({ color: 0x080b12 }));
      screen.position.set(0, y, front - 0.005);
      this.body.add(bezel, screen);
    }

    const make = (x: number, ry: number, rz = 0): THREE.Object3D => {
      let m: THREE.Mesh;
      if (L.eyes === 'rect' || L.eyes === 'rect-light') m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.03), eyeMat);
      else if (L.eyes === 'screen') m = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.26, 0.03, 3, 0.07), eyeMat);
      else if (L.eyes === 'slash') m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.03), eyeMat);
      else m = new THREE.Mesh(new THREE.CircleGeometry(L.eyes === 'round' ? 0.17 : 0.13, 20), eyeMat);
      m.position.set(x, ry, 0);
      m.rotation.z = rz;
      this.eyes.add(m);
      this.eyeMeshes.push(m);
      return m;
    };
    if (L.eyes === 'slash') {
      make(-0.2, y + 0.03, -0.3);
      make(0.2, y - 0.03, -0.3);
    } else {
      make(-sx, y);
      make(sx, y);
    }
    if (L.eyes === 'round') {
      const pupil = new THREE.MeshBasicMaterial({ color: 0x151a2b });
      this.disposables.push(pupil);
      for (const e of this.eyeMeshes) {
        const p = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), pupil);
        p.position.set(0, -0.01, 0.01);
        e.add(p);
      }
    }
    this.body.add(this.eyes);

    const xMat = new THREE.MeshBasicMaterial({ color: 0xff6b7d });
    this.disposables.push(xMat);
    this.eyeX.position.z = front + 0.005;
    for (const ex of L.eyes === 'slash' ? [-0.2, 0.2] : [-sx, sx]) {
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.03), xMat);
        bar.position.set(ex, y, 0);
        bar.rotation.z = rot;
        this.eyeX.add(bar);
      }
    }
    this.eyeX.visible = false;
    this.body.add(this.eyeX);
  }

  private buildAccessory(limbMat: THREE.Material): void {
    const L = this.look;
    if (this.family === 'gpt') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 10, 32, Math.PI), mat(0x5b3fd0));
      band.scale.y = 0.4;
      band.position.set(0, L.h * 0.78, 0);
      this.body.add(band);
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 20), mat(0x5b3fd0));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.62, L.h * 0.78, 0);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 24), new THREE.MeshBasicMaterial({ color: 0x35e8ff }));
        ring.rotation.y = Math.PI / 2;
        ring.position.set(side * 0.7, L.h * 0.78, 0);
        this.body.add(cup, ring);
      }
    } else if (this.family === 'gemini') {
      for (const side of [-1, 1]) {
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), mat(0xa77bff));
        lobe.scale.y = 0.85;
        lobe.position.set(side * L.w * 0.24, L.h + 0.0, 0);
        lobe.castShadow = true;
        this.body.add(lobe);
      }
    } else if (this.family === 'grok') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), limbMat);
      mast.position.set(L.w * 0.28, L.h + 0.2, -0.05);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff6a3d }));
      tip.position.set(L.w * 0.28, L.h + 0.42, -0.05);
      this.body.add(mast, tip);
    }
    if (this.tier === 3) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xffd45e }));
      star.position.set(0, L.h + 0.32, 0);
      this.props.star = star;
      this.body.add(star);
    }
  }

  private buildProps(): void {
    const L = this.look;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.6), new THREE.MeshBasicMaterial({ color: 0xf2f5f9, side: THREE.DoubleSide }));
    paper.position.set(0, L.h * 0.62, L.d / 2 + 0.42);
    paper.rotation.x = -0.35;
    paper.visible = false;
    this.props.paper = paper;
    this.body.add(paper);

    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), new THREE.MeshBasicMaterial({ color: 0xffd45e }));
    pen.position.set(0.18, 0, 0.18);
    pen.rotation.x = Math.PI / 2.3;
    pen.visible = false;
    this.armR.add(pen);
    this.props.pen = pen;

    const globe = new THREE.Group();
    globe.add(
      new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), mat(0x2f8cff)),
      new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, wireframe: true })),
    );
    globe.position.set(0.95, 0.4, 1.0);
    globe.visible = false;
    this.props.globe = globe;
    this.root.add(globe);

    const sign = new THREE.Group();
    const board = rbox(0.78, 0.5, 0.05, 0.08, mat(0xffb23d));
    const text = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.44), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true }));
    text.position.z = 0.03;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), mat(0x8a5a2b));
    stick.position.y = -0.4;
    sign.add(board, text, stick);
    sign.position.set(0, L.h * 0.95, L.d / 2 + 0.5);
    sign.visible = false;
    this.props.sign = sign;
    this.body.add(sign);

    for (let i = 0; i < 3; i++) {
      const box = rbox(0.24, 0.2, 0.24, 0.03, mat(0xc89a62));
      box.visible = false;
      this.boxes.push(box);
      this.root.add(box);
    }
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9aa3b0, transparent: true, opacity: 0.6, depthWrite: false }));
      puff.visible = false;
      this.smoke.push(puff);
      this.root.add(puff);
    }
  }
}

let signTex: THREE.CanvasTexture | null = null;
function signTexture(): THREE.CanvasTexture {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a1a05';
  g.font = '800 96px "Segoe UI",system-ui,sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('OK?', 128, 84);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
}
