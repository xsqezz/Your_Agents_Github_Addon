import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FAMILY_LABEL } from '../core/family.ts';
import type { Family, SessionSummary } from '../core/types.ts';
import { Figure, poseFor } from './figures.ts';
import { STATE_COLOR, NEEDS_YOU, STATE_LABEL, stateText } from './theme.ts';

const SPACING_X = 4.5;
const SPACING_Z = 5.4;
const MINI_SPOTS: [number, number][] = [[-1.65, 0.15], [1.65, 0.15], [-1.25, -1.25]];

const stdMat = (color: number, rough = 0.7): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
const box = (w: number, h: number, d: number, r: number, m: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

interface Handlers {
  onSelect: (id: string | null) => void;
}

class Zone {
  readonly id: string;
  readonly group = new THREE.Group();
  readonly target = new THREE.Vector3();
  summary: SessionSummary;
  hover = false;
  selected = false;
  private figure!: Figure;
  private figureKey = '';
  private minis: { holder: THREE.Group; figure: Figure; key: string }[] = [];
  private plateMat = stdMat(0x162130, 0.85);
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private ledMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private shadeMat = new THREE.MeshBasicMaterial({ color: 0xffd58a });
  private color = new THREE.Color();
  private reduced: boolean;
  readonly label: CSS2DObject;
  private el: Record<'btn' | 'name' | 'state' | 'dot' | 'act' | 'ctx' | 'sub', HTMLElement>;
  private cache = new Map<string, string>();

  constructor(s: SessionSummary, reduced: boolean) {
    this.id = s.id;
    this.summary = s;
    this.reduced = reduced;
    this.buildStage();
    this.rebuildFigure();

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
    this.el.btn.dataset.id = s.id;
    this.label = new CSS2DObject(wrap);
    this.label.center.set(0.5, 1);
    this.label.position.set(0, 3.15, 0.3);
    this.group.add(this.label);
    this.apply(s);
  }

  private buildStage(): void {
    const g = this.group;
    const plate = box(3.9, 0.14, 3.9, 0.14, this.plateMat);
    plate.position.y = -0.07;
    plate.castShadow = false;
    const glow = new THREE.Mesh(new RoundedBoxGeometry(4.1, 0.05, 4.1, 2, 0.12), this.glowMat);
    glow.position.y = -0.135;
    g.add(plate, glow);

    const wood = stdMat(0x5a4636, 0.6);
    const top = box(2.5, 0.1, 1.05, 0.04, wood);
    top.position.set(0, 0.78, 1.0);
    g.add(top);
    for (const [x, z] of [[-1.12, 0.6], [1.12, 0.6], [-1.12, 1.4], [1.12, 1.4]]) {
      const leg = box(0.1, 0.73, 0.1, 0.03, stdMat(0x3a2f26));
      leg.position.set(x, 0.365, z);
      g.add(leg);
    }

    const lapMat = stdMat(0x20262f, 0.4);
    const base = box(0.9, 0.04, 0.6, 0.02, lapMat);
    base.position.set(0, 0.85, 1.0);
    const lid = box(0.9, 0.32, 0.04, 0.03, lapMat);
    lid.position.set(0, 1.02, 1.3);
    lid.rotation.x = 0.28;
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), this.ledMat);
    led.position.set(0, 0, 0.026);
    lid.add(led);
    g.add(base, lid);

    const chairMat = stdMat(0x2a3547, 0.6);
    const cbase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), chairMat);
    cbase.position.y = 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), chairMat);
    stem.position.y = 0.31;
    const seat = box(0.98, 0.12, 0.98, 0.05, chairMat);
    seat.position.set(0, 0.6, -0.05);
    const back = box(0.98, 0.78, 0.1, 0.05, chairMat);
    back.position.set(0, 1.05, -0.55);
    g.add(cbase, stem, seat, back);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14), stdMat(0x2b333f));
    lampBase.position.set(-0.95, 0.85, 0.85);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), stdMat(0x2b333f));
    pole.position.set(-0.95, 1.1, 0.85);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 14), this.shadeMat);
    shade.position.set(-0.86, 1.36, 0.85);
    shade.rotation.z = -0.5;
    g.add(lampBase, pole, shade);

    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 14), stdMat(0xe8eef5, 0.4));
    mug.position.set(0.9, 0.9, 1.15);
    mug.castShadow = true;
    g.add(mug);

    const pick = new THREE.Mesh(new THREE.BoxGeometry(3.9, 2.8, 3.9), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = 1.4;
    pick.userData.zoneId = this.id;
    g.add(pick);
  }

  private rebuildFigure(): void {
    const s = this.summary;
    const key = `${s.family}:${s.tier}`;
    if (key === this.figureKey) return;
    if (this.figure) {
      this.group.remove(this.figure.root);
      this.figure.dispose();
    }
    this.figureKey = key;
    this.figure = new Figure(s.family, s.tier, 1, this.reduced);
    this.figure.root.position.set(0, 0.68, -0.05);
    this.group.add(this.figure.root);
  }

  private syncMinis(): void {
    const subs = this.summary.subagents.filter((a) => a.status === 'running').slice(0, MINI_SPOTS.length);
    while (this.minis.length > subs.length) {
      const m = this.minis.pop()!;
      this.group.remove(m.holder);
      m.figure.dispose();
    }
    subs.forEach((a, i) => {
      const key = `${a.family}:${a.tier}`;
      let m = this.minis[i];
      if (m && m.key !== key) {
        this.group.remove(m.holder);
        m.figure.dispose();
        m = undefined as never;
      }
      if (!m) {
        const holder = new THREE.Group();
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.26, 14), stdMat(0x2a3547));
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

  apply(s: SessionSummary): void {
    this.summary = s;
    this.rebuildFigure();
    this.figure.setPose(poseFor(s.state, s.category));
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
    this.group.position.lerp(this.target, this.reduced ? 1 : 1 - Math.exp(-dt * 5));
    const attention = NEEDS_YOU.includes(s.state);
    const base = s.state === 'offline' ? 0.1 : s.state === 'idle' ? 0.2 : s.state === 'stalled' ? 0.22 : 0.42;
    const pulse = attention && !this.reduced ? 0.55 + 0.45 * Math.sin(t * 5) : 1;
    const k = (base + (this.hover || this.selected ? 0.35 : 0)) * pulse;
    this.glowMat.color.copy(this.color).multiplyScalar(Math.min(1, k));
    this.plateMat.emissive.copy(this.color);
    this.plateMat.emissiveIntensity = (this.hover || this.selected ? 0.16 : 0.05) + (attention ? 0.05 * pulse : 0);
    this.shadeMat.color.set(s.state === 'offline' ? 0x2b333f : 0xffd58a);
    this.figure.update(t, dt);
    for (const m of this.minis) m.figure.update(t, dt);
  }

  dispose(): void {
    this.figure.dispose();
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
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private controls: OrbitControls;
  private key: THREE.DirectionalLight;
  private zones = new Map<string, Zone>();
  private order: string[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private clock = new THREE.Clock();
  private time = 0;
  private frame = 0;
  private selectedId: string | null = null;
  private panelPx = 0;
  private userMoved = false;
  private layoutKey = '';
  private tween: { t0: number; dur: number; fp: THREE.Vector3; tp: THREE.Vector3; ft: THREE.Vector3; tt: THREE.Vector3 } | null = null;
  private down = { x: 0, y: 0 };
  private hoverId: string | null = null;
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'gl';

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(0x090d12);
    this.scene.fog = new THREE.Fog(0x090d12, 38, 110);

    this.scene.add(new THREE.HemisphereLight(0xaec6e8, 0x141b26, 0.75));
    this.key = new THREE.DirectionalLight(0xffe6c8, 2.3);
    this.key.position.set(9, 15, 11);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x6d9cff, 0.7);
    fill.position.set(-10, 7, -8);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), stdMat(0x0c121a, 1));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 70;
    this.controls.addEventListener('start', () => {
      if (!this.tween) this.userMoved = true;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      const id = this.pick(e);
      if (id) this.handlers.onSelect(id);
      else if (this.selectedId) this.handlers.onSelect(null);
    });
    dom.addEventListener('pointermove', (e) => {
      const id = this.pick(e);
      if (id !== this.hoverId) {
        this.hoverId = id;
        dom.style.cursor = id ? 'pointer' : 'grab';
        for (const z of this.zones.values()) z.hover = z.id === id;
      }
    });
    this.labels.domElement.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button.tag') as HTMLElement | null;
      if (btn?.dataset.id) this.handlers.onSelect(btn.dataset.id);
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.camera.position.set(0, 9, 12);
    this.controls.target.set(0, 0.7, 0);
    this.loop();
  }

  private pick(e: PointerEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.zones.values()].map((z) => z.group), true);
    for (const h of hits) if (h.object.userData.zoneId) return h.object.userData.zoneId as string;
    return null;
  }

  setSessions(list: SessionSummary[]): void {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, z] of this.zones) {
      if (!ids.has(id)) {
        this.scene.remove(z.group);
        z.dispose();
        this.zones.delete(id);
        if (this.selectedId === id) this.handlers.onSelect(null);
      }
    }
    for (const s of list) {
      const z = this.zones.get(s.id);
      if (z) z.apply(s);
      else {
        const nz = new Zone(s, this.reduced);
        nz.group.position.set(0, 0, 0);
        this.zones.set(s.id, nz);
        this.scene.add(nz.group);
        nz.group.userData.fresh = true;
      }
    }
    this.order = list.map((s) => s.id);
    this.layout();
  }

  private dims(): { cols: number; rows: number } {
    const n = this.order.length;
    const cols = n <= 1 ? 1 : Math.ceil(Math.sqrt(n * 1.5));
    return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
  }

  private layout(): void {
    const { cols, rows } = this.dims();
    this.order.forEach((id, i) => {
      const z = this.zones.get(id)!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      z.target.set((col - (cols - 1) / 2) * SPACING_X, 0, (row - (rows - 1) / 2) * SPACING_Z);
      if (z.group.userData.fresh) {
        z.group.position.copy(z.target);
        z.group.userData.fresh = false;
      }
    });
    const ext = Math.max(cols * SPACING_X, rows * SPACING_Z) * 0.6 + 4;
    const sc = this.key.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 80;
    sc.updateProjectionMatrix();
    const key = `${cols}x${rows}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      if (!this.userMoved && !this.selectedId) this.frameAll(this.order.length > 0 && this.zones.size > 0);
    }
  }

  setSelected(id: string | null, panelPx: number): void {
    this.selectedId = id;
    this.panelPx = panelPx;
    for (const z of this.zones.values()) z.setSelected(z.id === id);
    this.labels.domElement.classList.toggle('focus', !!id);
    this.applyView();
    if (id) this.focusZone(id);
    else this.frameAll(true);
  }

  frameAll(animate = true): void {
    this.userMoved = false;
    const { cols, rows } = this.dims();
    const w = cols * SPACING_X;
    const d = rows * SPACING_Z;
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const aspect = this.width / this.height;
    const pitch = (56 * Math.PI) / 180;
    const usableW = Math.max(300, this.width - this.panelPx);
    const usableH = Math.max(300, this.height - 120);
    const needH = d * Math.sin(pitch) + 3.4;
    const needW = w + 1.2;
    const distV = needH / 2 / (half * (usableH / this.height));
    const distH = needW / 2 / (half * aspect * (usableW / this.width));
    const dist = Math.max(8, distV, distH);
    const target = new THREE.Vector3(0, 0.9, 0);
    const pos = new THREE.Vector3(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.go(pos, target, animate);
  }

  private focusZone(id: string): void {
    const z = this.zones.get(id);
    if (!z) return;
    const p = z.target;
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
    if (!this.userMoved && !this.selectedId && this.zones.size) this.frameAll(false);
  }

  private updateTagScale(): void {
    const first = this.zones.values().next().value as Zone | undefined;
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
    for (const z of this.zones.values()) z.update(this.time, dt);
    if (this.frame++ % 6 === 0) this.updateTagScale();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}

export type { Family };
