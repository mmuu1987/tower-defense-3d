// 程序化装饰 + Kenney CC0 模型集成：模型可用则用模型，否则回退程序化几何
import * as THREE from 'three';
import { GRID } from '../game/config.js';
import { isPathCell } from './terrain.js';
import { preloadModels, hasModel, makeInstance, makeInstanceWithMaterials } from './modellib.js';

// 需要预热的模型清单（含塔武器与墓园/城堡扩展模型）
const PRELOAD = [
  'tree_oak', 'tree_default', 'tree_pine_tall',
  'rock_large_b', 'stone_big', 'stone_big2', 'stone_small', 'snow_rocks', 'snow_tree',
  'flower_red', 'flower_yellow', 'flower_purple',
  'bush_detailed', 'grass_leafs', 'mushroom_red',
  'stump_old', 'log', 'crystal_large',
  'weapon_ballista', 'weapon_cannon', 'weapon_turret', 'tower_crystals',
  'ruin_obelisk', 'ruin_column', 'ruin_ring', 'campfire_stones', 'campfire_logs',
  'cactus_short', 'cactus_tall',
  'grave_cross', 'grave_round', 'grave_decorative', 'crypt_small', 'crypt_stone',
  'coffin_old', 'lantern_post', 'pine_crooked', 'altar_stone', 'fence_iron',
  'ghost_statue', 'skeleton_statue', 'barrel', 'castle_wall',
];
export function initDecorModels() { return preloadModels(PRELOAD); }

