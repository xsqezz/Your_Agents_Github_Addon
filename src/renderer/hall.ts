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
  g.fillStyle = '#cdc9c1';
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
  grad.addColorStop(0, '#1b2a4a');
  grad.addColorStop(0.35, '#5073a8');
  grad.addColorStop(0.58, '#f1b98a');
  grad.addColorStop(0.75, '#f7d3a2');
  grad.addColorStop(1, '#f7d3a2');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let layer = 0; layer < 2; layer++) {
    const base = H;
    g.fillStyle = layer === 0 ? '#4a5268' : '#242a3a';
    let x = 0;
    while (x < W) {
      const bw = 30 + rnd() * 80;
      const bh = (layer === 0 ? 110 : 50) + rnd() * (layer === 0 ? 170 : 130);
      g.fillRect(x, base - bh, bw, bh);
      if (layer === 1) {
        for (let wy = base - bh + 8; wy < base - 4; wy += 12) {
          for (let wx = x + 6; wx < x + bw - 7; wx += 11) {
            if (rnd() < 0.3) {
              g.fillStyle = rnd() < 0.8 ? '#ffd9a1' : '#bfe0ff';
              g.fillRect(wx, wy, 4, 6);
            }
          }
        }
        g.fillStyle = '#242a3a';
      }
      x += bw + 2 + rnd() * 8;
    }
  }
  sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.wrapS = THREE.RepeatWrapping;
  return sky;
}

/** The modernist hall: concrete slab, glass curtain walls on two sides, oak slat wall, plants and a lounge. */
export class Hall {
  readonly group = new THREE.Group();
  private built: THREE.Object3D | null = null;

  build(rows: number): void {
    this.clear();
    const root = new THREE.Group();
    const { w: W, d: D } = hallSize(rows);
    const zBack = -D / 2;
    const zFront = D / 2;
    const wallH = 6.9;
    const frame = std(0x1e2329, 0.4, 0.55);
    const white = std(0xf1efea, 0.8);
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

    // Slab with a polished-concrete top.
    const tex = concreteTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(W / 6, D / 6);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.02 });
    const side = std(0x232830, 0.9);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, D + 0.6), [side, side, top, side, side, side]);
    slab.position.y = -0.25;
    add(slab, false);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), std(0x0e1217, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.52;
    ground.receiveShadow = true;
    root.add(ground);

    // Brass inlays between desk rows.
    const brass = std(0xc9a45c, 0.35, 0.7);
    for (let r = 0; r < rows - 1; r++) add(box(W - 0.6, 0.012, 0.07, brass, 0, 0.006, (r + 0.5 - (rows - 1) / 2) * SPACING_Z), false);

    // Back wall: low plinth, glass above, black mullions.
    const n = Math.round(W / 3);
    add(box(W + 0.6, 0.9, 0.3, white, 0, 0.45, zBack - 0.15));
    add(box(W + 0.6, 0.26, 0.3, frame, 0, wallH, zBack - 0.15));
    add(box(W, 0.08, 0.14, frame, 0, 4.5, zBack - 0.1));
    for (let i = 0; i <= n; i++) add(box(0.12, wallH - 0.9, 0.18, frame, -W / 2 + (i * W) / n, 0.9 + (wallH - 0.9) / 2, zBack - 0.1));
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbcd4ee, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(W, wallH - 0.9), glassMat);
    pane.position.set(0, 0.9 + (wallH - 0.9) / 2, zBack - 0.08);
    root.add(pane);

    // Right wall: the same glazing, running along z.
    const nz = Math.round(D / 3);
    add(box(0.3, 0.9, D + 0.6, white, W / 2 + 0.15, 0.45, 0));
    add(box(0.3, 0.26, D + 0.6, frame, W / 2 + 0.15, wallH, 0));
    add(box(0.14, 0.08, D, frame, W / 2 + 0.1, 4.5, 0));
    for (let i = 0; i <= nz; i++) add(box(0.18, wallH - 0.9, 0.12, frame, W / 2 + 0.1, 0.9 + (wallH - 0.9) / 2, zBack + (i * D) / nz));
    const pane2 = new THREE.Mesh(new THREE.PlaneGeometry(D, wallH - 0.9), glassMat);
    pane2.rotation.y = -Math.PI / 2;
    pane2.position.set(W / 2 + 0.08, 0.9 + (wallH - 0.9) / 2, 0);
    root.add(pane2);

    // Left wall: warm oak slats over a dark felt backing, with LED strips.
    add(box(0.3, wallH, D + 0.6, std(0x2a2521, 1), -W / 2 - 0.15, wallH / 2, 0));
    const slatCount = Math.floor(D / 0.26);
    const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, wallH - 0.5, 0.15), std(0xb98a59, 0.55), slatCount);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < slatCount; i++) {
      m4.makeTranslation(-W / 2 + 0.06, (wallH - 0.5) / 2 + 0.1, zBack + 0.2 + i * 0.26);
      slats.setMatrixAt(i, m4);
    }
    slats.castShadow = true;
    slats.receiveShadow = true;
    root.add(slats);
    root.add(box(0.05, 0.05, D, basic(0xffe0b0), -W / 2 + 0.17, 0.95, 0));
    root.add(box(0.05, 0.05, D, basic(0xffe0b0), -W / 2 + 0.17, wallH - 0.4, 0));

    // Low credenza along the oak wall.
    const credZ = zBack + 5.2;
    add(box(0.75, 0.78, 6.4, white, -W / 2 + 0.55, 0.39, credZ));
    add(box(0.8, 0.05, 6.5, std(0x7a5736, 0.5), -W / 2 + 0.55, 0.805, credZ));

    // Lounge sofa on the glass side.
    const sofa = std(0x3c4552, 0.85);
    add(box(1.05, 0.42, 3.3, sofa, W / 2 - 1.0, 0.21, 0));
    add(box(0.28, 0.62, 3.3, sofa, W / 2 - 0.58, 0.55, 0));
    add(box(0.5, 0.26, 1.5, std(0xe9e6df, 0.5), W / 2 - 1.8, 0.13, 0));
    add(box(0.4, 0.04, 1.3, std(0x7a5736, 0.5), W / 2 - 1.8, 0.28, 0));

    // Plants.
    const plant = (x: number, z: number, s: number, y = 0): void => {
      const g = new THREE.Group();
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * s, 0.26 * s, 0.55 * s, 18), std(0xe7e3dc, 0.6));
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

    // Sky and skyline seen through the glass.
    // City panorama just behind the glass: seen from above, rays through the windows land on these.
    const backdrop = (width: number, x: number, z: number, rotY: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false }));
      m.position.set(x, 4.5, z);
      m.rotation.y = rotY;
      root.add(m);
    };
    backdrop(W + 70, 0, zBack - 5, 0);
    backdrop(D + 40, W / 2 + 5, 0, -Math.PI / 2);

    this.group.add(root);
    this.built = root;
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
