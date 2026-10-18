import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SessionSummary } from '../core/types.ts';
import { Figure, poseFor } from './figures.ts';
import { Hall } from './hall.ts';
import { COLS, deskPos, hallSize, MIN_DESKS, rowsFor, SPACING_X, SPACING_Z } from './layout.ts';
import { drawActivity, drawFocus, Monitor, SCREEN_H, SCREEN_W, TOP_H, TOP_W } from './screens.ts';
import { isOccupied, NEEDS_YOU, STATE_COLOR } from './theme.ts';

const MINI_SPOTS: [number, number][] = [[-1.75, 0.55], [1.75, 0.55], [-1.35, 1.5]];
const NEUTRAL = new THREE.Color(0xcfcfcf);

const stdMat = (color: number, rough = 0.7, metal = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const box = (w: number, h: number, d: number, r: number, m: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const numberTextures = new Map<number, THREE.CanvasTexture>();
function numberTexture(n: number): THREE.CanvasTexture {
  let tex = numberTextures.get(n);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a8a8a';
  g.font = '600 44px "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n).padStart(2, '0'), 64, 34);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTextures.set(n, tex);
  return tex;
}

interface Handlers {
  onSelect: (id: string | null) => void;
  onEmptyDesk?: () => void;
}

/** One fixed desk. A session claims it; the agent sits down while it works and leaves when it is idle or offline. */
class Desk {
  readonly index: number;
  readonly group = new THREE.Group();
  summary: SessionSummary | null = null;
  hover = false;
  selected = false;
  private reduced: boolean;
  private chair = new THREE.Group();
  private holder = new THREE.Group();
  private monitors: Monitor[] = [];
  private screenSig = '';
  private swivel = Math.PI;
  private figure: Figure | null = null;
  private figureKey = '';
  private minis: { holder: THREE.Group; figure: Figure; key: string }[] = [];
  private rugMat = stdMat(0xdcdcdc, 0.9, 0);
  private glowMat = new THREE.MeshBasicMaterial({ color: 0xcfcfcf, toneMapped: false });
  private shadeMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3a });
  private color = new THREE.Color();
  private glow = new THREE.Color();
  private occ = 0;
  private tuck = 1;

  constructor(index: number, reduced: boolean) {
    this.index = index;
    this.reduced = reduced;
    this.build();

    this.holder.visible = false;
    this.holder.scale.setScalar(0.001);
    this.chair.position.z = -0.45;
  }

  private build(): void {
    const g = this.group;

    const rug = box(4.2, 0.05, 4.0, 0.02, this.rugMat);
    rug.position.y = 0.025;
    rug.castShadow = false;
    g.add(rug);
    for (const [w, d, x, z] of [[4.2, 0.14, 0, 1.93], [4.2, 0.14, 0, -1.93], [0.14, 4.0, 2.03, 0], [0.14, 4.0, -2.03, 0]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), this.glowMat);
      bar.position.set(x, 0.058, z);
      g.add(bar);
    }
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: numberTexture(this.index + 1), transparent: true }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(-1.6, 0.058, 1.68);
    g.add(num);

    const oak = stdMat(0xd2d2d2, 0.5, 0.02);
    const steel = stdMat(0x222222, 0.4, 0.6);
    const top = box(4.0, 0.07, 1.05, 0.03, oak);
    top.position.set(0, 0.78, -1.0);
    g.add(top);
    for (const x of [-1.9, 1.9]) {
      const leg = box(0.07, 0.75, 0.9, 0.02, steel);
      leg.position.set(x, 0.375, -1.0);
      g.add(leg);
    }
    const rail = box(3.7, 0.05, 0.05, 0.015, steel);
    rail.position.set(0, 0.6, -1.4);
    g.add(rail);

    const keyMat = stdMat(0x2a2a2a, 0.5, 0.2);
    const keyboard = box(1.1, 0.025, 0.3, 0.01, keyMat);
    keyboard.position.set(-0.1, 0.83, -0.66);
    const mouse = box(0.1, 0.03, 0.16, 0.04, keyMat);
    mouse.position.set(0.8, 0.83, -0.66);
    g.add(keyboard, mouse);

    // Ultrawide monitor below, a narrower 16:9 one centred above it with a soundbar in between (order in `monitors`: [top, main]).
    const frameMat = stdMat(0x141414, 0.45, 0.5);
    const rig = new THREE.Group();
    rig.position.set(0, 0.95, -1.2);
    rig.rotation.x = -0.28;
    const main = new Monitor(3.8, 1.75, SCREEN_W, SCREEN_H);
    main.group.position.y = 1.75 / 2;
    const upper = new Monitor(3.1, 1.79, TOP_W, TOP_H);
    upper.group.position.y = 1.75 + 0.14 + 1.79 / 2;
    const bar = box(2.4, 0.09, 0.12, 0.03, frameMat);
    bar.position.set(0, 1.75 + 0.07, 0.0);
    const barGlow = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    barGlow.position.set(0, 1.75 + 0.07, 0.065);
    rig.add(main.group, upper.group, bar, barGlow);
    g.add(rig);
    this.monitors.push(upper, main);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.08), frameMat);
    neck.position.set(0, 0.86, -1.25);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.025, 0.46), frameMat);
    foot.position.set(0, 0.8325, -1.12);
    g.add(neck, foot);

    const chairMat = stdMat(0x8a8a8a, 0.85, 0.02);
    const chrome = stdMat(0xbdbdbd, 0.25, 0.8);
    const cbase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), chrome);
    cbase.position.y = 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), chrome);
    stem.position.y = 0.31;
    const seat = box(0.98, 0.12, 0.98, 0.05, chairMat);
    seat.position.set(0, 0.6, -0.05);
    const back = box(0.98, 0.42, 0.1, 0.05, chairMat);
    back.position.set(0, 0.9, -0.55);
    for (const m of [cbase, stem]) m.castShadow = true;
    this.holder.position.set(0, 0.68, -0.05);
    this.chair.add(cbase, stem, seat, back, this.holder);
    g.add(this.chair);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), steel);
    lampBase.position.set(-2.12, 0.02, -0.1);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), steel);
    pole.position.set(-2.12, 0.87, -0.1);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.26, 16), this.shadeMat);
    shade.position.set(-2.12, 1.78, -0.1);
    g.add(lampBase, pole, shade);

    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 14), stdMat(0xf4f4f4, 0.35));
    mug.position.set(1.75, 0.885, -0.7);
    mug.castShadow = true;
    g.add(mug);

    const pick = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.0, 4.0), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = 2.0;
    pick.userData.deskIndex = this.index;
    g.add(pick);
  }

  private rebuildFigure(): void {
    const s = this.summary;
    if (!s) return;
    const key = `${s.family}:${s.tier}`;
    if (key === this.figureKey) return;
    if (this.figure) {
      this.holder.remove(this.figure.root);
      this.figure.dispose();
    }
    this.figureKey = key;
    this.figure = new Figure(s.family, s.tier, 1, this.reduced);
    this.holder.add(this.figure.root);
  }

  private syncMinis(): void {
    const s = this.summary;
    const subs = s && isOccupied(s.state) ? s.subagents.filter((a) => a.status === 'running').slice(0, MINI_SPOTS.length) : [];
    while (this.minis.length > subs.length) {
      const m = this.minis.pop()!;
      this.group.remove(m.holder);
      m.figure.dispose();
    }
    subs.forEach((a, i) => {
      const key = `${a.family}:${a.tier}`;
      let m: { holder: THREE.Group; figure: Figure; key: string } | undefined = this.minis[i];
      if (m && m.key !== key) {
        this.group.remove(m.holder);
        m.figure.dispose();
        m = undefined;
      }
      if (!m) {
        const holder = new THREE.Group();
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.26, 14), stdMat(0x5e5e5e, 0.85));
        stool.position.y = 0.13;
        stool.castShadow = true;
        const figure = new Figure(a.family, a.tier, 0.5, this.reduced);
        figure.root.position.y = 0.3;
        holder.add(stool, figure.root);
        holder.position.set(MINI_SPOTS[i][0], 0, MINI_SPOTS[i][1]);
        this.group.add(holder);
        m = { holder, figure, key };
        this.minis[i] = m;
      }
      m.figure.setPose(a.currentTool ? 'read' : 'shell');
    });
  }

  assign(s: SessionSummary | null): void {
    this.summary = s;
    if (!s) {
      this.hover = false;
      this.selected = false;
      this.color.set('#ffffff');
      this.syncMinis();
      return;
    }
    this.rebuildFigure();
    this.figure?.setPose(poseFor(s.state, s.category));
    this.syncMinis();
    this.color.set(STATE_COLOR[s.state]);
    this.screenSig = [
      s.state, s.activity, s.model, s.subagents.map((a) => `${a.status}${a.currentTool ?? ''}`).join(','),
      s.feed.map((f) => `${f.ts}${f.status ?? ''}${f.text.length}`).join(','),
      `${s.focus?.ts}${s.focus?.status}${s.focus?.text.length}`,
    ].join('|');

  }

  setSelected(v: boolean): void {
    this.selected = v;
  }

  /** Jump straight to the resting pose (used when switching rooms). */
  snap(): void {
    const s = this.summary;
    const sitting = !!s;
    const faceRoom = !!s && (NEEDS_YOU.includes(s.state) || s.state === 'done');
    this.occ = sitting ? 1 : 0;
    this.tuck = sitting ? 0 : 1;
    this.swivel = faceRoom ? 0 : Math.PI;
  }

  update(t: number, dt: number): void {
    const s = this.summary;
    // Every session of the room keeps its desk: it sits there asleep when it is not running.
    const sitting = !!s;
    const faceRoom = !!s && (NEEDS_YOU.includes(s.state) || s.state === 'done');
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    this.occ += ((sitting ? 1 : 0) - this.occ) * k;
    this.tuck += ((sitting ? 0 : 1) - this.tuck) * k * 0.8;
    // Working agents face their monitors (back to us); they swivel round when they need you.
    this.swivel += ((faceRoom ? 0 : Math.PI) - this.swivel) * k * 0.7;

    this.holder.visible = this.occ > 0.03;
    this.holder.scale.setScalar(Math.max(0.001, this.occ));
    this.chair.position.z = 0.1 - this.tuck * 0.55;
    this.chair.rotation.y = this.swivel + this.tuck * 0.5;

    const attention = !!s && NEEDS_YOU.includes(s.state);
    let amt = !s ? (this.hover ? 0.45 : 0) : s.state === 'offline' ? 0.12 : s.state === 'idle' ? 0.3 : s.state === 'stalled' ? 0.4 : 1;
    if (attention && !this.reduced) amt *= 0.7 + 0.3 * Math.sin(t * 5);
    if ((this.hover || this.selected) && s) amt = 1;
    this.glow.copy(NEUTRAL).lerp(this.color, amt);
    this.glowMat.color.copy(this.glow);
    this.rugMat.emissive.copy(this.color);
    this.rugMat.emissiveIntensity = s ? (this.hover || this.selected ? 0.12 : 0.03) : this.hover ? 0.07 : 0;
    this.shadeMat.color.set(sitting ? 0xffffff : 0x3a3a3a);

    this.drawScreens(sitting ? s : null, t);

    if (this.figure && this.holder.visible) this.figure.update(t, dt);
    for (const m of this.minis) m.figure.update(t, dt);
  }

  private drawScreens(s: SessionSummary | null, t: number): void {
    const [top, main] = this.monitors;
    if (!s) {
      top.render(null, 'off', 0x2a2a2a);
      main.render(null, 'off', 0x2a2a2a);
      return;
    }
    const phase = this.reduced ? 0 : Math.floor(t * 2.4);
    const key = `${this.screenSig}|${phase}`;
    const led = this.color.getHex();
    // Agents that are not running keep their last screen, dimmed, like a monitor on standby.
    const dim = s.state === 'offline' ? 0.6 : s.state === 'idle' ? 0.25 : 0;
    const paint = (draw: (ctx: CanvasRenderingContext2D) => void) => (ctx: CanvasRenderingContext2D): void => {
      draw(ctx);
      if (dim) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${dim})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }
    };
    top.render(paint((ctx) => drawActivity(ctx, s, phase)), key, led);
    main.render(paint((ctx) => drawFocus(ctx, s, phase, Date.now())), key, led);
  }

  dispose(): void {
    this.figure?.dispose();
    for (const m of this.minis) m.figure.dispose();
    for (const m of this.monitors) m.dispose();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
  }
}

