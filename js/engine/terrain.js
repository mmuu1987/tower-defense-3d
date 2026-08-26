// 地形：贴图地面（带程序化回退）、路径丝带（斜接关节）、出入口传送门、路径格子标记
import * as THREE from 'three';
import { GRID, cellToWorldX, cellToWorldZ } from '../game/config.js';

export const worldToCell = (x, z) => ({
  cx: Math.floor(x / GRID.cell + GRID.w / 2),
  cz: Math.floor(z / GRID.cell + GRID.h / 2),
});
export const isPathCell = (pathCells, x, z) => {
  const { cx, cz } = worldToCell(x, z);
  return pathCells.has(`${cx},${cz}`);
};

// —— 程序化回退纹理（网络素材缺失时也能看）——
function proceduralTexture(kind) {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  if (kind === 'grass') {
    g.fillStyle = '#5d8a3c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const v = 90 + Math.random() * 70 | 0;
      g.fillStyle = `rgb(${v * 0.55 | 0},${v},${v * 0.4 | 0})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  } else if (kind === 'rock') {
    g.fillStyle = '#4a4038'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1800; i++) {
      const v = 50 + Math.random() * 45 | 0;
      g.fillStyle = `rgb(${v + 12},${v},${v - 6})`;
      g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.2, 0, 7); g.fill();
    }
  } else if (kind === 'snow') { // snow
    g.fillStyle = '#e8f0f8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const v = 225 + Math.random() * 30 | 0;
      g.fillStyle = `rgb(${v - 14},${v - 6},${v})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2.5, 2.5);
    }
  } else { // sand（黄沙戈壁）
    g.fillStyle = '#d8b98a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      const v = 200 + Math.random() * 45 | 0;
      g.fillStyle = `rgb(${v + 16 | 0},${v - 12 | 0},${v - 52 | 0})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    // 风纹：几条淡色水平波纹
    g.strokeStyle = 'rgba(190,155,105,0.5)';
    g.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      const y0 = Math.random() * s;
      g.moveTo(0, y0);
      g.bezierCurveTo(s * 0.3, y0 - 12, s * 0.6, y0 + 12, s, y0);
      g.stroke();
    }
  }  const t = new THREE.CanvasTexture(cv);
  return t;
}

async function loadTexture(url, fallbackKind, repeatXY) {
  let tex = null;
  if (url) {
    tex = await new Promise((res) => {
      new THREE.TextureLoader().load(url, res, undefined, () => res(null));
    });
  }
  if (!tex) tex = proceduralTexture(fallbackKind);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeatXY) tex.repeat.set(repeatXY[0], repeatXY[1]);
  try { tex.anisotropy = 8; } catch {}
  return tex;
}

function buildRibbonGeometry(ptsWorld, width) {
  // pts: [{x,z}...]；输出带 UV 的三角带（长度方向平铺纹理）
  const n = ptsWorld.length;
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = ptsWorld[i];
    const prev = ptsWorld[Math.max(0, i - 1)];
    const next = ptsWorld[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let nx = -dz, nz = dx; // 左法线
    if (i > 0 && i < n - 1) {
      const a = ptsWorld[i - 1], b = ptsWorld[i + 1];
      let ddx = b.x - a.x, ddz = b.z - a.z;
      const l2 = Math.hypot(ddx, ddz) || 1;
      ddx /= l2; ddz /= l2;
      let ax = -ddz, az = ddx;
      // 平均并限制斜接长度，避免尖刺
      let mx = nx + ax, mz = nz + az;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const dot = Math.max(0.35, nx * mx + nz * mz);
      nx = mx / dot; nz = mz / dot;
    }
    if (i > 0) {
        const q = ptsWorld[i - 1];
        dist += Math.hypot(p.x - q.x, p.z - q.z);
    }
    const hw = width / 2;
    pos.push(p.x + nx * hw, 0, p.z + nz * hw);
    pos.push(p.x - nx * hw, 0, p.z - nz * hw);
    uv.push(0, dist / width, 1, dist / width);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export async function buildTerrain({ theme, map }) {
  const group = new THREE.Group();
  const halfW = GRID.w / 2, halfH = GRID.h / 2;

  // 2) 路径世界坐标点与段表（提前计算，供地面“路径区压平”使用）
  const pts = map.waypoints.map(([cx, cz]) => ({ x: cellToWorldX(cx), z: cellToWorldZ(cz) }));
  const psegs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    psegs.push({ ax: a.x, az: a.z, dx: dx / len, dz: dz / len, len });
  }
  const distToPath = (wx, wz) => {
    let best = Infinity;
    for (const s of psegs) {
      const t = THREE.MathUtils.clamp((wx - s.ax) * s.dx + (wz - s.az) * s.dz, 0, s.len);
      const dd = Math.hypot(wx - (s.ax + s.dx * t), wz - (s.az + s.dz * t));
      if (dd < best) best = dd;
    }
    return best;
  };

  // 路径格子集合（供建造判定与装饰避让）
  const pathCells = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (GRID.cell * 0.22));
    for (let s = 0; s <= steps; s++) {
      const x = a.x + (b.x - a.x) * (s / steps);
      const z = a.z + (b.z - a.z) * (s / steps);
      const { cx, cz } = worldToCell(x, z);
      pathCells.add(`${cx},${cz}`);
    }
  }

  // 1) 地面（分段平面 + 大块色斑渐变 + 轻微起伏；路径附近自动压平）
  const groundTex = await loadTexture(theme.groundTex, theme.groundFallback, [20, 15]);
  const GW = GRID.w + 40, GH = GRID.h + 34;
  const groundGeo = new THREE.PlaneGeometry(GW, GH, 56, 42);
  const noise = (x, z) => {
    let v = 0;
    v += Math.sin(x * 0.32 + Math.sin(z * 0.21) * 2.1) * 0.5;
    v += Math.sin(z * 0.45 - Math.cos(x * 0.17) * 1.7) * 0.3;
    v += Math.sin((x + z) * 0.9) * 0.2;
    return v; // ~[-1,1]
  };
  {
    const posA = groundGeo.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const base = new THREE.Color(theme.groundTint);
    const dark = new THREE.Color(
      theme.id === 'meadow' ? 0x3f6b2e
        : theme.id === 'lava' ? 0x2a1512
        : theme.id === 'sand' ? 0x8a6f42
        : 0xbcd4e6,
    );
    const c = new THREE.Color();
    for (let i = 0; i < posA.count; i++) {
      const lx = posA.getX(i), ly = posA.getY(i); // 平面局部坐标
      const wx = lx, wz = -ly;                    // rotateX(-90°) 对应关系
      const dpath = distToPath(wx, wz);
      const flat = THREE.MathUtils.clamp((dpath - 0.85) / 1.4, 0, 1); // 路径旁 0 → 远处 1
      const nBig = noise(lx * 0.16 + 31.7, ly * 0.16 - 12.3);          // 低频大色斑
      const nSmall = noise(lx * 1.1, ly * 1.1) * 0.5 + noise(lx * 3.7, ly * 3.7) * 0.25;
      c.copy(base).multiplyScalar(THREE.MathUtils.clamp(1 + nSmall * 0.14, 0.8, 1.15));
      c.lerp(dark, THREE.MathUtils.clamp(nBig * 0.5 + 0.28, 0, 0.55) * flat * 0.85);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      posA.setZ(i, noise(lx * 0.6, ly * 0.6) * 0.22 * flat); // 起伏，路径区压平
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      map: groundTex, vertexColors: true, roughness: 1, metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 1b) 悬崖围边：Kenney cliff 模型沿地图四周排列（更近更密更高）
  try {
    const { hasModel: _h, makeInstance: _m } = await import('./modellib.js');
    if (_h('border_cliff')) {
      const margin = 3.3;
      const spots = [];
      for (let x = -halfW - 1.2; x <= halfW + 1.2; x += 0.92) {
        spots.push([x, -halfH - margin], [x, halfH + margin]);
      }
      for (let z = -halfH - 0.8; z <= halfH + 0.8; z += 0.92) {
        spots.push([-halfW - margin + 0.4, z], [halfW + margin - 0.4, z]);
      }
      for (const [x, z] of spots) {
        if (Math.random() < 0.08) continue;
        const inst = _m('border_cliff', 1.25 + Math.random() * 0.7);
        if (!inst) continue; // 单点失败跳过该位置（break 会中断整圈围边）
        inst.position.set(x, -0.45, z);
        inst.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3;
        group.add(inst);
      }
    }
  } catch { /* 模型不可用则跳过 */ }

  // 3) 路径丝带：泥土肩带 → 深色描边 → 主路面（三层层次感）
  const dirtMat = new THREE.MeshStandardMaterial({ color: theme.pathTint, roughness: 1 });
  dirtMat.color.multiplyScalar(0.72);
  const shoulder = new THREE.Mesh(buildRibbonGeometry(pts, 1.55), dirtMat);
  shoulder.position.y = 0.015; shoulder.receiveShadow = true;
  const pathTex = await loadTexture('./assets/textures/stone.jpg', 'rock', [1.6, 1.6]);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 1 });
  const edge = new THREE.Mesh(buildRibbonGeometry(pts, 1.18), edgeMat);
  edge.position.y = 0.02; edge.receiveShadow = true;
  const road = new THREE.Mesh(
    buildRibbonGeometry(pts, 0.94),
    new THREE.MeshStandardMaterial({ map: pathTex, color: theme.pathTint, roughness: 0.95 }),
  );
  road.position.y = 0.03; road.receiveShadow = true;

  // 3b) 路面碎石：沿中心线随机散布小石子（InstancedMesh，性能友好）
  {
    const pebbleCount = 70;
    const geo = new THREE.DodecahedronGeometry(0.07, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1, flatShading: true });
    mat.color.multiplyScalar(0.75);
    const im = new THREE.InstancedMesh(geo, mat, pebbleCount);
    im.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < pebbleCount; i++) {
      const segIdx = Math.floor(Math.random() * (pts.length - 1));
      const t = Math.random();
      const x = pts[segIdx].x + (pts[segIdx + 1].x - pts[segIdx].x) * t + (Math.random() - 0.5) * 0.6;
      const z = pts[segIdx].z + (pts[segIdx + 1].z - pts[segIdx].z) * t + (Math.random() - 0.5) * 0.6;
      dummy.position.set(x, 0.042, z);
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.scale.setScalar(0.5 + Math.random() * 0.9);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }
  group.add(shoulder, edge, road);

  // 4) 出入口传送门（发光圆环，泛光高亮）
  const mkPortal = (p, colorHex) => {
    const gp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.09, 10, 36),
      new THREE.MeshStandardMaterial({ color: 0x22252c, emissive: colorHex, emissiveIntensity: 1.9, roughness: 0.4 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 28),
      new THREE.MeshBasicMaterial({ color: colorHex }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.045;
    const light = new THREE.PointLight(colorHex, 6, 4.5);
    light.position.y = 0.6;
    gp.add(ring, disc, light);
    gp.position.set(p.x, 0, p.z);
    return gp;
  };
  group.add(mkPortal(pts[0], theme.accent));
  group.add(mkPortal(pts[pts.length - 1], 0xff5d5d));

  return { group, pathCells, pts };
}
