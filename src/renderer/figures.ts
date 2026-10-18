import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { AgentState, Family, ToolCategory } from '../core/types.ts';

export type Pose = 'sleep' | 'think' | 'shell' | 'read' | 'write' | 'web' | 'task' | 'hand' | 'sign' | 'pack' | 'error' | 'done' | 'stalled' | 'off';

export function poseFor(state: AgentState, category?: ToolCategory): Pose {
  switch (state) {
    case 'offline': return 'sleep';
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
  gradient?: boolean;
}

/** Every family shares one body (the vinyl-toy block); only colour and emblem differ. */
const BODY = { w: 1.5, h: 1.0, d: 0.95, radius: 0.17 };

export const LOOKS: Record<Family, Look> = {
  claude: { color: 0xef5a2b, limb: 0xe6511f },
  gpt: { color: 0x1fb09c, limb: 0x19a08d },
  gemini: { color: 0xffffff, limb: 0xffffff, gradient: true },
  grok: { color: 0x31353d, limb: 0x2b2f36 },
  mai: { color: 0xe9e8e4, limb: 0xe0dfdb },
  auto: { color: 0x4a4b52, limb: 0x42434a },
  generic: { color: 0x8e98a6, limb: 0x7f8998 },
};

const GRADIENT = [0x2f55f0, 0x2fbf6a, 0xffc61f, 0xff7a1c, 0xe5303a].map((c) => new THREE.Color(c));
const GRADIENT_AT = [0, 0.3, 0.55, 0.78, 1];

function gradientAt(t: number): THREE.Color {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < GRADIENT_AT.length; i++) {
    if (x <= GRADIENT_AT[i]) {
      const k = (x - GRADIENT_AT[i - 1]) / (GRADIENT_AT[i] - GRADIENT_AT[i - 1]);
      return GRADIENT[i - 1].clone().lerp(GRADIENT[i], k);
    }
  }
  return GRADIENT[GRADIENT.length - 1].clone();
}

function paintGradient(geo: THREE.BufferGeometry, x0: number, x1: number): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = gradientAt((pos.getX(i) - x0) / (x1 - x0));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const emblems = new Map<Family, THREE.CanvasTexture>();
function emblemTexture(family: Family): THREE.CanvasTexture {
  let tex = emblems.get(family);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (family === 'claude') {
    const lens = [98, 70, 92, 62, 100, 68, 90, 74, 96, 64, 88, 70];
    g.translate(128, 128);
    lens.forEach((len, i) => {
      const a = (i / lens.length) * Math.PI * 2 + 0.1;
      g.beginPath();
      g.moveTo(Math.cos(a - 0.27) * 20, Math.sin(a - 0.27) * 20);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.lineTo(Math.cos(a + 0.27) * 20, Math.sin(a + 0.27) * 20);
      g.fill();
    });
  } else if (family === 'gpt') {
    g.translate(128, 128);
    g.lineWidth = 13;
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i * Math.PI) / 3);
      g.beginPath();
      g.ellipse(0, -42, 30, 54, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  } else if (family === 'gemini') {
    g.beginPath();
    g.moveTo(128, 18);
    g.quadraticCurveTo(138, 118, 238, 128);
    g.quadraticCurveTo(138, 138, 128, 238);
    g.quadraticCurveTo(118, 138, 18, 128);
    g.quadraticCurveTo(118, 118, 128, 18);
    g.fill();
  } else if (family === 'grok') {
    g.lineWidth = 17;
    g.beginPath();
    g.arc(128, 104, 56, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 19;
    g.beginPath();
    g.moveTo(82, 150);
    g.lineTo(174, 58);
    g.stroke();
    g.font = '800 54px "Segoe UI",system-ui,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GROK', 128, 212);
  } else if (family === 'auto') {
    // GitHub mark (Octicons "mark-github", MIT): a white disc with the cat cut out, so the body shows through.
    g.translate(33, 33);
    g.scale(11.9, 11.9);
    g.fill(
      new Path2D(
        'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z',
      ),
      'evenodd',
    );
  } else if (family === 'mai') {
    const squares: [number, number, string][] = [[34, 34, '#f25022'], [134, 34, '#7fba00'], [34, 134, '#00a4ef'], [134, 134, '#ffb900']];
    for (const [x, y, col] of squares) {
      g.fillStyle = col;
      g.fillRect(x, y, 88, 88);
    }
  } else {
    g.lineWidth = 20;
    g.beginPath();
    g.arc(128, 128, 64, 0, Math.PI * 2);
    g.stroke();
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  emblems.set(family, tex);
  return tex;
}

interface Target {
  x: number; y: number; rx: number; ry: number; rz: number; sy: number; sxz: number;
  alx: number; alz: number; arx: number; arz: number;
  open: number; wide: number; dx: number; dy: number;
}

const zero = (): Target => ({ x: 0, y: 0, rx: 0, ry: 0, rz: 0, sy: 1, sxz: 1, alx: 0, alz: 0, arx: 0, arz: 0, open: 1, wide: 1, dx: 0, dy: 0 });

