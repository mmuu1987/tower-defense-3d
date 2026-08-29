// 程序化装饰 + Kenney CC0 模型集成：聚类微生态、遗迹营地与模型回退几何
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
      if (dToPath && dToPath(x, z) < CLEARANCE) continue;
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

  const kinds = theme.decor || [];
  const counts = {
    tree: 12, rock: 6, flower: 24,
    deadTree: 8, rockDark: 10, emberRock: 8, lavaPool: 6,
    pine: 10, crystal: 8, snowRock: 6,
    bush: 6, tuft: 18, mushroom: 4,
    ruin: 3, campfire: 3, iceStatue: 3,
    cactus: 10,
    tombstone: 8, crypt: 4, deadPine: 6, lantern: 4, spookyFence: 5, altar: 2, ghostStatue: 3,
  };

  const modelQueue = [];
  const tryModel = (names, x, z, hBase, hVar, extraMul = 1, pulse = false) => {
    for (const nm of names) {
      if (hasModel(nm)) {
        modelQueue.push({ name: nm, x, z, h: hBase * (0.85 + rng() * hVar), ry: rng() * 6.283, mul: extraMul, pulse });
        return true;
      }
    }
    return false;
  };

  const spawnCompanion = (cx, cz, distMin, distMax) => {
    const angle = rng() * Math.PI * 2;
    const r = distMin + rng() * (distMax - distMin);
    const nx = cx + Math.cos(angle) * r;
    const nz = cz + Math.sin(angle) * r;
    if (dToPath && dToPath(nx, nz) < CLEARANCE) return null;
    return { x: nx, z: nz };
  };

  for (const kind of kinds) {
    const n = counts[kind] || 6;
    for (let i = 0; i < n; i++) {
      const spot = findSpot();
      if (!spot) break;
      const { x, z } = spot;
      switch (kind) {
        case 'tree': {
          tryModel(['tree_oak', 'tree_default', 'tree_pine_tall'], x, z, 1.6, 0.5);
          const c1 = spawnCompanion(x, z, 0.45, 0.85);
          if (c1) tryModel(['bush_detailed', 'bush_large'], c1.x, c1.z, 0.45, 0.3);
          const c2 = spawnCompanion(x, z, 0.5, 0.95);
          if (c2) tryModel(['stump_old', 'log', 'mushroom_red'], c2.x, c2.z, 0.35, 0.3);
          const c3 = spawnCompanion(x, z, 0.4, 0.8);
          if (c3) tryModel(['flower_yellow', 'flower_red', 'grass_leafs'], c3.x, c3.z, 0.25, 0.2);
          break;
        }
        case 'pine': {
          tryModel(['snow_tree', 'tree_pine_tall'], x, z, 1.5, 0.5);
          const c1 = spawnCompanion(x, z, 0.45, 0.8);
          if (c1) tryModel(['snow_rocks', 'stone_small'], c1.x, c1.z, 0.4, 0.3);
          const c2 = spawnCompanion(x, z, 0.5, 0.85);
          if (c2) tryModel(['crystal_large'], c2.x, c2.z, 0.38, 0.3, 1, true);
          break;
        }
        case 'rock':
        case 'rockDark':
        case 'snowRock': {
          const mainRock = kind === 'snowRock' ? 'snow_rocks' : (kind === 'rockDark' ? 'stone_big' : 'stone_big');
          tryModel([mainRock], x, z, 0.45, 0.3);
          const c1 = spawnCompanion(x, z, 0.35, 0.7);
          if (c1) tryModel(['stone_small', 'stone_big2'], c1.x, c1.z, 0.2, 0.2);
          const c2 = spawnCompanion(x, z, 0.4, 0.75);
          if (c2) tryModel(['grass_leafs'], c2.x, c2.z, 0.25, 0.2);
          break;
        }
        case 'tombstone': {
          tryModel(['grave_cross', 'grave_decorative', 'grave_round'], x, z, 0.6, 0.3);
          const c1 = spawnCompanion(x, z, 0.4, 0.75);
          if (c1) tryModel(['grave_round', 'grave_cross'], c1.x, c1.z, 0.45, 0.25);
          const c2 = spawnCompanion(x, z, 0.5, 0.9);
          if (c2) tryModel(['pine_crooked', 'fence_iron'], c2.x, c2.z, 0.7, 0.4);
          break;
        }
        case 'crypt': {
          tryModel(['crypt_stone', 'crypt_small', 'coffin_old'], x, z, 0.95, 0.3);
          const c1 = spawnCompanion(x, z, 0.6, 1.0);
          if (c1) tryModel(['fence_iron', 'lantern_post'], c1.x, c1.z, 0.6, 0.2, 1, true);
          break;
        }
        case 'ruin': {
          tryModel(['ruin_obelisk', 'ruin_ring', 'ruin_column'], x, z, 1.1, 0.4);
          const c1 = spawnCompanion(x, z, 0.5, 0.9);
          if (c1) tryModel(['ruin_column', 'barrel'], c1.x, c1.z, 0.55, 0.3);
          break;
        }
        case 'cactus': {
          tryModel(['cactus_tall'], x, z, 0.95, 0.4);
          const c1 = spawnCompanion(x, z, 0.4, 0.75);
          if (c1) tryModel(['cactus_short'], c1.x, c1.z, 0.5, 0.3);
          const c2 = spawnCompanion(x, z, 0.45, 0.8);
          if (c2) tryModel(['stone_small', 'log'], c2.x, c2.z, 0.3, 0.2);
          break;
        }
        case 'campfire': {
          if (hasModel('campfire_stones')) {
            modelQueue.push({ name: 'campfire_stones', x, z, h: 0.35 + rng() * 0.08, ry: rng() * 6.283, mul: 1 });
            modelQueue.push({ name: 'campfire_logs', x, z, h: 0.45 + rng() * 0.1, ry: rng() * 6.283, mul: 1 });
          }
          const c1 = spawnCompanion(x, z, 0.5, 0.8);
          if (c1) tryModel(['barrel'], c1.x, c1.z, 0.4, 0.2);
          break;
        }
        case 'crystal': {
          tryModel(['crystal_large'], x, z, 0.65, 0.4, 1, true);
          break;
        }
        case 'deadPine': {
          tryModel(['pine_crooked'], x, z, 1.25, 0.4);
          break;
        }
        case 'lantern': {
          tryModel(['lantern_post'], x, z, 0.85, 0.2, 1, true);
          break;
        }
        case 'altar': {
          tryModel(['altar_stone'], x, z, 0.55, 0.2);
          break;
        }
        case 'ghostStatue': {
          tryModel(['ghost_statue', 'skeleton_statue'], x, z, 0.7, 0.3);
          break;
        }
        case 'emberRock': {
          const s = 0.45 + rng() * 0.5;
          put('emberBase', x, s * 0.2, z, rng() * 6.28, s, s * 0.6, s);
          put('emberGlow', x, s * 0.34, z, rng() * 6.28, s * 0.4, s * 0.18, s * 0.4);
          break;
        }
        case 'lavaPool': {
          const r = 0.35 + rng() * 0.35;
          add('lavaPool', null, null, { x, y: 0.021, z, ry: 0, sx: r, sy: 1, sz: r });
          break;
        }
        case 'flower': {
          if (tryModel([pickOne(rng, ['flower_red', 'flower_yellow', 'flower_purple'])], x, z, 0.26, 0.35)) break;
          put('stem', x, 0.16, z, 0, 1, 1, 1);
          put('bloom', x, 0.34, z, rng() * 6.28, 1, 1, 1);
          break;
        }
        case 'deadTree': {
          if (tryModel(['stump_old', 'log'], x, z, 0.7, 0.5)) break;
          const h = 1.1 + rng() * 0.8;
          put('deadTrunk', x, h * 0.5, z, rng() * 6.28, 1.4, h, 1.4);
          put('branch', x, h * 0.85, z, rng() * 6.28, 1.3, 1.1, 1.3);
          break;
        }
        case 'bush': {
          tryModel(['bush_detailed'], x, z, 0.5, 0.45);
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
        case 'iceStatue': {
          if (hasModel('ruin_ring')) {
            modelQueue.push({
              name: pickOne(rng, ['ruin_ring', 'ruin_column']),
              x, z, h: 0.8 + rng() * 0.5, ry: rng() * 6.283, mul: 1, icyTint: true,
            });
          }
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

  const branchTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.5));

  for (const [name, def] of Object.entries(parts)) {
    if (!def.list.length || !geoms[name] || !mats[name]) continue;
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
      const pMats = [];
      inst.traverse((m) => {
        if (m.isMesh && m.material) {
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
            if (mm.emissive) { mm.emissive.setHex(0x59c8ff); pMats.push(mm); }
          });
        }
      });
      for (const mm of pMats) {
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