export class OfficeScene {
  private container: HTMLElement;
  private handlers: Handlers;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  private controls: OrbitControls;
  private key: THREE.DirectionalLight;
  private hall = new Hall();
  private desks: Desk[] = [];
  private assigned = new Map<string, number>();
  private byRoom = new Map<string, Map<string, number>>();
  private roomId = '';
  private snapAll = false;
  private leftPx = 0;
  private rows = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private clock = new THREE.Clock();
  private time = 0;
  private selectedId: string | null = null;
  private panelPx = 0;
  private userMoved = false;
  private tween: { t0: number; dur: number; fp: THREE.Vector3; tp: THREE.Vector3; ft: THREE.Vector3; tt: THREE.Vector3 } | null = null;
  private down = { x: 0, y: 0 };
  private hoverDesk = -1;
  private width = 1;
  private height = 1;
  private raf = 0;

  constructor(container: HTMLElement, handlers: Handlers) {
    this.container = container;
    this.handlers = handlers;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'gl';

    this.scene.background = new THREE.Color(0x050505);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b4b4, 0.8));
    this.key = new THREE.DirectionalLight(0xffffff, 2.4);
    this.key.position.set(-9, 20, 13);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.03;
    this.scene.add(this.key, this.key.target);
    this.scene.add(this.hall.group);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 80;
    this.controls.addEventListener('start', () => {
      if (!this.tween) this.userMoved = true;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      const idx = this.pick(e);
      const id = idx >= 0 ? this.desks[idx].summary?.id : undefined;
      if (id) this.handlers.onSelect(id);
      else if (idx >= 0) {
        if (this.selectedId) this.handlers.onSelect(null);
        this.handlers.onEmptyDesk?.();
      } else if (this.selectedId) this.handlers.onSelect(null);
    });
    dom.addEventListener('pointermove', (e) => {
      const hit = this.pick(e);
      if (hit !== this.hoverDesk) {
        this.hoverDesk = hit;
        dom.style.cursor = hit >= 0 ? 'pointer' : 'grab';
        for (const d of this.desks) d.hover = d.index === hit;
      }
    });

    this.ensureDesks(MIN_DESKS);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.frameAll(false);
    this.loop();
  }

  private pick(e: PointerEvent): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.desks.map((d) => d.group), true);
    for (const h of hits) if (typeof h.object.userData.deskIndex === 'number') return h.object.userData.deskIndex as number;
    return -1;
  }

  private ensureDesks(count: number): void {
    while (this.desks.length < count) {
      const d = new Desk(this.desks.length, this.reduced);
      this.desks.push(d);
      this.scene.add(d.group);
    }
    const rows = rowsFor(this.desks.length);
    if (rows !== this.rows) {
      this.rows = rows;
      this.hall.build(rows);
      const { w, d } = hallSize(rows);
      const ext = Math.max(w, d) / 2 + 2;
      const sc = this.key.shadow.camera;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 90;
      sc.updateProjectionMatrix();
      if (!this.userMoved && !this.selectedId) this.frameAll(false);
    }
    for (const d of this.desks) {
      const [x, z] = deskPos(d.index, this.rows);
      d.group.position.set(x, 0, z);
      d.group.rotation.y = this.facesWindow(d.index) ? Math.PI : 0;
    }
  }

  /** The row next to the window is turned round: its agents face the room, their monitors face the window. */
  private facesWindow(index: number): boolean {
    return Math.floor(index / COLS) === 0;
  }

  /** Always exactly MIN_DESKS desks per room. With more sessions than desks, working agents get seats first. */
  setSessions(list: SessionSummary[], roomId: string, roomName: string): void {
    if (roomId !== this.roomId) {
      this.roomId = roomId;
      for (const d of this.desks) {
        d.assign(null);
        d.snap();
      }
      this.assigned = this.byRoom.get(roomId) ?? new Map<string, number>();
      this.byRoom.set(roomId, this.assigned);
      this.snapAll = true;
    }
    this.hall.setTitle(roomName);

    const byId = new Map(list.map((s) => [s.id, s]));
    const ranked = list
      .map((s, i) => ({ s, i }))
      .sort((a, b) => Number(!isOccupied(a.s.state)) - Number(!isOccupied(b.s.state)) || a.i - b.i)
      .slice(0, MIN_DESKS);
    const wanted = new Set(ranked.map((r) => r.s.id));

    for (const [id, idx] of [...this.assigned]) {
      if (byId.has(id) && wanted.has(id)) continue;
      this.assigned.delete(id);
      this.desks[idx]?.assign(null);
      if (this.selectedId === id) this.handlers.onSelect(null);
    }
    this.ensureDesks(MIN_DESKS);
    const taken = new Set(this.assigned.values());
    for (const { s } of ranked) {
      if (this.assigned.has(s.id)) continue;
      const free = this.desks.find((d) => !taken.has(d.index));
      if (!free) continue;
      taken.add(free.index);
      this.assigned.set(s.id, free.index);
    }
    for (const { s } of ranked) {
      const idx = this.assigned.get(s.id);
      if (idx !== undefined) this.desks[idx].assign(s);
    }
    if (this.snapAll) {
      for (const d of this.desks) d.snap();
      this.snapAll = false;
    }
  }

  /** Space taken by the room list on the left; the camera centres the hall in what is left. */
  setInsets(left: number): void {
    if (left === this.leftPx) return;
    this.leftPx = left;
    this.applyView();
    if (!this.userMoved && !this.selectedId) this.frameAll(false);
  }

  setSelected(id: string | null, panelPx: number): void {
    this.selectedId = id;
    this.panelPx = panelPx;
    for (const d of this.desks) d.setSelected(!!id && d.summary?.id === id);
    this.applyView();
    if (id) this.focusDesk(id);
    else this.frameAll(true);
  }

  frameAll(animate = true): void {
    this.userMoved = false;
    const rows = Math.max(1, this.rows);
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const aspect = this.width / this.height;
    const pitch = (53 * Math.PI) / 180;
    const usableW = Math.max(300, this.width - this.panelPx - this.leftPx);
    const usableH = Math.max(300, this.height - 120);
    const needH = rows * SPACING_Z * Math.sin(pitch) + 8.2;
    const needW = COLS * SPACING_X + 6.5;
    const distV = needH / 2 / (half * (usableH / this.height));
    const distH = needW / 2 / (half * aspect * (usableW / this.width));
    const dist = Math.max(12, distV, distH);
    this.go(new THREE.Vector3(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist), new THREE.Vector3(0, 1.2, 0.2), animate);
  }

  private focusDesk(id: string): void {
    const idx = this.assigned.get(id);
    if (idx === undefined) return;
    const p = this.desks[idx].group.position;
    this.userMoved = true;
    // Monitors face away from the room in the window row, so view those desks from the window side.
    const dir = this.facesWindow(idx) ? -1 : 1;
    this.go(new THREE.Vector3(p.x, p.y + 8.4, p.z + dir * 4.0), new THREE.Vector3(p.x, p.y + 2.2, p.z - dir * 1.2), true);
  }

  /** Puts the camera somewhere exact (used by --cam/--look to check views from any side). */
  setCamera(pos: [number, number, number], target: [number, number, number]): void {
    this.userMoved = true;
    this.go(new THREE.Vector3(...pos), new THREE.Vector3(...target), false);
  }

  private go(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (!animate || this.reduced) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.tween = null;
      return;
    }
    this.tween = { t0: this.time, dur: 0.95, fp: this.camera.position.clone(), tp: pos, ft: this.controls.target.clone(), tt: target };
  }

  private applyView(): void {
    const shift = (this.panelPx - this.leftPx) / 2;
    if (shift !== 0) this.camera.setViewOffset(this.width, this.height, shift, 0, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.applyView();
    if (!this.userMoved && !this.selectedId) this.frameAll(false);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    if (this.tween) {
      const k = Math.min(1, (this.time - this.tween.t0) / this.tween.dur);
      const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
      this.camera.position.lerpVectors(this.tween.fp, this.tween.tp, e);
      this.controls.target.lerpVectors(this.tween.ft, this.tween.tt, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    this.hall.update(this.camera.position, dt, this.reduced);
    for (const d of this.desks) d.update(this.time, dt);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
