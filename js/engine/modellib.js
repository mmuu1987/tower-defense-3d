// 模型库：Kenney glTF 加载 + 归一化（居中/贴地/按高度缩放）+ 失败回退
// 所有模型来自 Kenney Nature Kit & Tower Defense Kit（CC0）、three.js 官方示例模型（CC0/署名）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
// 模型基准路径：相对本模块解析，任何部署深度都正确（本地/GitHub子路径/itch.io iframe）
const MODEL_BASE = new URL('../../assets/models/', import.meta.url);
const cache = {};    // name -> { tpl: Group(已归一化), height: number } | null = 加载失败
const inflight = {};

export function loadOne(name, timeoutMs = 20000) {
  // Node/模拟器环境：无 location（页面上下文），直接返回失败占位，走程序化回退
  if (typeof location === 'undefined') return Promise.resolve(null);
  if (cache[name] !== undefined) return Promise.resolve(cache[name]);
  if (!inflight[name]) {
    inflight[name] = new Promise((resolve) => {
      let settled = false;
      const report = (why, err) => {
        const msg = `[model] ${name} ${why}${err ? ': ' + ((err && (err.message || err)) || err) : ''}`;
        console.error(msg);
        try { fetch('/api/log', { method: 'POST', body: msg.slice(0, 500) }).catch(() => {}); } catch {}
      };
      const finish = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cache[name] = val;
        resolve(val);
      };
      const timer = setTimeout(() => { report('TIMEOUT'); finish(null); }, timeoutMs);

      (async () => {
        try {
          const res = await fetch(new URL(`${name}.glb`, MODEL_BASE));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          loader.parse(buf, '', (g) => {
            try {
              const root = g.scene;
              const box = new THREE.Box3().setFromObject(root);
              const size = box.getSize(new THREE.Vector3());
              const center = box.getCenter(new THREE.Vector3());
              root.position.set(-center.x, -box.min.y, -center.z);
              const wrap = new THREE.Group();
              wrap.add(root);
              finish({ tpl: wrap, height: Math.max(0.0001, size.y), name });
            } catch (e) {
              report('PARSE-THROW', e);
              finish(null);
            }
          }, (e) => {
            report('PARSE-CALLBACK-ERROR', e);
            finish(null);
          });
        } catch (e) {
          report('FETCH-FAIL', e);
          finish(null);
        }
      })();
    });
  }
  return inflight[name];
}

// 预热一批模型；resolve 为加载成功的名字数组
export function preloadModels(names) {
  const t0 = performance.now();
  // 注意：不能直接 names.map(loadOne) —— map 会把索引当第二参数（timeoutMs）传进去！
  return Promise.all(names.map((n) => loadOne(n))).then((rs) => {
    const okCount = rs.filter(Boolean).length;
    const msg = `[model] preload done: ${okCount}/${names.length} ok in ${(performance.now() - t0).toFixed(0)}ms`;
    console.log(msg);
    try { fetch('/api/log', { method: 'POST', body: msg }).catch(() => {}); } catch {}
    return names.filter((_, i) => rs[i]);
  });
}

// 是否已成功加载（用于同步决定走模型还是程序化回退）
export const hasModel = (name) => !!cache[name];

/**
 * 生成实例（克隆共享几何/材质，性能友好）
 * @param {string} name
 * @param {number} [targetH] 目标高度（世界单位）
 * @param {number} [mul] 额外缩放系数
 * @returns {Object3D|null}
 */
export function makeInstance(name, targetH, mul = 1) {
  const e = cache[name];
  if (!e) return null;
  const o = e.tpl.clone(true);
  const s = (targetH ? targetH / e.height : 1) * mul;
  o.scale.setScalar(s);
  o.traverse((m) => {
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; }
  });
  return o;
}