const GREY = new THREE.Color(0x777b83);

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
  private look: Look & typeof BODY;
  private body = new THREE.Group();
  private bodyMat: THREE.MeshPhysicalMaterial;
  private baseColor: THREE.Color;
  private eyes = new THREE.Group();
  private eyeZ = 0;
  private eyeY = 0;
  private eyeMeshes: THREE.Object3D[] = [];
  private eyeX = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private props: Record<string, THREE.Object3D> = {};
  private smoke: THREE.Mesh[] = [];
  private boxes: THREE.Mesh[] = [];
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
    this.look = { ...BODY, ...LOOKS[family] };
    this.baseColor = new THREE.Color(this.look.color);
    this.bodyMat = mat(this.look.color, { roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.5, vertexColors: !!this.look.gradient });
    this.disposables.push(this.bodyMat);
    this.build();
    const s = scale * (tier === 1 ? 0.9 : tier === 3 ? 1.08 : 1);
    this.root.scale.setScalar(s);
    this.root.add(this.body);

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
    this.eyes.position.set(this.cur.dx, this.eyeY + this.cur.dy, this.eyeZ);
    this.eyes.scale.set(this.cur.wide, Math.max(0.08, this.cur.open * this.cur.wide * blink), 1);

    this.animateProps(tt, dt);
    this.animateTint(tt, dt);
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

  private build(): void {
    const L = this.look;
    const gradient = !!L.gradient;
    const limbMat = mat(L.limb, { roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.5, vertexColors: false });
    const limbL = gradient ? mat(0x2f55f0, { roughness: 0.62, clearcoat: 0.12 }) : limbMat;
    const limbR = gradient ? mat(0xe5303a, { roughness: 0.62, clearcoat: 0.12 }) : limbMat;
    this.disposables.push(limbMat, limbL, limbR);

    const torsoGeo = new RoundedBoxGeometry(L.w, L.h, L.d, 6, L.radius);
    if (gradient) paintGradient(torsoGeo, -L.w / 2, L.w / 2);
    const torso = new THREE.Mesh(torsoGeo, this.bodyMat);
    torso.castShadow = true;
    torso.position.y = L.h / 2;
    this.body.add(torso);

    this.buildFace();

    // Stubby side nubs.
    const armY = L.h * 0.42;
    for (const [pivot, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      pivot.position.set(side * (L.w / 2 - 0.04), armY, 0.0);
      const arm = rbox(0.36, 0.3, 0.36, 0.13, side < 0 ? limbL : limbR);
      arm.position.set(side * 0.15, 0, 0);
      pivot.add(arm);
      this.body.add(pivot);
    }

    // Four short legs in two pairs; seated, they point forward.
    const xs = [-0.6, -0.3, 0.3, 0.6];
    for (const x of xs) {
      const leg = rbox(0.23, 0.26, 0.34, 0.1, x < 0 ? limbL : limbR);
      leg.position.set(x, -0.04, L.d / 2 + 0.12);
      this.body.add(leg);
    }

    this.buildAccessory();
    this.buildProps();
  }

  private buildFace(): void {
    const L = this.look;
    const front = L.d / 2 + 0.02;
    const y = L.h * 0.64;
    const ex = L.w * 0.31;
    this.eyeZ = front;
    this.eyeY = y;
    this.eyes.position.set(0, y, front);

    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.disposables.push(eyeMat);
    for (const x of [-ex, ex]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), eyeMat);
      eye.scale.set(0.085, 0.14, 0.04);
      eye.position.set(x, 0, 0);
      this.eyes.add(eye);
      this.eyeMeshes.push(eye);
    }
    this.body.add(this.eyes);

    // X eyes for the error state.
    const xMat = new THREE.MeshBasicMaterial({ color: 0x111114 });
    this.disposables.push(xMat);
    this.eyeX.position.set(0, y, front + 0.01);
    for (const x of [-ex, ex]) {
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.03), xMat);
        bar.position.set(x, 0, 0);
        bar.rotation.z = rot;
        this.eyeX.add(bar);
      }
    }
    this.eyeX.visible = false;
    this.body.add(this.eyeX);

    // Raised emblem on the chest, and again on the back so the family shows when the agent faces its screens.
    const emblemMat = new THREE.MeshStandardMaterial({ map: emblemTexture(this.family), transparent: true, alphaTest: 0.35, roughness: 0.55, metalness: 0 });
    this.disposables.push(emblemMat);
    const size = this.family === 'grok' || this.family === 'auto' ? 0.86 : 0.78;
    for (const dir of [1, -1]) {
      const emblem = new THREE.Mesh(new THREE.PlaneGeometry(size, size), emblemMat);
      emblem.position.set(0, L.h * 0.48, dir * (L.d / 2 + 0.006));
      if (dir < 0) emblem.rotation.y = Math.PI;
      this.body.add(emblem);
    }
  }

  private buildAccessory(): void {
    const L = this.look;
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
