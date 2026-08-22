// 敌人图鉴：数值 + 程序化造型
// 敌人图鉴：数值 + 模型（Kenney/three.js CC0 动画模型）+ 程序化回退造型
// model.name 对应 assets/models/enemies/<name>.glb；yaw 为朝向补偿（截图校准）
export const ENEMY_DEFS = {
  grunt:    { key:'grunt',    name:'哥布林', shape:'imp',      hp:52,  speed:1.5,  armor:0, reward:6,  size:0.34, color:0x7aa03a, fly:false,
              model:{ name:'robot', h:1.2, tint:null, yaw:Math.PI } },
  runner:   { key:'runner',   name:'疾行者', shape:'runner',   hp:34,  speed:2.8,  armor:0, reward:5,  size:0.28, color:0xd8c04a, fly:false,
              model:{ name:'horse', h:1.55, tint:null, yaw:Math.PI } },
  tank:     { key:'tank',     name:'重甲兽', shape:'tank',     hp:185, speed:0.95, armor:5, reward:14, size:0.46, color:0x707a8a, fly:false,
              model:{ name:'robot', h:1.9, tint:0x4a5462, yaw:Math.PI } },
  flyer:    { key:'flyer',    name:'蝠翼',   shape:'flyer',    hp:46,  speed:2.15, armor:0, reward:8,  size:0.30, color:0x9a6ad8, fly:true,
              model:{ name:'bird_parrot', h:0.95, tint:null, yaw:Math.PI } },
  healer:   { key:'healer',   name:'萨满',   shape:'healer',   hp:85,  speed:1.3,  armor:2, reward:12, size:0.32, color:0x4ac8b8, fly:false,
              heal:{ radius:2.3, hps:7 },
              model:{ name:'soldier', h:1.3, tint:0x3aa898, yaw:Math.PI } },
  splitter: { key:'splitter', name:'裂变体', shape:'splitter', hp:92,  speed:1.35, armor:1, reward:9,  size:0.38, color:0xc85a88, fly:false,
              splitInto:{ type:'grunt', count:2, hpMul:0.45, rewardMul:0.5 },
              model:{ name:'xbot', h:1.2, tint:0xb04a78, yaw:Math.PI } },
};

export const BOSS_DEFS = {
  meadow: { key:'bossMeadow', name:'丛林巨兽', shape:'boss', hp:1500, speed:0.8, armor:8,  reward:120, size:0.85, color:0x3f7d33, fly:false,
            ability:'frenzy',
            model:{ name:'robot', h:2.9, tint:0x2f6d28, yaw:Math.PI } },
  lava:   { key:'bossLava',   name:'熔火之心', shape:'boss', hp:2600, speed:0.75,armor:12, reward:180, size:0.95, color:0xb03a18, fly:false,
            ability:'deathSpawn', deathSpawn:{ type:'grunt', count:4, hpMul:0.35 },
            model:{ name:'xbot', h:3.4, tint:0x7a1f08, yaw:Math.PI } },
  frost:  { key:'bossFrost',  name:'冰霜君王', shape:'boss', hp:4200, speed:0.7, armor:16, reward:260, size:1.05, color:0x4a7dbd, fly:false,
            ability:'shield', shield:{ hp:420, cd:5 },
            model:{ name:'soldier', h:3.7, tint:0x35619e, yaw:Math.PI } },
};

export const ENEMY_MODEL_NAMES = [
  'robot', 'horse', 'bird_parrot', 'soldier', 'xbot',
];

import * as THREE from 'three';

const geoCache = new Map();
function G(name, make) { if (!geoCache.has(name)) geoCache.set(name, make()); return geoCache.get(name); }
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...o });

export function createEnemyMesh(def) {
  const g = new THREE.Group();
  const skin = mat({ color: def.color });
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  let body;

  switch (def.shape) {
    case 'runner': {
      body = add(new THREE.Mesh(G('rcone', () => new THREE.ConeGeometry(0.42, 0.95, 6)), skin));
      body.rotation.x = Math.PI / 2.35; body.position.y = 0.4;
      break;
    }
    case 'tank': {
      body = add(new THREE.Mesh(G('tankbox', () => new THREE.BoxGeometry(1, 0.6, 0.78)), skin));
      body.position.y = 0.4;
      const plate = add(new THREE.Mesh(G('plate', () => new THREE.BoxGeometry(1.06, 0.18, 0.84)),
        mat({ color: 0x39404c, metalness: 0.35, roughness: 0.5 })));
      plate.position.y = 0.64;
      break;
    }
    case 'flyer': {
      body = add(new THREE.Mesh(G('fsph', () => new THREE.SphereGeometry(0.44, 10, 8)), skin));
      body.position.y = 0.5;
      const wm = mat({ color: 0x5a3590 });
      const wl = add(new THREE.Mesh(G('wing', () => new THREE.BoxGeometry(0.85, 0.04, 0.34)), wm));
      wl.geometry = G('wing', () => new THREE.BoxGeometry(0.85, 0.04, 0.34)); // 共享
      wl.position.set(-0.55, 0.6, 0);
      const wr = new THREE.Mesh(wl.geometry, wm); wr.castShadow = true; wr.position.set(0.55, 0.6, 0); g.add(wr);
      g.userData.wings = [wl, wr];
      break;
    }
    case 'healer': {
      body = add(new THREE.Mesh(G('hcyl', () => new THREE.CylinderGeometry(0.3, 0.42, 0.8, 8)), skin));
      body.position.y = 0.44;
      const totem = add(new THREE.Mesh(G('totem', () => new THREE.BoxGeometry(0.2, 0.2, 0.2)),
        mat({ color: 0x7fffe0, emissive: 0x2fd8b0, emissiveIntensity: 0.9 })));
      totem.position.set(0.52, 0.78, 0);
      g.userData.totem = totem;
      break;
    }
    case 'splitter': {
      body = new THREE.Group();
      [[-0.2, 0.34, 0], [0.2, 0.34, 0], [0, 0.6, -0.04]].forEach((off, i) => {
        const b = add(new THREE.Mesh(G(`ssph${i}`, () => new THREE.SphereGeometry(0.27 - i * 0.05, 9, 7)), skin));
        b.position.set(off[0], off[1], off[2]);
        body.add(b);
      });
      break;
    }
    case 'boss': {
      body = add(new THREE.Mesh(G('bsph', () => new THREE.SphereGeometry(0.6, 12, 9)), skin));
      body.position.y = 0.6;
      const crown = add(new THREE.Mesh(G('crown', () => new THREE.TorusGeometry(0.48, 0.055, 8, 20)),
        mat({ color: 0xffcc55, emissive: 0xffaa00, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.35 })));
      crown.rotation.x = Math.PI / 2; crown.position.y = 1.02;
      break;
    }
    default: { // imp
      body = add(new THREE.Mesh(G('isph', () => new THREE.SphereGeometry(0.46, 10, 8)), skin));
      body.position.y = 0.42;
      [-0.15, 0.15].forEach((x) => {
        const h = add(new THREE.Mesh(G('horn', () => new THREE.ConeGeometry(0.08, 0.24, 5)), mat({ color: 0xe8dcc0 })));
        h.position.set(x, 0.82, 0);
      });
    }
  }

  g.userData.body = body;
  g.userData.skin = skin;
  return g;
}
