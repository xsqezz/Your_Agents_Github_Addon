import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SessionSummary } from '../core/types.ts';
import { Figure, poseFor } from './figures.ts';
import { Hall } from './hall.ts';
import { capacityFor, COLS, deskPos, hallSize, rowsFor, SPACING_X, SPACING_Z } from './layout.ts';
import { isOccupied, NEEDS_YOU, STATE_COLOR, STATE_LABEL, stateText } from './theme.ts';

const MINI_SPOTS: [number, number][] = [[-1.65, 0.15], [1.65, 0.15], [-1.25, -1.25]];
const NEUTRAL = new THREE.Color(0xd2cec6);
const LID_OPEN = 0.28;
const LID_CLOSED = -1.5;

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
  g.fillStyle = '#8a857b';
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
}

type Tag = Record<'btn' | 'name' | 'state' | 'dot' | 'act' | 'ctx' | 'sub', HTMLElement>;

/** One fixed desk. A session claims it; the agent sits down while it works and leaves when it is idle or offline. */
class Desk {
  readonly index: number;
  readonly group = new THREE.Group();
  summary: SessionSummary | null = null;
  hover = false;
  selected = false;
  readonly label: CSS2DObject;
  private reduced: boolean;
  private chair = new THREE.Group();
  private holder = new THREE.Group();
  private hinge = new THREE.Group();
  private figure: Figure | null = null;
  private figureKey = '';
  private minis: { holder: THREE.Group; figure: Figure; key: string }[] = [];
  private rugMat = stdMat(0xddd8cf, 0.9, 0);
  private glowMat = new THREE.MeshBasicMaterial({ color: 0xd2cec6 });
  private ledMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private shadeMat = new THREE.MeshBasicMaterial({ color: 0x3a3f47 });
  private color = new THREE.Color();
  private glow = new THREE.Color();
  private occ = 0;
  private tuck = 1;
  private lid = LID_CLOSED;
  private el: Tag;
  private cache = new Map<string, string>();

  constructor(index: number, reduced: boolean) {
    this.index = index;
    this.reduced = reduced;
    this.build();

    const wrap = document.createElement('div');
    wrap.className = 'tag-wrap';
    wrap.innerHTML = `<button class="tag" type="button">
      <span class="tag-name"></span>
      <span class="tag-state"><i class="dot"></i><b></b><span class="ctx"><i></i></span></span>
      <span class="tag-act"></span>
      <span class="tag-sub"></span>
    </button>`;
    const q = (sel: string) => wrap.querySelector(sel) as HTMLElement;
    this.el = { btn: q('.tag'), name: q('.tag-name'), state: q('.tag-state b'), dot: q('.dot'), act: q('.tag-act'), ctx: q('.ctx i'), sub: q('.tag-sub') };
    this.label = new CSS2DObject(wrap);
    this.label.center.set(0.5, 1);
    this.label.position.set(0, 3.15, 0.3);
    this.label.visible = false;
    this.group.add(this.label);
    this.holder.visible = false;
    this.holder.scale.setScalar(0.001);
    this.hinge.rotation.x = LID_CLOSED;
    this.chair.position.z = 0.5;
  }

