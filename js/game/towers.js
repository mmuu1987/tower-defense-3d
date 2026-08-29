// 防御塔图鉴：5 塔 × 3 级 + 程序化塔身 + Kenney 武器模型替换（失败回退程序化）
import * as THREE from 'three';
import { hasModel, makeInstance, makeInstanceWithMaterials, loadOne } from '../engine/modellib.js';

const WEAPON_MODEL = {
  arrow: 'weapon_ballista',
  cannon: 'weapon_cannon',
  sniper: 'weapon_turret',
  tesla: 'tower_crystals',
  frost: 'crystal_large',
};
const WEAPON_ROT = { arrow: 0, cannon: Math.PI / 2, sniper: 0, tesla: 0, frost: 0 }; // 模型朝向修正（截图校准）
const WEAPON_TINT = { arrow: 0x9a7a44, cannon: 0x5a709a, sniper: 0x4a8a62, tesla: 0x9a6ae0, frost: 0x6ad4ff }; // 五塔辨识色

export const TOWER_DEFS = {
  arrow: {
    key: 'arrow', name: '箭塔', hotkey: '1', cost: 70, kind: 'proj', proj: 'arrow', projSpeed: 12,
    dmg: 15, rate: 1.25, range: 3.4, targets: 'both', desc: '射速快的可靠单体输出',
    lvls: [
      null,
      { cost: 60,  dmg: 24, rate: 1.4,  range: 3.7 },
      { cost: 115, dmg: 38, rate: 1.6,  range: 4.1 },
      { cost: 190, dmg: 60, rate: 1.85, range: 4.5 },
      { cost: 310, dmg: 98, rate: 2.2,  range: 5.0 },
    ],
  },
  cannon: {
    key: 'cannon', name: '炮塔', hotkey: '2', cost: 110, kind: 'mortar', projSpeed: 8,
    dmg: 32, rate: 0.55, range: 3.1, splash: 1.7, targets: 'ground', desc: '范围溅射，无法对空',
    lvls: [
      null,
      { cost: 100, dmg: 52, rate: 0.58, range: 3.3, splash: 1.9 },
      { cost: 170, dmg: 85, rate: 0.62, range: 3.5, splash: 2.2 },
      { cost: 280, dmg: 140, rate: 0.68, range: 3.8, splash: 2.6 },
      { cost: 450, dmg: 235, rate: 0.75, range: 4.2, splash: 3.1 },
    ],
  },
  frost: {
    key: 'frost', name: '寒霜塔', hotkey: '3', cost: 90, kind: 'pulse',
    dmg: 10, rate: 0.9, range: 2.9, slow: { pct: 0.48, dur: 2.0 }, targets: 'both', desc: '冰环减速周围敌人',
    lvls: [
      null,
      { cost: 80,  dmg: 18, rate: 0.95, range: 3.1, slow: { pct: 0.55, dur: 2.3 } },
      { cost: 140, dmg: 30, rate: 1.0,  range: 3.4, slow: { pct: 0.62, dur: 2.7 } },
      { cost: 230, dmg: 48, rate: 1.1,  range: 3.7, slow: { pct: 0.70, dur: 3.1 } },
      { cost: 370, dmg: 80, rate: 1.25, range: 4.2, slow: { pct: 0.78, dur: 3.6 } },
    ],
  },
  tesla: {
    key: 'tesla', name: '特斯拉塔', hotkey: '4', cost: 130, kind: 'chain',
    dmg: 19, rate: 0.8, range: 3.2, chains: 3, targets: 'both', desc: '闪电链打击多个敌人',
    lvls: [
      null,
      { cost: 110, dmg: 30, rate: 0.85, range: 3.4, chains: 4 },
      { cost: 190, dmg: 48, rate: 0.9,  range: 3.7, chains: 5 },
      { cost: 300, dmg: 76, rate: 1.0,  range: 4.0, chains: 7 },
      { cost: 480, dmg: 125, rate: 1.15, range: 4.4, chains: 9 },
    ],
  },
  sniper: {
    key: 'sniper', name: '狙击塔', hotkey: '5', cost: 150, kind: 'proj', proj: 'bullet', projSpeed: 34,
    dmg: 72, rate: 0.34, range: 6.6, pierce: true, targets: 'both', desc: '超远射程，无视护甲',
    lvls: [
      null,
      { cost: 130, dmg: 115, rate: 0.38, range: 7.0 },
      { cost: 210, dmg: 180, rate: 0.42, range: 7.5 },
      { cost: 330, dmg: 290, rate: 0.48, range: 8.2 },
      { cost: 520, dmg: 460, rate: 0.55, range: 9.0 },
    ],
  },
};

