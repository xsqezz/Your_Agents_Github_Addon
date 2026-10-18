import * as THREE from 'three';
import { hallSize, SPACING_Z } from './layout.ts';

const std = (color: number, rough = 0.6, metal = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const basic = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color });

let concrete: THREE.CanvasTexture | null = null;
function concreteTexture(): THREE.CanvasTexture {
  if (concrete) return concrete;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9c9c9';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 38; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 60 + Math.random() * 120;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(90,86,80,0.07)' : 'rgba(255,255,250,0.09)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
  }
  for (let i = 0; i < 4500; i++) {
    const v = 170 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v - 3},${v - 9},0.22)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(70,66,60,0.38)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 509, 509);
  concrete = new THREE.CanvasTexture(c);
  concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
  concrete.colorSpace = THREE.SRGBColorSpace;
  concrete.anisotropy = 8;
  return concrete;
}

let sky: THREE.CanvasTexture | null = null;
function skyTexture(): THREE.CanvasTexture {
  if (sky) return sky;
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#141414');
  grad.addColorStop(0.35, '#4a4a4a');
  grad.addColorStop(0.58, '#b4b4b4');
  grad.addColorStop(0.75, '#e2e2e2');
  grad.addColorStop(1, '#e2e2e2');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let layer = 0; layer < 2; layer++) {
    const base = H;
    g.fillStyle = layer === 0 ? '#6a6a6a' : '#2a2a2a';
    let x = 0;
    while (x < W) {
      const bw = 30 + rnd() * 80;
      const bh = (layer === 0 ? 110 : 50) + rnd() * (layer === 0 ? 170 : 130);
      g.fillRect(x, base - bh, bw, bh);
      if (layer === 1) {
        for (let wy = base - bh + 8; wy < base - 4; wy += 12) {
          for (let wx = x + 6; wx < x + bw - 7; wx += 11) {
            if (rnd() < 0.3) {
              g.fillStyle = rnd() < 0.8 ? '#f2f2f2' : '#bdbdbd';
              g.fillRect(wx, wy, 4, 6);
            }
          }
        }
        g.fillStyle = '#2a2a2a';
      }
      x += bw + 2 + rnd() * 8;
    }
  }
  sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.wrapS = THREE.RepeatWrapping;
  return sky;
}

/** The modernist hall: a closed room — concrete floor, plaster walls with a window band to the city, oak slat wall, plants and a lounge. */
export class Hall {
  readonly group = new THREE.Group();
  private built: THREE.Object3D | null = null;
  private sign: THREE.Mesh | null = null;
  private title = '';
  private rows = 1;