/** 生成实例并克隆材质（用于需要独立 emissive 动画的个体，如冰晶） */
export function makeInstanceWithMaterials(name, targetH, mul = 1) {
  const o = makeInstance(name, targetH, mul);
  if (!o) return null;
  o.traverse((m) => {
    if (m.isMesh && m.material) {
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    }
  });
  return o;
}

// ———— 敌人模型（骨骼动画）：模板缓存 animations，SkeletonUtils 克隆保骨架 ————
// 各 glb 的场景单位制差异巨大（0.004~300），自动测量不可靠（SkinnedMesh 包围盒受
// 蒙皮姿势影响）。因此用一次性人工标定的原始高度做归一化，新模型按需补充。
const ENEMY_RAW_HEIGHT = {
  robot: 7,          // RobotExpressive（实测 scale=1 渲染高约 7；Box3 的 148 是错误口径）
  horse: 303,        // 疾行者
  bird_parrot: 168,  // 蝠翼
  soldier: 1.75,     // 萨满 / frostBoss（Mixamo 系：骨骼空间≈米制）
  xbot: 1.78,        // 裂变体 / lavaBoss
  // —— 扩充包（Rome 鸟类 bbox 被离群顶点撑大，必须人工标定；见 tools/birdiag.mjs）——
  fox: 79,           // 灵狐（运行时蒙皮实测 79.03，Walk 剪辑）
  cesiumman: 1.64,   // 干尸行者（加载期实测 1.64；行走蹲姿 1.51）
  brainstem: 1.83,   // 机械舞者（舞蹈姿势运行时实测 1.83；绑定姿势 2.18）
  bird_flamingo: 82, // 烈焰鸟（分位数鸟身 81.7；bbox 416 是离群顶点口径）
  bird_stork: 70,    // 苍鹳（按翼展比例标定：raw=70 时翼展≈3.6 身长≈3.0；26.5 会变巨鸟）
};

// Y 轴居中修正：Rome 鸟类 bbox 含离群顶点 → 默认居中把鸟身推离原点。
// 数值 = 默认居中后"鸟身底部"相对原点的偏移（模板空间），负值下移贴回原点。
const ENEMY_DY_FIX = {
  bird_flamingo: -66.9,
  bird_stork: -286.1,
};
const enemyCache = {};    // name -> { tpl(归一化), height, animations } | null
const enemyInflight = {};

export function preloadEnemyModels(names) { return Promise.all(names.map((n) => loadEnemyTemplate(n))).then(() => {}); }