  private build(): void {
    const g = this.group;

    const rug = box(3.9, 0.05, 3.9, 0.02, this.rugMat);
    rug.position.y = 0.025;
    rug.castShadow = false;
    g.add(rug);
    for (const [w, d, x, z] of [[3.9, 0.07, 0, 1.915], [3.9, 0.07, 0, -1.915], [0.07, 3.9, 1.915, 0], [0.07, 3.9, -1.915, 0]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), this.glowMat);
      bar.position.set(x, 0.055, z);
      g.add(bar);
    }
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: numberTexture(this.index + 1), transparent: true }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(-1.45, 0.058, 1.62);
    g.add(num);

    const oak = stdMat(0xcfae7c, 0.5, 0.02);
    const steel = stdMat(0x22262b, 0.4, 0.6);
    const top = box(2.5, 0.07, 1.05, 0.03, oak);
    top.position.set(0, 0.78, 1.0);
    g.add(top);
    for (const x of [-1.15, 1.15]) {
      const leg = box(0.07, 0.75, 0.9, 0.02, steel);
      leg.position.set(x, 0.375, 1.0);
      g.add(leg);
    }
    const rail = box(2.3, 0.05, 0.05, 0.015, steel);
    rail.position.set(0, 0.6, 1.4);
    g.add(rail);

    const silver = stdMat(0xbfc5cd, 0.3, 0.7);
    const base = box(0.9, 0.03, 0.6, 0.015, silver);
    base.position.set(0, 0.835, 1.0);
    g.add(base);
    this.hinge.position.set(0, 0.85, 1.3);
    const lid = box(0.9, 0.32, 0.03, 0.02, silver);
    lid.position.y = 0.16;
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), this.ledMat);
    led.position.set(0, 0, 0.02);
    lid.add(led);
    this.hinge.add(lid);
    g.add(this.hinge);

    const chairMat = stdMat(0x8791a0, 0.85, 0.02);
    const chrome = stdMat(0xb8bec6, 0.25, 0.8);
    const cbase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), chrome);
    cbase.position.y = 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), chrome);
    stem.position.y = 0.31;
    const seat = box(0.98, 0.12, 0.98, 0.05, chairMat);
    seat.position.set(0, 0.6, -0.05);
    const back = box(0.98, 0.62, 0.1, 0.05, chairMat);
    back.position.set(0, 0.97, -0.55);
    for (const m of [cbase, stem]) m.castShadow = true;
    this.holder.position.set(0, 0.68, -0.05);
    this.chair.add(cbase, stem, seat, back, this.holder);
    g.add(this.chair);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 14), steel);
    lampBase.position.set(-0.95, 0.835, 0.85);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), steel);
    pole.position.set(-0.95, 1.08, 0.85);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 14), this.shadeMat);
    shade.position.set(-0.86, 1.34, 0.85);
    shade.rotation.z = -0.5;
    g.add(lampBase, pole, shade);

    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 14), stdMat(0xf4f2ee, 0.35));
    mug.position.set(0.9, 0.885, 1.15);
    mug.castShadow = true;
    g.add(mug);

    const pick = new THREE.Mesh(new THREE.BoxGeometry(3.9, 2.8, 3.9), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = 1.4;
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
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.26, 14), stdMat(0x59636f, 0.85));
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
    this.label.visible = !!s;
    if (!s) {
      this.hover = false;
      this.selected = false;
      this.syncMinis();
      return;
    }
    this.rebuildFigure();
    this.figure?.setPose(poseFor(s.state, s.category));
    this.syncMinis();
    this.color.set(STATE_COLOR[s.state]);
    this.ledMat.color.copy(this.color);

    const set = (key: string, el: HTMLElement, text: string) => {
      if (this.cache.get(key) === text) return;
      this.cache.set(key, text);
      el.textContent = text;
    };
    const subsRunning = s.subagents.filter((a) => a.status === 'running').length;
    set('name', this.el.name, s.title);
    set('state', this.el.state, stateText(s));
    set('act', this.el.act, s.state === 'offline' ? '' : s.activity);
    set('sub', this.el.sub, subsRunning ? `+ ${subsRunning} sub-agent${subsRunning > 1 ? 's' : ''}` : '');
    this.el.ctx.style.width = `${Math.round((s.contextPct ?? 0) * 100)}%`;
    this.el.btn.dataset.id = s.id;
    this.el.btn.dataset.state = s.state;
    this.el.btn.dataset.needs = NEEDS_YOU.includes(s.state) ? '1' : '0';
    this.el.btn.setAttribute('aria-label', `${s.title}: ${STATE_LABEL[s.state]}. ${s.state === 'offline' ? '' : s.activity}`);
    this.el.dot.style.background = STATE_COLOR[s.state];
    this.el.btn.classList.toggle('is-selected', this.selected);
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.el.btn.classList.toggle('is-selected', v);
  }

  update(t: number, dt: number): void {
    const s = this.summary;
    const sitting = !!s && isOccupied(s.state);
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    this.occ += ((sitting ? 1 : 0) - this.occ) * k;
    this.tuck += ((sitting ? 0 : 1) - this.tuck) * k * 0.8;
    this.lid += ((sitting ? LID_OPEN : LID_CLOSED) - this.lid) * k;

    this.holder.visible = this.occ > 0.03;
    this.holder.scale.setScalar(Math.max(0.001, this.occ));
    this.chair.position.z = -0.1 + this.tuck * 0.6;
    this.chair.rotation.y = this.tuck * 0.5;
    this.hinge.rotation.x = this.lid;

    const attention = !!s && NEEDS_YOU.includes(s.state);
    let amt = !s ? 0 : s.state === 'offline' ? 0.12 : s.state === 'idle' ? 0.3 : s.state === 'stalled' ? 0.4 : 0.85;
    if (attention && !this.reduced) amt *= 0.65 + 0.35 * Math.sin(t * 5);
    if ((this.hover || this.selected) && s) amt = Math.min(1, amt + 0.3);
    this.glow.copy(NEUTRAL).lerp(this.color, amt);
    this.glowMat.color.copy(this.glow);
    this.rugMat.emissive.copy(this.color);
    this.rugMat.emissiveIntensity = s ? (this.hover || this.selected ? 0.12 : 0.03) : 0;
    this.shadeMat.color.set(sitting ? 0xffd58a : 0x3a3f47);
    if (!sitting) this.ledMat.color.set(0x000000);
    else this.ledMat.color.copy(this.color);

    if (this.figure && this.holder.visible) this.figure.update(t, dt);
    for (const m of this.minis) m.figure.update(t, dt);
  }

  dispose(): void {
    this.figure?.dispose();
    for (const m of this.minis) m.figure.dispose();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    this.label.element.remove();
  }
}

