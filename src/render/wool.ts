import * as THREE from 'three';

/**
 * 程式產生的「針織」貼圖：一排排 V 字型針目 + 毛絮雜點。
 * 灰白色調，和頂點色/材質色相乘後，任何顏色都會變成毛線質感。
 */
export function makeKnitTexture(): THREE.CanvasTexture {
  const S = 128, cw = 16, ch = 16;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8b8b8';
  g.fillRect(0, 0, S, S);
  for (let y = -ch; y < S + ch; y += ch) {
    for (let x = 0; x < S; x += cw) {
      for (const side of [-1, 1]) {
        g.save();
        g.translate(x + cw / 2 + side * cw * 0.22, y + ch / 2);
        g.rotate(side * 0.5);
        const grd = g.createLinearGradient(-cw * 0.3, 0, cw * 0.3, 0);
        grd.addColorStop(0, '#c4c4c4');
        grd.addColorStop(0.5, '#ffffff');
        grd.addColorStop(1, '#c4c4c4');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(0, 0, cw * 0.27, ch * 0.62, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.10)';
        g.lineWidth = 1;
        g.stroke();
        g.restore();
      }
    }
  }
  for (let k = 0; k < 1800; k++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 材質快取：同色共用材質，減少 draw call 狀態切換。 */
export class WoolMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(readonly knit: THREE.Texture) {}

  get(color: number, opts: { flat?: boolean; vertexColors?: boolean } = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${opts.flat ? 1 : 0}|${opts.vertexColors ? 1 : 0}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        map: this.knit,
        roughness: 1,
        metalness: 0,
        flatShading: !!opts.flat,
        vertexColors: !!opts.vertexColors,
      });
      this.cache.set(key, m);
    }
    return m;
  }
}
