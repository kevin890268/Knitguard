import * as THREE from 'three';
import { BK, BUILDING_KINDS, UNIT_KINDS } from '../sim/data';
import { Tile } from '../sim/map';
import type { Building, World } from '../sim/world';
import { RtsCamera } from './camera';
import { buildingMesh, treeGeometry, unitGeometry } from './models';
import { makeKnitTexture, WoolMaterials } from './wool';

const TILE_COLORS: Record<number, number> = {
  [Tile.Grass]: 0xa8cf86,
  [Tile.Rock]: 0xb9b2a6,
  [Tile.Tree]: 0x8cbc70,
  [Tile.Water]: 0x8cc3df,
};

/**
 * 繪圖層：只「讀」World 的狀態，不改它。
 * 單位用 InstancedMesh → 每種單位 1 個 draw call，不管有幾千隻。
 */
export class GameRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RtsCamera;
  readonly mats: WoolMaterials;
  showFlow = false;
  selected: Building | null = null;

  private world!: World;
  private mapGroup = new THREE.Group();
  private unitMeshes: THREE.InstancedMesh[] = [];
  private kindColors: THREE.Color[] = [];
  private counts: Int32Array;
  private buildingObjs = new Map<number, { obj: THREE.Group; level: number; bar: THREE.Mesh }>();
  private bVersion = -1;
  private flowVersion = -1;
  private flowLines: THREE.LineSegments;
  private shotLines: THREE.LineSegments;
  private ghost: THREE.Mesh;
  private selRing: THREE.Mesh;
  private rallyFlag: THREE.Group;
  private rangeRing: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private white = new THREE.Color(0xffffff);

  constructor(private readonly container: HTMLElement, unitCap: number) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    container.appendChild(this.gl.domElement);

    this.cam = new RtsCamera(this.gl.domElement);
    this.mats = new WoolMaterials(makeKnitTexture());

    const bg = new THREE.Color(0xf3e9dc);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 90, 220);
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7a6a, 1.4));
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 1; sc.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.mapGroup);

    // 單位：每種一個 InstancedMesh
    this.counts = new Int32Array(UNIT_KINDS.length);
    const geoCache = new Map<string, THREE.BufferGeometry>();
    for (const k of UNIT_KINDS) {
      let geo = geoCache.get(k.model);
      if (!geo) { geo = unitGeometry(k.model); geoCache.set(k.model, geo); }
      const mesh = new THREE.InstancedMesh(geo, this.mats.get(0xffffff, { vertexColors: true }), unitCap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(unitCap * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      this.unitMeshes.push(mesh);
      this.kindColors.push(new THREE.Color(k.color));
      this.scene.add(mesh);
    }

    // 箭矢 / 毛線射擊
    const shotGeo = new THREE.BufferGeometry();
    shotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2048 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.shotLines = new THREE.LineSegments(shotGeo, new THREE.LineBasicMaterial({ color: 0xff6f91 }));
    this.shotLines.frustumCulled = false;
    this.scene.add(this.shotLines);

    this.flowLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3355aa, transparent: true, opacity: 0.6 }));
    this.flowLines.frustumCulled = false;
    this.scene.add(this.flowLines);

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.9 }));
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    this.rallyFlag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), this.mats.get(0x6b4a2a));
    pole.position.y = 0.5;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.03), this.mats.get(0x4a8be0));
    flag.position.set(0.2, 0.85, 0);
    this.rallyFlag.add(pole, flag);
    this.rallyFlag.visible = false;
    this.scene.add(this.rallyFlag);

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  set unitShadows(v: boolean) {
    for (const m of this.unitMeshes) m.castShadow = v;
  }
  get unitShadows(): boolean {
    return this.unitMeshes[0]?.castShadow ?? false;
  }

  resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.gl.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- 地圖
  setWorld(world: World): void {
    this.world = world;
    for (const c of [...this.mapGroup.children]) {
      this.mapGroup.remove(c);
      c.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    }
    for (const { obj } of this.buildingObjs.values()) this.scene.remove(obj);
    this.buildingObjs.clear();
    this.bVersion = -1;
    this.flowVersion = -1;
    this.selected = null;

    const map = world.map;
    this.mapGroup.add(this.buildGround(world));

    // 水面：放在地面下方，只有凹陷處看得到
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(map.w, map.h).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.75, roughness: 0.3 }),
    );
    water.position.set(map.w / 2, -0.12, map.h / 2);
    this.mapGroup.add(water);

    // 底座（像擺在桌上的毛氈板）
    const board = new THREE.Mesh(new THREE.BoxGeometry(map.w + 2, 1, map.h + 2), this.mats.get(0xc79a74));
    board.position.set(map.w / 2, -0.75, map.h / 2);
    board.receiveShadow = true;
    this.mapGroup.add(board);

    // 岩石與樹（instanced）
    const rocks: number[] = [], trees: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] === Tile.Rock) rocks.push(i);
      else if (map.tiles[i] === Tile.Tree) trees.push(i);
    }
    const rockMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0), this.mats.get(0xa59d92, { flat: true }), Math.max(1, rocks.length));
    const treeMesh = new THREE.InstancedMesh(treeGeometry(), this.mats.get(0xffffff, { vertexColors: true }), Math.max(1, trees.length));
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const hash = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    rocks.forEach((i, n) => {
      const x = i % map.w, y = Math.floor(i / map.w), r = hash(i);
      q.setFromAxisAngle(up, r * 6.28);
      s.set(0.9 + r * 0.4, 0.7 + hash(i + 7) * 1.1, 0.9 + hash(i + 3) * 0.4);
      p.set(x + 0.5, 0.15, y + 0.5);
      rockMesh.setMatrixAt(n, this.tmpM.compose(p, q, s));
    });
    trees.forEach((i, n) => {
      const x = i % map.w, y = Math.floor(i / map.w), r = hash(i);
      q.setFromAxisAngle(up, r * 6.28);
      const sc = 0.8 + r * 0.5;
      s.set(sc, sc, sc);
      p.set(x + 0.5 + (hash(i + 1) - 0.5) * 0.3, 0, y + 0.5 + (hash(i + 2) - 0.5) * 0.3);
      treeMesh.setMatrixAt(n, this.tmpM.compose(p, q, s));
      treeMesh.setColorAt(n, this.tmpC.setHSL(0.25 + r * 0.08, 0.35, 0.75 + r * 0.25));
    });
    rockMesh.count = rocks.length;
    treeMesh.count = trees.length;
    for (const m of [rockMesh, treeMesh]) { m.castShadow = true; m.receiveShadow = true; this.mapGroup.add(m); }

    this.cam.bounds = { w: map.w, h: map.h };
    this.cam.target.set(map.baseX + 1.5, 0, map.baseY + 1.5);
    this.sun.position.set(map.w / 2 + 30, 60, map.h / 2 + 20);
    this.sun.target.position.set(map.w / 2, 0, map.h / 2);
  }

  private buildGround(world: World): THREE.Mesh {
    const map = world.map, W = map.w, H = map.h, vw = W + 1;
    const nv = vw * (H + 1);
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const c = new THREE.Color(), acc = new THREE.Color();
    for (let vy = 0; vy <= H; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        const v = vy * vw + vx;
        acc.setRGB(0, 0, 0);
        let n = 0, water = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx, ty = vy + dy;
          if (!map.inBounds(tx, ty)) continue;
          const t = map.tiles[ty * W + tx];
          c.setHex(TILE_COLORS[t]);
          acc.r += c.r; acc.g += c.g; acc.b += c.b;
          n++;
          if (t === Tile.Water) water++;
        }
        const jitter = 0.94 + Math.random() * 0.1;
        col[v * 3] = (acc.r / n) * jitter; col[v * 3 + 1] = (acc.g / n) * jitter; col[v * 3 + 2] = (acc.b / n) * jitter;
        pos[v * 3] = vx;
        pos[v * 3 + 1] = water === n ? -0.35 : water > 0 ? -0.1 : Math.random() * 0.03;
        pos[v * 3 + 2] = vy;
        uv[v * 2] = vx / 2; uv[v * 2 + 1] = vy / 2;
      }
    }
    const idx: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = y * vw + x, b = a + 1, cc = a + vw, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mats.get(0xffffff, { vertexColors: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------- 每幀
  setGhost(visible: boolean, tx = 0, ty = 0, size = 1, ok = true): void {
    this.ghost.visible = visible;
    if (!visible) return;
    this.ghost.scale.set(size, 1, size);
    this.ghost.position.set(tx + size / 2, 0.3, ty + size / 2);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x66ff66 : 0xff5555);
  }

  render(alpha: number): void {
    const w = this.world;
    if (w.buildingsVersion !== this.bVersion) this.syncBuildings();
    this.updateBuildingBars();
    this.updateUnits(alpha);
    this.updateShots();
    this.updateSelection();
    this.flowLines.visible = this.showFlow;
    if (this.showFlow && w.flow.version !== this.flowVersion) this.rebuildFlowLines();
    this.gl.render(this.scene, this.cam.camera);
  }

  private syncBuildings(): void {
    const w = this.world;
    this.bVersion = w.buildingsVersion;
    const alive = new Set<number>();
    for (const b of w.buildings) {
      alive.add(b.id);
      const cur = this.buildingObjs.get(b.id);
      if (cur && cur.level === b.level) continue;
      if (cur) this.scene.remove(cur.obj);
      const obj = buildingMesh(b.kind, b.level, BUILDING_KINDS[b.kind].color, this.mats);
      obj.position.set(b.tx + b.size / 2, 0, b.ty + b.size / 2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x5ad35a }));
      bar.position.y = b.kind === BK.Base ? 4.1 : b.kind === BK.Wall ? 1.3 : 2.4;
      bar.visible = false;
      obj.add(bar);
      this.scene.add(obj);
      this.buildingObjs.set(b.id, { obj, level: b.level, bar });
    }
    for (const [id, v] of this.buildingObjs) {
      if (!alive.has(id)) { this.scene.remove(v.obj); this.buildingObjs.delete(id); }
    }
  }

  private updateBuildingBars(): void {
    for (const b of this.world.buildings) {
      const v = this.buildingObjs.get(b.id);
      if (!v) continue;
      const r = b.hp / b.maxHp;
      v.bar.visible = r < 0.999;
      if (v.bar.visible) {
        v.bar.scale.x = Math.max(0.01, r) * b.size;
        (v.bar.material as THREE.MeshBasicMaterial).color.setHex(r > 0.5 ? 0x5ad35a : r > 0.25 ? 0xf0c040 : 0xe05050);
      }
      v.obj.position.y = b.hitT > 0 ? -0.05 : 0; // 被打時輕微下沉
    }
  }

  private updateUnits(alpha: number): void {
    const u = this.world.units, t = this.world.time, counts = this.counts, m = this.tmpM, v = this.tmpV;
    counts.fill(0);
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const k = u.kind[i], kind = UNIT_KINDS[k], mesh = this.unitMeshes[k], n = counts[k]++;
      const x = u.px[i] + (u.x[i] - u.px[i]) * alpha;
      const y = u.py[i] + (u.y[i] - u.py[i]) * alpha;
      const moving = u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > 0.05;
      const bob = moving ? Math.abs(Math.sin(t * 12 + i)) * 0.12 * kind.scale : 0;
      const s = kind.scale;
      m.makeRotationY(u.face[i]);
      m.scale(v.set(s, s * (1 - bob * 0.5), s));
      m.setPosition(x, bob, y);
      mesh.setMatrixAt(n, m);
      const c = this.kindColors[k];
      if (u.hitT[i] > 0) mesh.setColorAt(n, this.tmpC.copy(c).lerp(this.white, 0.7));
      else mesh.setColorAt(n, c);
    }
    for (let k = 0; k < this.unitMeshes.length; k++) {
      const mesh = this.unitMeshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  private updateShots(): void {
    const shots = this.world.shots;
    const attr = this.shotLines.geometry.attributes.position as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const n = Math.min(shots.length, 2048);
    for (let i = 0; i < n; i++) {
      const s = shots[i], o = i * 6;
      a[o] = s.x1; a[o + 1] = 1.8; a[o + 2] = s.y1;
      a[o + 3] = s.x2; a[o + 4] = 0.35; a[o + 5] = s.y2;
    }
    attr.needsUpdate = true;
    this.shotLines.geometry.setDrawRange(0, n * 2);
  }

  private updateSelection(): void {
    const b = this.selected;
    if (b && b.dead) this.selected = null;
    const sel = this.selected;
    this.selRing.visible = !!sel;
    this.rangeRing.visible = false;
    this.rallyFlag.visible = false;
    if (!sel) return;
    const cx = sel.tx + sel.size / 2, cy = sel.ty + sel.size / 2;
    this.selRing.position.set(cx, 0.05, cy);
    this.selRing.scale.setScalar(sel.size * 0.75);
    if (sel.kind === BK.Tower) {
      const r = this.world.towerRange(sel);
      this.rangeRing.visible = true;
      this.rangeRing.position.set(cx, 0.06, cy);
      this.rangeRing.scale.setScalar(r);
    }
    if (sel.kind === BK.Barracks) {
      this.rallyFlag.visible = true;
      this.rallyFlag.position.set(sel.rallyX, 0, sel.rallyY);
    }
  }

  private rebuildFlowLines(): void {
    const w = this.world, f = w.flow, W = w.map.w, H = w.map.h;
    const pts: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (f.dirX[i] === 0 && f.dirY[i] === 0) continue;
      const cx = x + 0.5, cy = y + 0.5;
      pts.push(cx, 0.08, cy, cx + f.dirX[i] * 0.45, 0.08, cy + f.dirY[i] * 0.45);
    }
    this.flowLines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.flowLines.geometry = g;
    this.flowVersion = f.version;
  }
}