export class OfficeScene {
  private container: HTMLElement;
  private handlers: Handlers;
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  private controls: OrbitControls;
  private key: THREE.DirectionalLight;
  private hall = new Hall();
  private desks: Desk[] = [];
  private assigned = new Map<string, number>();
  private rows = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private clock = new THREE.Clock();
  private time = 0;
  private frame = 0;
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

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(0x0e1217);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xe2ecff, 0xb9b3a8, 0.8));
    this.key = new THREE.DirectionalLight(0xfff0dc, 2.4);
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
      else if (this.selectedId) this.handlers.onSelect(null);
    });
    dom.addEventListener('pointermove', (e) => {
      const idx = this.pick(e);
      const hit = idx >= 0 && this.desks[idx].summary ? idx : -1;
      if (hit !== this.hoverDesk) {
        this.hoverDesk = hit;
        dom.style.cursor = hit >= 0 ? 'pointer' : 'grab';
        for (const d of this.desks) d.hover = d.index === hit;
      }
    });
    this.labels.domElement.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button.tag') as HTMLElement | null;
      if (btn?.dataset.id) this.handlers.onSelect(btn.dataset.id);
    });

    this.ensureDesks(capacityFor(0));
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
    while (this.desks.length > count && !this.desks[this.desks.length - 1].summary) {
      const d = this.desks.pop()!;
      this.scene.remove(d.group);
      d.dispose();
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
    }
  }

  setSessions(list: SessionSummary[]): void {
    const byId = new Map(list.map((s) => [s.id, s]));
    for (const [id, idx] of [...this.assigned]) {
      if (byId.has(id)) continue;
      this.assigned.delete(id);
      this.desks[idx]?.assign(null);
      if (this.selectedId === id) this.handlers.onSelect(null);
    }
    const highest = Math.max(-1, ...this.assigned.values());
    this.ensureDesks(capacityFor(list.length, highest));
    for (const s of list) {
      if (this.assigned.has(s.id)) continue;
      const free = this.desks.find((d) => !d.summary);
      if (!free) continue;
      this.assigned.set(s.id, free.index);
      free.assign(s);
    }
    for (const s of list) {
      const idx = this.assigned.get(s.id);
      if (idx !== undefined) this.desks[idx].assign(s);
    }
    this.ensureDesks(capacityFor(list.length, Math.max(-1, ...this.assigned.values())));
  }

  setSelected(id: string | null, panelPx: number): void {
    this.selectedId = id;
    this.panelPx = panelPx;
    for (const d of this.desks) d.setSelected(!!id && d.summary?.id === id);
    this.labels.domElement.classList.toggle('focus', !!id);
    this.applyView();
    if (id) this.focusDesk(id);
    else this.frameAll(true);
  }

  frameAll(animate = true): void {
    this.userMoved = false;
    const rows = Math.max(1, this.rows);
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const aspect = this.width / this.height;
    const pitch = (49 * Math.PI) / 180;
    const usableW = Math.max(300, this.width - this.panelPx);
    const usableH = Math.max(300, this.height - 120);
    const needH = rows * SPACING_Z * Math.sin(pitch) + 8.2;
    const needW = COLS * SPACING_X + 7;
    const distV = needH / 2 / (half * (usableH / this.height));
    const distH = needW / 2 / (half * aspect * (usableW / this.width));
    const dist = Math.max(12, distV, distH);
    this.go(new THREE.Vector3(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist), new THREE.Vector3(0, 1.4, -0.4), animate);
  }

  private focusDesk(id: string): void {
    const idx = this.assigned.get(id);
    if (idx === undefined) return;
    const p = this.desks[idx].group.position;
    this.userMoved = true;
    this.go(new THREE.Vector3(p.x, p.y + 6.2, p.z + 7.4), new THREE.Vector3(p.x, p.y + 1.5, p.z - 0.2), true);
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
    if (this.panelPx > 0) this.camera.setViewOffset(this.width, this.height, this.panelPx / 2, 0, this.width, this.height);
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
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyView();
    if (!this.userMoved && !this.selectedId) this.frameAll(false);
  }

  private updateTagScale(): void {
    const first = this.desks[0];
    if (!first) return;
    const a = first.group.position.clone();
    const b = a.clone().add(new THREE.Vector3(SPACING_X, 0, 0));
    a.project(this.camera);
    b.project(this.camera);
    const px = Math.abs(b.x - a.x) * 0.5 * this.width;
    const scale = Math.min(1.1, Math.max(0.5, px / 215));
    this.labels.domElement.style.setProperty('--tag-scale', scale.toFixed(3));
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
    for (const d of this.desks) d.update(this.time, dt);
    if (this.frame++ % 6 === 0) this.updateTagScale();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