  build(rows: number): void {
    this.clear();
    const root = new THREE.Group();
    const { w: W, d: D } = hallSize(rows);
    const zBack = -D / 2;
    const zFront = D / 2;
    const wallH = 6.4;
    const frame = std(0x151515, 0.4, 0.55);
    const white = std(0xf0f0f0, 0.8);
    const add = (mesh: THREE.Object3D, shadow = true): THREE.Object3D => {
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = shadow;
          m.receiveShadow = true;
        }
      });
      root.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };

    // Floor slab spans the whole footprint, wall thickness included. Nothing exists outside the building.
    const tex = concreteTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(W / 6, D / 6);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.02 });
    const side = std(0x262626, 0.9);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, D + 0.6), [side, side, top, side, side, side]);
    slab.position.y = -0.25;
    add(slab, false);

    // Brass inlays between desk rows.
    const brass = std(0xd9d9d9, 0.35, 0.7);
    for (let r = 0; r < rows - 1; r++) add(box(W - 0.6, 0.012, 0.07, brass, 0, 0.006, (r + 0.5 - (rows - 1) / 2) * SPACING_Z), false);

    // Closed room: plaster walls on all four sides, ceiling left open for the camera. Local frame of each
    // wall: runs along x, interior face at z = 0, body behind it (z < 0).
    const plaster = std(0xf4f4f4, 0.9);
    const oak = std(0x8c8c8c, 0.55);
    const SILL = 1.0;
    const HEAD = 5.0;
    const MID = (SILL + HEAD) / 2;
    const part = (g: THREE.Group, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): void => {
      g.add(box(w, h, d, mat, x, y, z));
    };
    const glazed = (len: number, glassLen: number): THREE.Group => {
      const g = new THREE.Group();
      part(g, len, SILL, 0.3, plaster, 0, SILL / 2, -0.15);
      part(g, len, wallH - HEAD, 0.3, plaster, 0, (HEAD + wallH) / 2, -0.15);
      const pier = (len - glassLen) / 2;
      for (const s of [-1, 1]) part(g, pier, HEAD - SILL, 0.3, plaster, s * (glassLen / 2 + pier / 2), MID, -0.15);
      const n = Math.max(2, Math.round(glassLen / 3));
      for (let i = 0; i <= n; i++) part(g, 0.1, HEAD - SILL, 0.14, frame, -glassLen / 2 + (i * glassLen) / n, MID, -0.07);
      part(g, glassLen, 0.07, 0.1, frame, 0, 3.1, -0.07);
      part(g, glassLen, 0.06, 0.45, oak, 0, SILL + 0.03, 0.08);

      const view = skyTexture().clone();
      view.needsUpdate = true;
      view.repeat.set(glassLen / (HEAD - SILL) / 4, 1);
      const scene = new THREE.Mesh(new THREE.PlaneGeometry(glassLen, HEAD - SILL), new THREE.MeshBasicMaterial({ map: view, toneMapped: false }));
      scene.position.set(0, MID, -0.14);
      g.add(scene);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(glassLen, HEAD - SILL), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.2, depthWrite: false }));
      glass.position.set(0, MID, -0.03);
      g.add(glass);
      return g;
    };
    const place = (g: THREE.Group, x: number, z: number, rotY: number): void => {
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      add(g, false);
    };
    place(glazed(W + 0.6, W - 1.2), 0, zBack, 0);
    place(glazed(D, D - 1.2), W / 2, 0, -Math.PI / 2);

    // Front wall: a low parapet, so the room reads as closed without hiding the desks from the camera.
    const parapet = new THREE.Group();
    part(parapet, W + 0.6, 1.0, 0.3, plaster, 0, 0.5, -0.15);
    part(parapet, W + 0.6, 0.06, 0.34, frame, 0, 1.03, -0.15);
    place(parapet, 0, zFront, Math.PI);

    // Left wall: warm oak slats over a dark felt backing, with LED strips.
    add(box(0.3, wallH, D, std(0x1c1c1c, 1), -W / 2 - 0.15, wallH / 2, 0), false);
    const slatCount = Math.floor(D / 0.26);
    const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, wallH - 0.5, 0.15), oak, slatCount);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < slatCount; i++) {
      m4.makeTranslation(-W / 2 + 0.06, (wallH - 0.5) / 2 + 0.1, zBack + 0.2 + i * 0.26);
      slats.setMatrixAt(i, m4);
    }
    slats.castShadow = true;
    slats.receiveShadow = true;
    root.add(slats);
    root.add(box(0.05, 0.05, D, basic(0xffffff), -W / 2 + 0.17, 0.95, 0));
    root.add(box(0.05, 0.05, D, basic(0xffffff), -W / 2 + 0.17, wallH - 0.4, 0));

    // Low credenza along the oak wall.
    const credZ = zBack + 5.2;
    add(box(0.75, 0.78, 6.4, white, -W / 2 + 0.55, 0.39, credZ));
    add(box(0.8, 0.05, 6.5, std(0x5a5a5a, 0.5), -W / 2 + 0.55, 0.805, credZ));

    // Lounge sofa on the glass side.
    const sofa = std(0x3a3a3a, 0.85);
    add(box(1.05, 0.42, 3.3, sofa, W / 2 - 1.0, 0.21, 0));
    add(box(0.28, 0.62, 3.3, sofa, W / 2 - 0.58, 0.55, 0));
    add(box(0.5, 0.26, 1.5, std(0xeaeaea, 0.5), W / 2 - 1.8, 0.13, 0));
    add(box(0.4, 0.04, 1.3, std(0x5a5a5a, 0.5), W / 2 - 1.8, 0.28, 0));

    // Plants.
    const plant = (x: number, z: number, s: number, y = 0): void => {
      const g = new THREE.Group();
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * s, 0.26 * s, 0.55 * s, 18), std(0xeeeeee, 0.6));
      pot.position.y = 0.275 * s;
      g.add(pot);
      const leaf = std(0x3f8f5a, 0.7);
      const leaf2 = std(0x2f7a49, 0.7);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 14, 10), i % 2 ? leaf : leaf2);
        l.scale.set(0.8, 1.7, 0.8);
        l.position.set(Math.cos(a) * 0.22 * s, (1.0 + (i % 3) * 0.18) * s, Math.sin(a) * 0.22 * s);
        l.rotation.z = Math.cos(a) * 0.35;
        l.rotation.x = Math.sin(a) * 0.35;
        g.add(l);
      }
      g.position.set(x, y, z);
      add(g);
    };
    plant(-W / 2 + 1.4, zBack + 1.0, 1.5);
    plant(W / 2 - 1.2, zBack + 1.0, 1.5);
    plant(W / 2 - 1.2, zFront - 1.1, 1.3);
    plant(-W / 2 + 1.3, zFront - 1.1, 1.3);
    plant(-W / 2 + 0.55, credZ - 2.2, 0.75, 0.83);
    plant(-W / 2 + 0.55, credZ + 2.2, 0.75, 0.83);
    plant(W / 2 - 1.0, 2.9, 0.9);
    plant(W / 2 - 1.0, -2.9, 0.9);

    this.group.add(root);
    this.built = root;
    this.rows = rows;
    this.placeSign();
  }

  /** The room name, painted on the floor in front of the last desk row. */
  setTitle(name: string): void {
    if (name === this.title) return;
    this.title = name;
    this.placeSign();
  }

  private placeSign(): void {
    if (this.sign) {
      this.group.remove(this.sign);
      (this.sign.material as THREE.MeshBasicMaterial).map?.dispose();
      (this.sign.material as THREE.Material).dispose();
      this.sign.geometry.dispose();
      this.sign = null;
    }
    if (!this.built || !this.title) return;
    const cw = 1536;
    const ch = 160;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d')!;
    const label = this.title.toUpperCase();
    let size = 104;
    g.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    const spacing = 0.12;
    const measure = (): number => g.measureText(label).width + label.length * size * spacing;
    while (measure() > cw - 40 && size > 24) {
      size -= 4;
      g.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    }
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(size * spacing).toFixed(1)}px`;
    g.fillStyle = 'rgba(20,20,20,0.82)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, cw / 2 + (size * spacing) / 2, ch / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const { w: W, d: D } = hallSize(this.rows);
    const width = Math.min(W - 6, 15);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * ch) / cw),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.02, D / 2 - 1.1);
    mesh.renderOrder = 1;
    this.sign = mesh;
    this.group.add(mesh);
  }

  private clear(): void {
    if (!this.built) return;
    this.group.remove(this.built);
    this.built.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.built = null;
  }
}
