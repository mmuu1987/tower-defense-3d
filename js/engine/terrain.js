// 地形系统：多级落差阶梯台地、悬崖岩层断壁、外围深渊峡谷与远景环形群山
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

// —— 程序化回退纹理（无网络素材时也能保持高品质美术风格）——
function proceduralTexture(kind) {
  const s = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  if (kind === 'grass') {
    g.fillStyle = '#4e7b32'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      const v = 85 + Math.random() * 80 | 0;
      g.fillStyle = `rgb(${v * 0.55 | 0},${v},${v * 0.38 | 0})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 3);
    }
  } else if (kind === 'rock') {
    g.fillStyle = '#3a342e'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 3000; i++) {
      const v = 45 + Math.random() * 55 | 0;
      g.fillStyle = `rgb(${v + 14},${v + 2},${v - 8})`;
      g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 0, 7); g.fill();
    }
  } else if (kind === 'snow') {
    g.fillStyle = '#dbe6f2'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      const v = 215 + Math.random() * 40 | 0;
      g.fillStyle = `rgb(${v - 16},${v - 8},${v})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2.5, 2.5);
    }
  } else { // sand & dark
    g.fillStyle = kind === 'dark' ? '#1e2822' : '#d2b17e';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 3500; i++) {
      const v = kind === 'dark' ? (30 + Math.random() * 35 | 0) : (185 + Math.random() * 55 | 0);
      g.fillStyle = kind === 'dark'
        ? `rgb(${v * 0.7 | 0},${v},${v * 0.85 | 0})`
        : `rgb(${v + 18 | 0},${v - 10 | 0},${v - 48 | 0})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(cv);
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
    let nx = -dz, nz = dx;
    if (i > 0 && i < n - 1) {
      const a = ptsWorld[i - 1], b = ptsWorld[i + 1];
      let ddx = b.x - a.x, ddz = b.z - a.z;
      const l2 = Math.hypot(ddx, ddz) || 1;
      ddx /= l2; ddz /= l2;
      let ax = -ddz, az = ddx;
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

// —— 远景群山生成器（坐落于北侧地平线与远景天际线，打造广袤壮阔的纵深感）——
function createDistantMountains(theme, halfW, halfH) {
  const group = new THREE.Group();
  const mountainCount = 18;

  // 主题配色方案（山体岩石色 + 顶峰受光色）
  const colors = {
    meadow:    { base: 0x34542c, top: 0x528242, snow: 0x9bc28b },
    lava:      { base: 0x241214, top: 0x481e18, glow: 0xff3b14 },
    frost:     { base: 0x36506a, top: 0x6e9ec4, snow: 0xf0f7ff },
    sand:      { base: 0x7c542f, top: 0xbe884e, sand: 0xe6bf8a },
    graveyard: { base: 0x1a221f, top: 0x2d4038, mist: 0x4d7a6a },
  }[theme.id] || { base: 0x333333, top: 0x666666, snow: 0xaaaaaa };

  for (let i = 0; i < mountainCount; i++) {
    // 均匀分布于北侧远景扇面（-Z 远方：X 范围 -32 ~ +32, Z 范围 -24 ~ -44）
    const frac = (i + 0.5) / mountainCount;
    const x = -34 + frac * 68 + (Math.random() - 0.5) * 4.0;
    const z = -22 - Math.sin(frac * Math.PI) * 16 - Math.random() * 8;

    const h = 10 + Math.random() * 14;
    const w = 11 + Math.random() * 13;
    const segments = 4 + Math.floor(Math.random() * 3);

    const geo = new THREE.ConeGeometry(w, h, segments);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const cBase = new THREE.Color(colors.base);
    const cTop = new THREE.Color(colors.top);
    const cSnow = new THREE.Color(colors.snow || colors.sand || colors.glow || colors.mist);

    for (let j = 0; j < pos.count; j++) {
      const py = pos.getY(j);
      const fracY = THREE.MathUtils.clamp((py + h / 2) / h, 0, 1);
      const c = new THREE.Color();
      if (fracY < 0.52) {
        c.copy(cBase).lerp(cTop, fracY / 0.52);
      } else {
        c.copy(cTop).lerp(cSnow, (fracY - 0.52) / 0.48);
      }
      cols[j * 3] = c.r; cols[j * 3 + 1] = c.g; cols[j * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h * 0.36 - 2.8, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.set(1 + Math.random() * 0.3, 1, 0.7 + Math.random() * 0.5);
    group.add(mesh);
  }

  return group;
}

// —— 外围深渊峡谷与浮岛悬崖断层 ——
function createPerimeterCanyon(theme, halfW, halfH) {
  const group = new THREE.Group();
  const canyonWidth = 32;
  const outerW = (halfW + canyonWidth) * 2;
  const outerH = (halfH + canyonWidth) * 2;

  // 下沉深渊谷底平面
  const bedGeo = new THREE.PlaneGeometry(outerW + 20, outerH + 20, 16, 16);
  const bedMat = new THREE.MeshStandardMaterial({
    color: theme.id === 'lava' ? 0x1a0402
      : theme.id === 'meadow' ? 0x162c3a
      : theme.id === 'frost' ? 0x1c3647
      : theme.id === 'sand' ? 0x583e26
      : 0x08100e,
    emissive: theme.id === 'lava' ? 0xff2800
      : theme.id === 'graveyard' ? 0x14402c
      : 0x000000,
    emissiveIntensity: theme.id === 'lava' ? 1.5 : (theme.id === 'graveyard' ? 0.35 : 0),
    roughness: theme.id === 'meadow' || theme.id === 'frost' ? 0.25 : 0.9,
    metalness: theme.id === 'meadow' || theme.id === 'frost' ? 0.2 : 0.0,
  });
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -3.5;
  group.add(bed);

  // 浮岛侧边岩壁悬崖裙边（Skirting Wall）
  const skirtMat = new THREE.MeshStandardMaterial({
    color: theme.id === 'meadow' ? 0x363028
      : theme.id === 'lava' ? 0x261614
      : theme.id === 'frost' ? 0x324658
      : theme.id === 'sand' ? 0x6e5036
      : 0x1d2220,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  });

  const sw = halfW + 0.8, sh = halfH + 0.8;
  const wallH = 3.5;
  const wallConfigs = [
    { w: sw * 2, h: wallH, pos: [0, -wallH / 2, -sh], rot: [0, 0, 0] },
    { w: sw * 2, h: wallH, pos: [0, -wallH / 2, sh], rot: [0, Math.PI, 0] },
    { w: sh * 2, h: wallH, pos: [-sw, -wallH / 2, 0], rot: [0, Math.PI / 2, 0] },
    { w: sh * 2, h: wallH, pos: [sw, -wallH / 2, 0], rot: [0, -Math.PI / 2, 0] },
  ];
  for (const cfg of wallConfigs) {
    const wallGeo = new THREE.PlaneGeometry(cfg.w, cfg.h, 14, 4);
    const pos = wallGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0) {
        pos.setZ(i, (Math.random() - 0.5) * 0.35);
      }
    }
    wallGeo.computeVertexNormals();
    const wall = new THREE.Mesh(wallGeo, skirtMat);
    wall.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    wall.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
    group.add(wall);
  }

  return group;
}

export async function buildTerrain({ theme, map }) {
  const group = new THREE.Group();
  const halfW = GRID.w / 2, halfH = GRID.h / 2;

  // 1) 路径世界坐标点与段表
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

  // 路径格子标记
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

  // 2) 高清多级落差阶梯地面（台地梯田、山峦高地、深谷路基）
  const groundTex = await loadTexture(theme.groundTex, theme.groundFallback, [20, 16]);
  const GW = (halfW + 0.8) * 2, GH = (halfH + 0.8) * 2;
  const groundGeo = new THREE.PlaneGeometry(GW, GH, 84, 64);

  const noise = (x, z) => {
    let v = 0;
    v += Math.sin(x * 0.32 + Math.sin(z * 0.24) * 2.0) * 0.5;
    v += Math.sin(z * 0.42 - Math.cos(x * 0.18) * 1.6) * 0.3;
    v += Math.sin((x * 1.1 + z * 0.8) * 0.6) * 0.2;
    return v;
  };

  {
    const posA = groundGeo.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const baseColor = new THREE.Color(theme.groundTint);
    const peakColor = new THREE.Color(
      theme.id === 'meadow' ? 0x82ba52
        : theme.id === 'lava' ? 0x723024
        : theme.id === 'frost' ? 0xffffff
        : theme.id === 'sand' ? 0xf2d6a8
        : 0x486e5c,
    );

    for (let i = 0; i < posA.count; i++) {
      const lx = posA.getX(i), ly = posA.getY(i);
      const wx = lx, wz = -ly;
      const dpath = distToPath(wx, wz);

      // 多层阶梯落差体系：
      // - 路径路基区（d < 0.85m）：平滑嵌入 y = 0
      // - 旷野隆起山丘（d >= 0.85m）：柔和起伏高地（y = 0.05m ~ 0.55m）
      let height = 0;
      if (dpath >= 0.85) {
        const hill = Math.max(0, noise(wx * 0.38, wz * 0.38) + 0.2);
        const dFac = THREE.MathUtils.clamp((dpath - 0.85) / 1.8, 0, 1);
        height = dFac * (hill * 0.45 + 0.04);
      }

      posA.setZ(i, height);

      // 顶点高程受光着色（平原基色 → 丘陵顶峰阳光高光）
      const c = new THREE.Color().copy(baseColor);
      if (height > 0.08) {
        const frac = THREE.MathUtils.clamp((height - 0.08) / 0.45, 0, 1);
        c.lerp(peakColor, frac * 0.7);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }

    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }

  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      map: groundTex,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 3) 环绕式近景与远景群山（显著提升天际线纵深感）
  const mountains = createDistantMountains(theme, halfW, halfH);
  group.add(mountains);

  // 4) 外围悬崖深渊水系与断层岩壁
  const perimeterCanyon = createPerimeterCanyon(theme, halfW, halfH);
  group.add(perimeterCanyon);

  // 5) 路径丝带：路肩基底 → 凹凸石质镶边 → 主石板路面（立体嵌入式路面）
  const dirtMat = new THREE.MeshStandardMaterial({ color: theme.pathTint, roughness: 1 });
  dirtMat.color.multiplyScalar(0.7);
  const shoulder = new THREE.Mesh(buildRibbonGeometry(pts, 1.6), dirtMat);
  shoulder.position.y = 0.015; shoulder.receiveShadow = true;

  const pathTex = await loadTexture('./assets/textures/stone.jpg', 'rock', [2.0, 2.0]);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x221c18, roughness: 1 });
  const edge = new THREE.Mesh(buildRibbonGeometry(pts, 1.2), edgeMat);
  edge.position.y = 0.022; edge.receiveShadow = true;

  const road = new THREE.Mesh(
    buildRibbonGeometry(pts, 0.96),
    new THREE.MeshStandardMaterial({ map: pathTex, color: theme.pathTint, roughness: 0.85 }),
  );
  road.position.y = 0.032; road.receiveShadow = true;

  // 5b) 路面碎石与磨损细节
  {
    const pebbleCount = 80;
    const geo = new THREE.DodecahedronGeometry(0.075, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x787064, roughness: 1, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, pebbleCount);
    im.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < pebbleCount; i++) {
      const segIdx = Math.floor(Math.random() * (pts.length - 1));
      const t = Math.random();
      const x = pts[segIdx].x + (pts[segIdx + 1].x - pts[segIdx].x) * t + (Math.random() - 0.5) * 0.65;
      const z = pts[segIdx].z + (pts[segIdx + 1].z - pts[segIdx].z) * t + (Math.random() - 0.5) * 0.65;
      dummy.position.set(x, 0.045, z);
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.scale.setScalar(0.5 + Math.random() * 0.9);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }
  group.add(shoulder, edge, road);

  // 6) 出入口传送门（泛光高亮与能量光环）
  const mkPortal = (p, colorHex) => {
    const gp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.65, 0.1, 10, 36),
      new THREE.MeshStandardMaterial({ color: 0x22252c, emissive: colorHex, emissiveIntensity: 2.1, roughness: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 32),
      new THREE.MeshBasicMaterial({ color: colorHex }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    const light = new THREE.PointLight(colorHex, 7, 5);
    light.position.y = 0.7;
    gp.add(ring, disc, light);
    gp.position.set(p.x, 0, p.z);
    return gp;
  };
  group.add(mkPortal(pts[0], theme.accent));
  group.add(mkPortal(pts[pts.length - 1], 0xff5d5d));

  return { group, pathCells, pts };
}