export function loadEnemyTemplate(name, timeoutMs = 20000) {
  if (typeof location === 'undefined') return Promise.resolve(null);
  if (enemyCache[name] !== undefined) return Promise.resolve(enemyCache[name]);
  if (!enemyInflight[name]) {
    enemyInflight[name] = new Promise((resolve) => {
      let settled = false;
      const report = (why, err) => {
        const msg = `[enemy-model] ${name} ${why}${err ? ': ' + ((err && (err.message || err)) || err) : ''}`;
        console.error(msg);
        try { fetch('/api/log', { method: 'POST', body: msg.slice(0, 400) }).catch(() => {}); } catch {}
      };
      const finish = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        enemyCache[name] = val;
        resolve(val);
      };
      const timer = setTimeout(() => { report('TIMEOUT'); finish(null); }, timeoutMs);
      (async () => {
        try {
          // modellib 位于 js/engine/ → ../../assets/models/enemies/
          const url = new URL(`../../assets/models/enemies/${name}.glb`, import.meta.url);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          loader.parse(buf, '', (g) => {
            const root = g.scene;
            // 关键：剥掉动画中的位移轨道（root motion）——否则马/机器人会"跑出"
            // 自己的逻辑位置，造成塔打空气、模型"消失"的假象。只保留旋转/缩放。
            let stripped = 0;
            for (const clip of g.animations || []) {
              const before = clip.tracks.length;
              clip.tracks = clip.tracks.filter((tr) => !/\.position$/.test(tr.name));
              stripped += before - clip.tracks.length;
              if (before !== clip.tracks.length) clip.resetDuration();
            }
            if (stripped) console.log(`[enemy] ${name}: stripped ${stripped} position tracks`);
            // 高度测量：对 SkinnedMesh 用 getVertexPosition 抽样蒙皮顶点（含骨骼变换），
            // 这是唯一与最终渲染一致的口径；Box3/骨骼局部包围盒都会因单位制差异而失真。
            root.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(root); // 兜底（非蒙皮部分）
            let measured = false;
            const v = new THREE.Vector3();
            root.traverse((o) => {
              if (!o.isSkinnedMesh || !o.geometry) return;
              o.skeleton.update?.();
              const pos = o.geometry.attributes.position;
              if (!pos) return;
              const step = Math.max(1, Math.floor(pos.count / 300));
              for (let i = 0; i < pos.count; i += step) {
                o.getVertexPosition(i, v); // r160: 已应用 bindMatrix+骨骼+modelWorld → 世界坐标
                box.expandByPoint(v);
                measured = true;
              }
            });
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            root.position.set(-center.x, -box.min.y, -center.z);
            const dyFix = ENEMY_DY_FIX[name];
            if (dyFix) root.position.y += dyFix;
            // 高度：人工标定表绝对优先（蒙皮运行时测量依赖渲染期骨骼矩阵，
            // 加载时机下 boneMatrices 未初始化会得到随机垃圾值——血的教训）
            const raw = ENEMY_RAW_HEIGHT[name];
            const height = raw
              ? raw
              : (measured && size.y > 0.0001 ? size.y : Math.max(0.0001, size.y));
            finish({ tpl: root, height, animations: g.animations || [] });
          }, (e) => { report('PARSE-ERROR', e); finish(null); });
        } catch (e) {
          report('FETCH-FAIL', e);
          finish(null);
        }
      })();
    });
  }
  return enemyInflight[name];
}

/**
 * 生成带动画的敌人实例（骨骼克隆 + 每实例材质克隆供受击闪白/减速染色）
 * @returns {{group:Object3D, mixer:AnimationMixer|null, actions:{walk?:AnimationAction, death?:AnimationAction}, mats:Material[]}|null}
 */
export function makeEnemyInstance(name, targetH, tint = null) {
  const e = enemyCache[name];
  if (!e) return null;
  const group = SkeletonUtils.clone(e.tpl);
  group.scale.setScalar(targetH / e.height);
  const mixer = new THREE.AnimationMixer(group);
  const actions = {};
  const findClip = (...patterns) => {
    for (const p of patterns) {
      const c = THREE.AnimationClip.findByName(e.animations, p);
      if (c) return c;
    }
    // 正则兜底
    for (const p of patterns) {
      const re = new RegExp(p, 'i');
      const c = e.animations.find((a) => re.test(a.name));
      if (c) return c;
    }
    return null;
  };
  const walkC = findClip('Walking', 'Walk', 'Running', 'Run', 'gallop', 'flap', 'fly');
  // 兜底：动画剪辑名不匹配任何关键词时（如空名/自定义名），直接取第一个剪辑当行走
  const useWalk = walkC || (e.animations.length ? e.animations[0] : null);
  if (useWalk) actions.walk = mixer.clipAction(useWalk);
  const deathC = findClip('Death', 'Dying');
  if (deathC) actions.death = mixer.clipAction(deathC);

  const mats = [];
  group.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false; // 骨骼动画包围盒计算易误剔除
      if (m.material) {
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
          if (tint != null && mm.color) mm.color.lerp(new THREE.Color(tint), 0.55);
          mats.push(mm);
        });
      }
    }
  });

  if (actions.walk) actions.walk.play();
  else if (actions.death) { /* 无行走动画的模型死亡时再播 */ }

  return { group, mixer, actions, mats };
}
/** 预热状态查询（同步判断是否可用） */
export const hasEnemyModel = (name) => !!enemyCache[name];