function pickOne(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();

export function scatterDecor({ theme, pathCells, seed = 12345, pathPts = null }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const animated = []; // {mat, base, speed, phase}

  // 收集器：partName -> {geom, mat, list:[{x,y,z,ry,sx,sy,sz}]}
  const parts = {};
  const add = (name, geom, mat, t) => {
    (parts[name] ||= { geom, mat, list: [] }).list.push(t);
  };
  const put = (name, x, y, z, ry, sx, sy, sz) => add(name, null, null, { x, y, z, ry, sx, sy, sz });

  const halfW = GRID.w / 2 - 0.4, halfH = GRID.h / 2 - 0.4;
  const placed = [];
  // 路径距离场：装饰中心到路径中心线的最近距离（与 terrain 的路面丝带同源数学）
  // 路肩半宽 0.775 + 模型冠幅/底座摆幅余量 ⇒ 任何摆设都不压路
  const CLEARANCE = 1.12;
  const dToPath = pathPts && pathPts.length > 1 ? (() => {
    const segs = [];
    for (let i = 0; i < pathPts.length - 1; i++) {
      const a = pathPts[i], b = pathPts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      segs.push({ ax: a.x, az: a.z, dx: dx / len, dz: dz / len, len });
    }
    return (wx, wz) => {
      let best = Infinity;
      for (const s of segs) {
        const t = Math.max(0, Math.min(s.len, (wx - s.ax) * s.dx + (wz - s.az) * s.dz));
        const dd = Math.hypot(wx - (s.ax + s.dx * t), wz - (s.az + s.dz * t));
        if (dd < best) best = dd;
      }
      return best;
    };
  })() : null;
  const findSpot = () => {
    for (let tries = 0; tries < 40; tries++) {
      const x = (rng() * 2 - 1) * halfW;
      const z = (rng() * 2 - 1) * halfH;
      if (isPathCell(pathCells, x, z)) continue;
      if (dToPath && dToPath(x, z) < CLEARANCE) continue; // 严格净距：不进路肩、不压路面
      let ok = true;
      for (const p of placed) {
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < 1.35) { ok = false; break; }
      }
      if (!ok) continue;
      placed.push({ x, z });
      return { x, z };
    }
    return null;
  };

  const kinds = theme.decor;
  const counts = {
    tree: 24, rock: 8, flower: 40,
    deadTree: 14, rockDark: 14, emberRock: 10, lavaPool: 7,
    pine: 22, crystal: 12, snowRock: 8,
    bush: 9, tuft: 32, mushroom: 5,
    ruin: 4, campfire: 3, iceStatue: 4,
    cactus: 18,
    tombstone: 18, crypt: 5, deadPine: 10, lantern: 4, spookyFence: 8, altar: 3, ghostStatue: 4,
  };
  // 模型实例队列：{name,x,z,h,ry,mul,mats?}
  const modelQueue = [];
  const tryModel = (names, x, z, hBase, hVar, extraMul = 1) => {
    for (const nm of names) {
      if (hasModel(nm)) {
        modelQueue.push({ name: nm, x, z, h: hBase * (0.8 + rng() * hVar), ry: rng() * 6.283, mul: extraMul });
        return true;
      }
    }
    return false;
  };

  for (const kind of kinds) {
    const n = counts[kind] || 8;
    for (let i = 0; i < n; i++) {
      const spot = findSpot();
      if (!spot) break;
      const { x, z } = spot;
      switch (kind) {
        case 'tree': {
          if (tryModel(['tree_oak', 'tree_default', 'tree_pine_tall'], x, z, 1.5, 0.6)) break;
          const h = 0.85 + rng() * 0.5;
          put('trunk', x, h * 0.42, z, rng() * 6.28, 1, h / 0.9, 1);
          put('leaf', x, h * 0.95, z, rng() * 6.28, 0.9 + rng() * 0.3, 0.95 + rng() * 0.3, 0.9 + rng() * 0.3);
          put('leafTop', x, h * 1.55, z, rng() * 6.28, 0.62, 0.7, 0.62);
          break;
        }
        case 'pine': {
          if (tryModel(['snow_tree'], x, z, 1.4, 0.6)) break;
          const h = 1.05 + rng() * 0.65;
          put('trunk', x, h * 0.3, z, rng() * 6.28, 0.85, 0.7, 0.85);
          put('pineLeaf', x, h * 0.92, z, rng() * 6.28, 0.78 + rng() * 0.25, h / 1.25, 0.78 + rng() * 0.25);
          break;
        }
        case 'rock':
        case 'rockDark':
        case 'snowRock': {
          // 熔岩世界：纯石克隆材质压暗（避免草皮顶穿帮火山主题）
          if (kind === 'rockDark' && hasModel('stone_big')) {
            const inst = makeInstanceWithMaterials('stone_big', 0.34 + rng() * 0.25);
            if (inst) {
              inst.position.set(x, 0, z);
              inst.rotation.y = rng() * 6.283;
              inst.traverse((m) => {
                if (m.isMesh && m.material && !Array.isArray(m.material) && m.color) m.color.multiplyScalar(0.32);
              });
              group.add(inst);
              break;
            }
          }
          // 随机选石种+随机尺寸，避免清一色巨石
          const mpick = kind === 'rock'
            ? pickOne(rng, [['stone_big', 0.26], ['stone_big2', 0.24], ['stone_small', 0.15], ['stone_small', 0.12]])
            : kind === 'snowRock' ? ['snow_rocks', 0.55] : ['stone_big', 0.26];
          const mh = typeof mpick[1] === 'number' ? mpick[1] : 0.55;
          if (hasModel(mpick[0])) {
            modelQueue.push({ name: mpick[0], x, z, h: mh * (0.75 + rng() * 0.5), ry: rng() * 6.283, mul: 1 });
            break;
          }
          const s = 0.5 + rng() * 0.75;
          put(kind === 'rock' ? 'rock' : kind === 'rockDark' ? 'rockDark' : 'snowRock',
            x, s * 0.22, z, rng() * 6.28, s, s * (0.55 + rng() * 0.3), s);
          break;
        }
        case 'flower': {
          if (tryModel([pickOne(rng, ['flower_red', 'flower_yellow', 'flower_purple'])], x, z, 0.26, 0.35)) break;
          put('stem', x, 0.16, z, 0, 1, 1, 1);
          put('bloom', x, 0.34, z, rng() * 6.28, 1, 1, 1);
          break;
        }
        case 'crystal': {
          if (hasModel('crystal_large')) {
            modelQueue.push({ name: 'crystal_large', x, z, h: 0.55 + rng() * 0.45, ry: rng() * 6.283, mul: 1, pulse: true });
            break;
          }
          const s = 0.55 + rng() * 0.7;
          put('crystal', x, s * 0.5, z, rng() * 6.28, s * 0.55, s * (1.3 + rng() * 0.7), s * 0.55);
          break;
        }
        case 'deadTree': {
          if (tryModel(['stump_old', 'log'], x, z, 0.7, 0.5)) break;
          const h = 1.1 + rng() * 0.8;
          put('deadTrunk', x, h * 0.5, z, rng() * 6.28, 1.4, h, 1.4);
          put('branch', x, h * 0.85, z, rng() * 6.28, 1.3, 1.1, 1.3);
          put('branch', x, h * 0.62, z, rng() * 6.28 + 2.4, 1.0, 0.9, 1.0);
          break;
        }
        case 'bush': {
          tryModel(['bush_detailed'], x, z, 0.5, 0.45); // 无程序化回退，模型缺失则跳过
          break;
        }
        case 'tuft': {
          tryModel(['grass_leafs'], x, z, 0.3, 0.4);
          break;
        }
        case 'mushroom': {
          tryModel(['mushroom_red'], x, z, 0.3, 0.35);
          break;
        }
        case 'ruin': {
          // 草原远古遗迹：方尖碑/石柱/石环
          tryModel([pickOne(rng, ['ruin_obelisk', 'ruin_column', 'ruin_column', 'ruin_ring'])], x, z, 0.95, 0.45);
          break;
        }
        case 'cactus': {
          // 黄沙戈壁：仙人掌（Kenney CC0），缺失则跳过
          tryModel([pickOne(rng, ['cactus_tall', 'cactus_short', 'cactus_short'])], x, z, 0.9, 0.55);
          break;
        }
        case 'tombstone': {
          // 幽暗墓园：墓碑
          tryModel([pickOne(rng, ['grave_cross', 'grave_round', 'grave_decorative'])], x, z, 0.55, 0.35);
          break;
        }
        case 'crypt': {
          // 幽暗墓园：石棺/地穴
          tryModel([pickOne(rng, ['crypt_small', 'crypt_stone', 'coffin_old'])], x, z, 0.9, 0.35);
          break;
        }
        case 'deadPine': {
          // 幽暗墓园：枯木
          tryModel(['pine_crooked'], x, z, 1.2, 0.5);
          break;
        }
        case 'lantern': {
          // 幽暗墓园：路灯
          if (hasModel('lantern_post')) {
            modelQueue.push({ name: 'lantern_post', x, z, h: 0.85 + rng() * 0.2, ry: rng() * 6.283, mul: 1, pulse: true });
          }
          break;
        }
        case 'spookyFence': {
          // 幽暗墓园：铁栅栏
          tryModel(['fence_iron'], x, z, 0.45, 0.2);
          break;
        }
        case 'altar': {
          // 幽暗墓园：石质祭坛
          tryModel(['altar_stone'], x, z, 0.5, 0.2);
          break;
        }
        case 'ghostStatue': {
          // 幽暗墓园：幽灵雕塑
          tryModel(['ghost_statue'], x, z, 0.65, 0.3);
          break;
        }
        case 'campfire': {
          // 熔岩篝火：石圈 + 木柴堆叠
          if (hasModel('campfire_stones')) {
            modelQueue.push({ name: 'campfire_stones', x, z, h: 0.32 + rng() * 0.08, ry: rng() * 6.283, mul: 1 });
            modelQueue.push({ name: 'campfire_logs', x, z, h: 0.42 + rng() * 0.1, ry: rng() * 6.283, mul: 1 });
          }
          break;
        }
        case 'iceStatue': {
          // 霜原冰封遗迹
          if (hasModel('ruin_ring')) {
            modelQueue.push({
              name: pickOne(rng, ['ruin_ring', 'ruin_column']),
              x, z, h: 0.8 + rng() * 0.5, ry: rng() * 6.283, mul: 1, icyTint: true,
            });
          }
          break;
        }
        case 'emberRock': {
          const s = 0.4 + rng() * 0.5;
          put('emberBase', x, s * 0.2, z, rng() * 6.28, s, s * 0.6, s);
          put('emberGlow', x, s * 0.34, z, rng() * 6.28, s * 0.4, s * 0.18, s * 0.4);
          break;
        }
        case 'lavaPool': {
          const r = 0.3 + rng() * 0.32;
          add('lavaPool', null, null, { x, y: 0.021, z, ry: 0, sx: r, sy: 1, sz: r });
          break;
        }
      }
    }
  }

  // 材质表
  const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true, ...opts });
  const mats = {
    trunk: std({ color: 0x6b4a2e }),
    leaf: std({ color: 0x4d8a37 }),
    leafTop: std({ color: 0x5da03f }),
    pineLeaf: std({ color: 0x3f7048 }),
    rock: std({ color: 0x8b8f96 }),
    rockDark: std({ color: 0x3c3838 }),
    snowRock: std({ color: 0xcfdde8 }),
    stem: std({ color: 0x4a7a30 }),
    bloom: std({ color: 0xffd166, emissive: 0xffb84d, emissiveIntensity: 0.28 }),
    crystal: std({ color: 0x9fe4ff, emissive: 0x59c8ff, emissiveIntensity: 1.15, roughness: 0.25 }),
    deadTrunk: std({ color: 0x2e2622 }),
    branch: std({ color: 0x33291f }),
    emberBase: std({ color: 0x241d19 }),
    emberGlow: std({ color: 0x331005, emissive: 0xff5a1f, emissiveIntensity: 2.0 }),
    lavaPool: new THREE.MeshStandardMaterial({
      color: 0x1a0b06, emissive: 0xff5a1f, emissiveIntensity: 1.5, roughness: 0.6,
    }),
  };

  // 几何表
  const geoms = {
    trunk: new THREE.CylinderGeometry(0.09, 0.14, 0.9, 6),
    leaf: new THREE.ConeGeometry(0.52, 1.15, 7),
    leafTop: new THREE.ConeGeometry(0.36, 0.85, 7),
    pineLeaf: new THREE.ConeGeometry(0.55, 1.7, 8),
    rock: new THREE.IcosahedronGeometry(0.42, 0),
    rockDark: new THREE.IcosahedronGeometry(0.42, 0),
    snowRock: new THREE.IcosahedronGeometry(0.42, 0),
    stem: new THREE.CylinderGeometry(0.018, 0.022, 0.34, 4),
    bloom: new THREE.SphereGeometry(0.075, 8, 6),
    crystal: new THREE.OctahedronGeometry(0.5, 0),
    deadTrunk: new THREE.CylinderGeometry(0.05, 0.11, 1, 5),
    branch: new THREE.CylinderGeometry(0.02, 0.04, 0.55, 4),
    emberBase: new THREE.IcosahedronGeometry(0.42, 0),
    emberGlow: new THREE.IcosahedronGeometry(0.42, 0),
    lavaPool: new THREE.CircleGeometry(1, 22),
  };

  // 分支的偏转姿态
  const branchTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.5));

  for (const [name, def] of Object.entries(parts)) {
    if (!def.list.length) continue;
    const im = new THREE.InstancedMesh(geoms[name], mats[name], def.list.length);
    im.castShadow = name !== 'lavaPool' && name !== 'bloom' && name !== 'emberGlow';
    im.receiveShadow = false;
    def.list.forEach((t, i) => {
      E.set(0, t.ry, 0);
      Q.setFromEuler(E);
      V.set(t.x, t.y, t.z);
      S.set(t.sx, t.sy, t.sz);
      if (name === 'branch') {
        Q.multiply(branchTilt);
        S.set(t.sx, t.sy * 0.55, t.sz);
      }
      if (name === 'lavaPool') {
        E.set(-Math.PI / 2, 0, 0);
        Q.setFromEuler(E);
      }
      M.compose(V, Q, S);
      im.setMatrixAt(i, M);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);

    if (name === 'lavaPool') animated.push({ mat: mats.lavaPool, base: 1.5, speed: 2.1, phase: rng() * 6.28 });
    if (name === 'crystal') animated.push({ mat: mats.crystal, base: 1.15, speed: 1.6, phase: rng() * 6.28 });
    if (name === 'emberGlow') animated.push({ mat: mats.emberGlow, base: 2.4, speed: 3.2, phase: rng() * 6.28 });
  }

  // （路缘石已移除：path_stone 原本摆在 0.62~0.8 偏移处，正好压在路肩上，
  //   用户反馈"路上别有其他东西"——路面只保留 terrain 自带的碎石纹理）

  // —— 实例化模型队列（Kenney glTF；加载失败的项目已被 tryModel 过滤）——
  for (const q of modelQueue) {
    const inst = q.pulse
      ? makeInstanceWithMaterials(q.name, q.h, q.mul)
      : makeInstance(q.name, q.h, q.mul);
    if (!inst) continue;
    inst.position.set(q.x, 0, q.z);
    inst.rotation.y = q.ry;
    group.add(inst);
    if (q.icyTint) {
      inst.traverse((m) => {
        if (m.isMesh && m.material && !Array.isArray(m.material) && m.color) m.color.lerp(new THREE.Color(0x9fd4ff), 0.45);
      });
    }
    if (q.pulse) {
      const mats = [];
      inst.traverse((m) => {
        if (m.isMesh && m.material) {
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
            if (mm.emissive) { mm.emissive.setHex(0x59c8ff); mats.push(mm); }
          });
        }
      });
      for (const mm of mats) {
        animated.push({ mat: mm, base: 1.1, speed: 1.7, phase: rng() * 6.28 });
      }
    }
  }

  return {
    group,
    update(time) {
      for (const a of animated) {
        a.mat.emissiveIntensity = a.base + Math.sin(time * a.speed + a.phase) * a.base * 0.22;
      }
    },
  };
}