export const TOWER_KEYS = Object.keys(TOWER_DEFS);

export function statsFor(key, level) {
  const d = TOWER_DEFS[key];
  const s = {
    kind: d.kind, // 攻击方式必须随等级快照携带：fire()/update() 依赖 s.kind 分支
    dmg: d.dmg, rate: d.rate, range: d.range, splash: d.splash,
    slow: d.slow ? { ...d.slow } : null,
    chains: d.chains, pierce: d.pierce,
    projSpeed: d.projSpeed, targets: d.targets,
  };
  if (level > 0 && d.lvls[level]) {
    for (const [k, v] of Object.entries(d.lvls[level])) {
      if (k === 'cost') continue;
      if (k === 'slow' && typeof v === 'object') s.slow = { ...v };
      else s[k] = v;
    }
  }
  return s;
}

const geoCache = new Map();
function G(name, make) { if (!geoCache.has(name)) geoCache.set(name, make()); return geoCache.get(name); }
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, flatShading: true, ...o });
// 共享材质标记：Tower.dispose 释放每实例材质时跳过它们（几何全部来自 geoCache，一律不释放）
const sharedMat = (o) => { const m = mat(o); m.userData.shared = true; return m; };

const BASE_MATS = {
  stone: sharedMat({ color: 0x8a8f98 }),
  dark: sharedMat({ color: 0x3a3f47 }),
  wood: sharedMat({ color: 0x7a5a34 }),
};

function basePlatform() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(G('tbase', () => new THREE.CylinderGeometry(0.44, 0.52, 0.26, 8)), BASE_MATS.stone);
  c.position.y = 0.13; c.castShadow = true; c.receiveShadow = true; g.add(c);
  const top = new THREE.Mesh(G('ttop', () => new THREE.CylinderGeometry(0.34, 0.4, 0.12, 8)), BASE_MATS.dark);
  top.position.y = 0.3; top.castShadow = true; g.add(top);
  return g;
}

export function createTowerMesh(key, level = 0) {
  const root = new THREE.Group();
  root.add(basePlatform());
  const yaw = new THREE.Group();
  yaw.position.y = 0.36;
  root.add(yaw);
  const u = root.userData;
  u.yaw = yaw;

  const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  switch (key) {
    case 'arrow': {
      add(yaw, G('abody', () => new THREE.BoxGeometry(0.5, 0.16, 0.2)), BASE_MATS.wood, 0, 0.16);
      const armGeo = G('aarm', () => new THREE.BoxGeometry(0.1, 0.06, 0.5));
      const a1 = add(yaw, armGeo, BASE_MATS.dark, -0.22, 0.2, 0.1); a1.rotation.x = 0.5;
      const a2 = add(yaw, armGeo, BASE_MATS.dark, 0.22, 0.2, 0.1); a2.rotation.x = 0.5;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.2, 0.32); yaw.add(u.muzzle);
      break;
    }
    case 'cannon': {
      const mount = add(yaw, G('cmount', () => new THREE.CylinderGeometry(0.16, 0.2, 0.2, 8)), BASE_MATS.dark, 0, 0.1);
      const barrel = add(yaw, G('cbarrel', () => new THREE.CylinderGeometry(0.11, 0.13, 0.6, 10)),
        mat({ color: 0x4a4f58, metalness: 0.45, roughness: 0.4 }), 0, 0.26);
      barrel.rotation.x = Math.PI / 2 - 0.18; // 略上仰
      barrel.position.z = 0.18;
      u.barrel = barrel; u.recoil = 0;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.32, 0.48); yaw.add(u.muzzle);
      break;
    }
    case 'frost': {
      const ring = add(yaw, G('fring', () => new THREE.TorusGeometry(0.3, 0.035, 8, 24)),
        mat({ color: 0x9fd8e8, emissive: 0x59c8ff, emissiveIntensity: 0.7 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.1;
      const crystal = add(yaw, G('fcrystal', () => new THREE.OctahedronGeometry(0.26, 0)),
        mat({ color: 0xbfeaff, emissive: 0x59c8ff, emissiveIntensity: 1.3, roughness: 0.2 }), 0, 0.5);
      u.spin = crystal;
      break;
    }
    case 'tesla': {
      add(yaw, G('tpole', () => new THREE.CylinderGeometry(0.05, 0.09, 0.5, 6)), BASE_MATS.dark, 0, 0.25);
      const r1 = add(yaw, G('tring1', () => new THREE.TorusGeometry(0.14, 0.025, 6, 16)),
        mat({ color: 0x8a6ad8, metalness: 0.5, roughness: 0.4 }), 0, 0.34);
      r1.rotation.x = Math.PI / 2;
      const ball = add(yaw, G('tball', () => new THREE.SphereGeometry(0.14, 10, 8)),
        mat({ color: 0xcfe4ff, emissive: 0x66aaff, emissiveIntensity: 1.6, roughness: 0.25 }), 0, 0.58);
      u.pulse = ball;
      break;
    }
    case 'sniper': {
      [-0.14, 0.14].forEach((x, i) => {
        const leg = add(yaw, G(`sleg${i}`, () => new THREE.CylinderGeometry(0.03, 0.035, 0.5, 5)), BASE_MATS.wood, x, 0.22, i === 0 ? 0.08 : -0.06);
        leg.rotation.z = x > 0 ? -0.16 : 0.16;
      });
      const barrel = add(yaw, G('sbarrel', () => new THREE.CylinderGeometry(0.045, 0.055, 0.85, 8)),
        mat({ color: 0x2e333b, metalness: 0.5, roughness: 0.35 }), 0, 0.5);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.2;
      const scope = add(yaw, G('sscope', () => new THREE.BoxGeometry(0.06, 0.06, 0.2)),
        mat({ color: 0x1c2026 }), 0, 0.58, 0.05);
      u.barrel = barrel; u.recoil = 0;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.5, 0.62); yaw.add(u.muzzle);
      break;
    }
  }

  // —— Kenney 武器模型替换程序化炮塔（加载失败自动保留程序化外观）——
  const wmName = WEAPON_MODEL[key];
  if (wmName) {
    const targetH = (key === 'tesla' || key === 'frost') ? 0.5 : 0.7;
    const attach = (inst) => {
      if (!inst || u.disposed) return;
      const keep = new Set(u.muzzle ? [u.muzzle] : []);
      for (const c of [...yaw.children]) if (!keep.has(c)) yaw.remove(c);
      inst.rotation.y = WEAPON_ROT[key] ?? 0;
      inst.position.set(0, key === 'frost' ? 0.4 : 0.1, 0);
      yaw.add(inst);
      if (key === 'frost') u.spin = inst;
      if (key === 'tesla' || key === 'cannon' || key === 'sniper') { u.pulse = null; u.barrel = null; }
    };
    const buildInst = () => {
      // 克隆材质并向主题色偏移，五塔一眼可辨
      const inst = makeInstanceWithMaterials(wmName, targetH);
      if (inst) {
        const tint = new THREE.Color(WEAPON_TINT[key] ?? 0xffffff);
        inst.traverse((m) => {
          if (m.isMesh && m.material && !Array.isArray(m.material) && m.color) {
            m.color.lerp(tint, 0.68);
          }
        });
      }
      return inst;
    };
    if (hasModel(wmName)) {
      attach(buildInst());
    } else {
      loadOne(wmName).then(() => {
        if (hasModel(wmName)) attach(buildInst());
      });
    }
  }

  // 等级刻度（金色小方块）
  u.pips = new THREE.Group();
  u.pips.position.y = 0.02;
  root.add(u.pips);
  const pipGeo = G('pip', () => new THREE.BoxGeometry(0.07, 0.05, 0.07));
  const pipMat = mat({ color: 0xffcc55, emissive: 0xaa7700, emissiveIntensity: 0.5 });
  for (let i = 0; i <= level; i++) {
    const p = new THREE.Mesh(pipGeo, pipMat);
    p.position.set((i - level / 2) * 0.14, 0, 0.5);
    u.pips.add(p);
  }
  return root;
}
