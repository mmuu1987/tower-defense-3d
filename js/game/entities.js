// 战斗实体：路径采样 / 敌人 / 防御塔 / 弹道 / 轻量特效层
import * as THREE from 'three';
import { createEnemyMesh } from './units.js';
import { createTowerMesh, statsFor, TOWER_DEFS } from './towers.js';
import { hasEnemyModel, makeEnemyInstance } from '../engine/modellib.js';

let _id = 0;
const _tan = new THREE.Vector3();

// ———— 路径采样：把 waypoints 变成按里程取点 ————
export function makePathSampler(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ ax: a.x, az: a.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len, start: total });
    total += len;
  }
  return {
    total,
    at(dist, out = new THREE.Vector3()) {
      const d = THREE.MathUtils.clamp(dist, 0, total);
      let s = segs[0];
      for (const seg of segs) { if (d >= seg.start && d <= seg.start + seg.len) { s = seg; break; } }
      const t = d - s.start;
      out.set(s.ax + s.dx * t, 0, s.az + s.dz * t);
      return out;
    },
    tangentAt(dist, out = new THREE.Vector3()) {
      const d = THREE.MathUtils.clamp(dist, 0, total);
      for (const seg of segs) { if (d >= seg.start && d <= seg.start + seg.len) { return out.set(seg.dx, 0, seg.dz); } }
      const last = segs[segs.length - 1];
      return out.set(last.dx, 0, last.dz);
    },
  };
}

const HPBAR_MATS = {
  bg: new THREE.MeshBasicMaterial({ color: 0x10141c, transparent: true, opacity: 0.6, depthTest: false }),
  ok: new THREE.MeshBasicMaterial({ color: 0x59d97a, depthTest: false }),
  mid: new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false }),
  bad: new THREE.MeshBasicMaterial({ color: 0xff5d5d, depthTest: false }),
};

// ———— 敌人 ————
export class Enemy {
  constructor(def, { sampler, hpMul = 1, rewardMul = 1, speedMul = 1 }) {
    this.id = ++_id;
    this.def = def;
    this.sampler = sampler;
    this.maxHp = Math.round(def.hp * hpMul);
    this.hp = this.maxHp;
    this.reward = Math.max(1, Math.round(def.reward * rewardMul));
    this.baseSpeed = def.speed * speedMul;
    this.dist = def.fly ? sampler.total * 0 : 0;
    this.alive = true;
    this.dying = false;      // 死亡动画播放中（不可索敌/不再移动）
    this.deathT = 0;
    this.disposed = false;
    this.flash = 0;
    this.flashMats = [];
    this.mixer = null;
    this.actions = {};
    this.yawOff = 0;
    this.slowPct = 0; this.slowT = 0;
    this.healCd = 1;
    this.age = 0;
    // Boss 技能状态
    this.shieldMax = def.shield ? Math.round(def.shield.hp * hpMul) : 0;
    this.shield = this.shieldMax;
    this.shieldT = def.shield ? def.shield.cd : 0;

    this.pos = new THREE.Vector3();
    let procedural = true;
    if (def.model && hasEnemyModel(def.model.name)) {
      const inst = makeEnemyInstance(def.model.name, def.model.h, def.model.tint ?? null);
      if (inst) {
        procedural = false;
        this.mesh = inst.group;
        this.mixer = inst.mixer;
        this.actions = inst.actions;
        this.flashMats = inst.mats;
        this.yawOff = def.model.yaw ?? 0;
      }
    }
    if (procedural) {
      this.mesh = createEnemyMesh(def);
      this.flashMats = [this.mesh.userData.skin].filter(Boolean);
    }
    this.baseY = def.fly ? 1.55 + Math.random() * 0.25 : 0;
    this.mesh.position.y = this.baseY;
    this.phase = Math.random() * 6.28;

    // 血条（billboard，左锚缩放）
    const barY = (def.model ? def.model.h * 0.85 : def.size * 2 + 0.35);
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.1), HPBAR_MATS.bg);
    const fillGeo = new THREE.PlaneGeometry(0.76, 0.07);
    fillGeo.translate(0.38, 0, 0);
    this.fillMat = HPBAR_MATS.ok;
    const fill = new THREE.Mesh(fillGeo, this.fillMat);
    fill.position.set(-0.38, 0, 0.001);
    this.bar.add(bg, fill);
    this.bar.position.y = barY;
    this.bar.renderOrder = 20;
    this.fill = fill;
    this.mesh.add(this.bar);
  }

  get canDispose() { return !this.alive && !this.dying; }

  /** 死亡序列：播死亡动画或沉没，期间不参与索敌/移动/波次判定 */
  startDeath() {
    if (!this.alive || this.dying) return;
    this.alive = false;
    this.dying = true;
    this.deathT = this.actions?.death ? 1.2 : 0.55;
    if (this.mixer) {
      this.actions?.walk?.stop();
      if (this.actions?.death) {
        const d = this.actions.death;
        d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.play();
      }
    }
  }

  /** 死亡动画/沉没推进（由 battle 在敌人更新后调用） */
  updateDeath(dt) {
    if (!this.dying) return;
    this.deathT -= dt;
    this.mixer?.update(dt);
    // 无死亡动画的模型：后半段沉没+缩小
    if (!this.actions?.death && this.deathT < 0.3) {
      this.mesh.position.y -= dt * 1.6;
      const s = Math.max(0.01, this.deathT / 0.3);
      this.mesh.scale.multiplyScalar(Math.max(0.5, s));
    } else if (this.actions?.death && this.deathT < 0.25) {
      this.mesh.position.y -= dt * 0.9; // 动画结束后缓缓入土
    }
    if (this.deathT <= 0 && !this.disposed) this.disposed = true; // 由 battle 清理
  }

  get progress() { return this.dist; }

  applySlow(pct, dur) {
    if (pct >= this.slowPct - 0.01 || this.slowT <= 0) { this.slowPct = pct; }
    this.slowT = Math.max(this.slowT, dur);
  }

  hurt(raw, { pierce = false } = {}) {
    if (!this.alive) return 0;
    let dmg = Math.max(1, raw - (pierce ? 0 : (this.def.armor || 0)));
    // 护盾优先吸收
    if (this.shield > 0 && dmg > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      this.flash = Math.max(this.flash, 0.6);
      if (dmg <= 0) return absorbed;
    }
    this.hp -= dmg;
    this.flash = 1;
    return dmg + (this.shieldMax ? 0 : 0);
  }

  update(dt, ctx) {
    this.age += dt;
    // 减速计时
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowPct = 0;
    }
    // Boss：狂暴（越走越快）
    const frenzyMul = this.def.ability === 'frenzy' ? 1 + Math.min(0.85, this.age * 0.045) : 1;
    // Boss：护盾再生
    if (this.shieldMax > 0 && this.shield <= 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) {
        this.shield = this.shieldMax;
        ctx.fx.ring(this.pos, 1.2, 0x9fd8ff, 0.4);
      }
    }
    // 萨满群体治疗
    if (this.def.heal) {
      this.healCd -= dt;
      if (this.healCd <= 0) {
        this.healCd = 1;
        for (const e of ctx.enemies) {
          if (e !== this && e.alive && e.hp < e.maxHp &&
              e.pos.distanceToSquared(this.pos) < this.def.heal.radius ** 2) {
            e.hp = Math.min(e.maxHp, e.hp + this.def.heal.hps);
          }
        }
        ctx.fx.ring(this.pos, this.def.heal.radius, 0x4ac8b8, 0.45);
      }
    }

    const sp = this.baseSpeed * frenzyMul * (1 - this.slowPct);
    this.dist += sp * dt;
    this.sampler.at(this.dist, this.pos);

    const t = ctx.time + this.phase;
    const bob = this.def.fly ? Math.sin(t * 3) * 0.12 : Math.abs(Math.sin(t * 7)) * 0.06 * (sp / 2);
    this.mesh.position.set(this.pos.x, this.baseY + bob, this.pos.z);
    this.sampler.tangentAt(this.dist, _tan);
    this.mesh.rotation.y = Math.atan2(-_tan.x, -_tan.z) + this.yawOff;

    // 动画模型：驱动 mixer，行走速度与实际移速联动
    if (this.mixer) {
      const wa = this.actions?.walk;
      if (wa && this.baseSpeed > 0) {
        wa.setEffectiveTimeScale(THREE.MathUtils.clamp(sp / (this.baseSpeed || 1), 0.6, 1.8));
      }
      this.mixer.update(dt);
    }

    const u = this.mesh.userData;
    if (u.wings) u.wings.forEach((w, i) => { w.rotation.x = Math.sin(t * 18) * 0.5 * (i ? -1 : 1); });
    if (u.totem) u.totem.rotation.y = t * 3;

    // 受击闪白/减速染蓝/护盾微光（兼容程序化单材质与 GLTF 多材质）
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 6);
    const shieldGlow = this.shield > 0 ? 0.22 : 0;
    const rF = this.flash * 1.0 + shieldGlow * 0.4;
    const gF = this.flash * 1.0 + shieldGlow * 0.8;
    const bF = this.flash * 0.9 + (this.slowPct > 0 ? 0.25 : 0) + shieldGlow;
    const intensity = this.flash * 1.8 + (this.slowPct > 0 ? 0.35 : 0) + shieldGlow * 1.4;
    for (const mm of this.flashMats) {
      if (!mm.emissive) continue;
      mm.emissive.setRGB(
        Math.min(1.2, this.flash * 0.9 + shieldGlow * 0.4),
        Math.min(1.2, this.flash * 0.9 + shieldGlow * 0.8),
        Math.min(1.2, this.flash * 0.85 + (this.slowPct > 0 ? 0.3 : 0) + shieldGlow),
      );
      mm.emissiveIntensity = intensity;
    }
    // 受击缩放弹跳（模型路径整体缩放；程序化路径缩放 body）
    const pop = 1 + this.flash * 0.08;
    if (this.mixer) {
      this._modelBaseScale ||= this.mesh.scale.x;
      this.mesh.scale.setScalar(this._modelBaseScale * pop);
    } else {
      const body = this.mesh.userData.body;
      if (body) body.scale.setScalar(pop);
    }

    // 血条
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.fill.scale.x = Math.max(0.0001, ratio);
    this.fill.material = ratio > 0.55 ? HPBAR_MATS.ok : ratio > 0.25 ? HPBAR_MATS.mid : HPBAR_MATS.bad;
    this.bar.quaternion.copy(ctx.camera.quaternion);
    this.bar.visible = ratio < 0.999;
  }

  dispose(scene) {
    this.disposed = true;
    this.mixer?.stopAllAction();
    try { this.mixer?.uncacheRoot(this.mesh); } catch {}
    scene.remove(this.mesh);
    // 只释放每实例私有的资源；共享几何/材质保留
    this.bar.children.forEach((c) => c.geometry.dispose());
    this.mesh.userData.skin?.dispose();
    // GLTF 路径：每实例克隆的材质必须释放（几百只累积会显存泄漏 → 帧率高但卡顿）
    for (const m of this.flashMats) {
      try { m.dispose(); } catch {}
    }
    this.flashMats = [];
  }
}

// ———— 防御塔 ————
export class Tower {
  constructor(key, cx, cz) {
    this.id = ++_id;
    this.key = key;
    this.def = TOWER_DEFS[key];
    this.cx = cx; this.cz = cz;
    this.level = 0;
    this.invested = this.def.cost;
    this.stats = statsFor(key, 0);
    this.cooldown = 0;
    this.target = null;
    this.retarget = 0;
    this.aim = 0;
    this._aimDiff = 0; // 当前瞄准误差（wrap 到 [-π,π]，供开火对齐判定复用）

    this.pos = new THREE.Vector3(0, 0, 0);
    this.mesh = createTowerMesh(key, 0);
  }
  placeAt(pos) { this.pos.copy(pos); this.mesh.position.copy(pos); }

  canUpgrade() { return this.level < 2; }
  upgradeCost() { return this.canUpgrade() ? this.def.lvls[this.level + 1].cost : 0; }
  upgrade() {
    if (!this.canUpgrade()) return false;
    this.level++;
    this.invested += this.upgradeCost();
    this.stats = statsFor(this.key, this.level);
    // 加一格等级指示
    const pip = this.mesh.userData.pips.children[0];
    if (pip) {
      const n = this.level + 1;
      this.mesh.userData.pips.clear();
      for (let i = 0; i < n; i++) {
        const c = pip.clone();
        c.position.set((i - (n - 1) / 2) * 0.14, 0, 0.5);
        this.mesh.userData.pips.add(c);
      }
    }
    return true;
  }
  sellValue() { return Math.round(this.invested * 0.7); }

  acquire(enemies) {
    let best = null, bestD = -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.def.fly && this.stats.targets === 'ground') continue;
      if (e.pos.distanceToSquared(this.pos) > this.stats.range ** 2) continue;
      if (e.dist > bestD) { bestD = e.dist; best = e; }
    }
    return best;
  }

  fire(target, ctx) {
    const s = this.stats;
    const muzzle = this.mesh.userData.muzzle
      ? this.mesh.userData.muzzle.getWorldPosition(new THREE.Vector3())
      : this.pos.clone().setY(0.6);

    if (s.kind === 'pulse') {
      ctx.fx.ring(this.pos, s.range, 0x59c8ff, 0.35);
      ctx.fx.frostPuff?.(this.pos, s.range);
      for (const e of ctx.enemies) {
        if (!e.alive) continue;
        if (e.pos.distanceToSquared(this.pos) <= s.range ** 2) {
          e.applySlow(s.slow.pct, s.slow.dur);
          ctx.hitEnemy(e, s.dmg);
        }
      }
      return;
    }

    if (s.kind === 'chain') {
      const chain = [target];
      const seen = new Set(chain.map((e) => e.id));
      let from = target;
      while (chain.length < s.chains) {
        let next = null, nd = 2.4 ** 2;
        for (const e of ctx.enemies) {
          if (!e.alive || seen.has(e.id)) continue;
          const dd = e.pos.distanceToSquared(from.pos);
          if (dd < nd) { nd = dd; next = e; }
        }
        if (!next) break;
        chain.push(next); seen.add(next.id); from = next;
      }
      const pts = [muzzle.clone()];
      chain.forEach((e, i) => {
        ctx.hitEnemy(e, Math.round(s.dmg * Math.pow(0.72, i)), { pierce: true });
        pts.push(e.pos.clone().setY(0.5));
      });
      ctx.fx.lightning(pts);
      ctx.fx.flash(muzzle, 0x66aaff, 5, 0.09);
      return;
    }

    if (s.kind === 'mortar') {
      const flight = Math.max(0.35, target.pos.distanceTo(muzzle) / s.projSpeed);
      const lead = target.pos.clone();
      // 简易预判：目标沿切线前进 flight 秒
      lead.addScaledVector(ctx.tangentOf(target), target.baseSpeed * (1 - target.slowPct) * flight * 0.85);
      ctx.projectiles.spawnMortar(muzzle, lead, s.dmg, s.splash, flight);
      this.mesh.userData.recoil = 1;
      ctx.fx.flash(muzzle, 0xffa050, 6, 0.08);
      return;
    }

    // 直射弹
    ctx.projectiles.spawnHoming(muzzle, target, s.dmg, s.projSpeed, { pierce: !!s.pierce, kind: this.def.proj });
    if (this.mesh.userData.recoil !== undefined) this.mesh.userData.recoil = 1;
    ctx.fx.flash(muzzle, this.def.proj === 'bullet' ? 0xfff2b0 : 0xd8e8ff, 3, 0.06);
  }

  update(dt, ctx) {
    const u = this.mesh.userData;
    if (u.spin) u.spin.rotation.y += dt * 2.2;
    if (u.pulse) u.pulse.material.emissiveIntensity = 1.3 + Math.sin(ctx.time * 6 + this.id) * 0.5;
    if (u.recoil > 0) {
      u.recoil = Math.max(0, u.recoil - dt * 6);
      if (u.barrel) u.barrel.position.z = 0.18 - u.recoil * 0.1;
    }

    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target?.alive) {
      this.target = this.acquire(ctx.enemies);
      this.retarget = 0.15;
    }

    if (u.yaw && this.target) {
      const want = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      let diff = want - this.aim;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.aim += diff * Math.min(1, dt * 10);
      u.yaw.rotation.y = this.aim;
      this._aimDiff = diff; // 与追踪同一套 wrap 的当前误差（修复开火判定）
      // aim 会随持续追踪累积多圈；过大时归一化（mod 2π 渲染方向不变）
      if (Math.abs(this.aim) > 64) this.aim %= Math.PI * 2;
    }

    this.cooldown -= dt;
    if (this.target && this.cooldown <= 0) {
      // 旧写法 ((want-aim+3π)%2π)-π 在 aim 累计满圈后遇 JS 负余数会把 0 误差算成 ±2π，
      // 导致塔永远"未对齐"不开火（有寻敌动作但不射击）。现复用追踪的 wrap 误差。
      const aligned = !u.yaw || Math.abs(this._aimDiff ?? 0) < 0.5;
      if (aligned || this.stats.kind === 'pulse') {
        this.fire(this.target, ctx);
        this.fireCount = (this.fireCount || 0) + 1; // 诊断计数：定位"塔停射"问题
        this.cooldown = 1 / this.stats.rate;
      }
    }
  }

  dispose(scene) {
    this.mesh.userData.disposed = true; // 阻止异步模型替换
    scene.remove(this.mesh);
  }
}

// ———— 弹道 ————
const _projGeo = {};    // 几何/材质缓存（弹幕频繁创建，必须复用避免 GPU 泄漏）
const _projMat = {};
function projAsset(kind, makeGeo, makeMat) {
  if (!_projGeo[kind]) _projGeo[kind] = makeGeo();
  if (!_projMat[kind]) _projMat[kind] = makeMat();
  return { geo: _projGeo[kind], mat: _projMat[kind] };
}

export class Projectiles {
  constructor(scene) { this.scene = scene; this.list = []; }
  _mesh(kind) {
    let a;
    if (kind === 'arrow') a = projAsset('arrow', () => new THREE.BoxGeometry(0.05, 0.05, 0.42), () => new THREE.MeshStandardMaterial({ color: 0xe8dcc0 }));
    else if (kind === 'bullet') a = projAsset('bullet', () => new THREE.SphereGeometry(0.07, 6, 5), () => new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    else a = projAsset('ball', () => new THREE.SphereGeometry(0.13, 8, 6), () => new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.4 }));
    return new THREE.Mesh(a.geo, a.mat);
  }

  spawnHoming(from, target, dmg, speed, opts) {
    const mesh = this._mesh(opts.kind || 'arrow');
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.list.push({
      mode: 'homing', mesh, target, dmg,
      speed: Number.isFinite(speed) && speed > 0 ? speed : 12, // 防御：非法速度回退，避免 NaN 弹体
      pierce: opts.pierce, last: target.pos.clone(), alive: true,
    });
  }

  spawnMortar(from, impact, dmg, splash, flight) {
    const mesh = this._mesh('ball');
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.list.push({
      mode: 'arc', mesh, p0: from.clone(), p1: impact.clone(),
      h: 1.3 + from.distanceTo(impact) * 0.12, t: 0, T: flight, dmg, splash, alive: true,
    });
  }

  update(dt, ctx) {
    for (const p of this.list) {
      if (!p.alive) continue;
      // 防御性回收：坐标非有限（NaN 污染）或超龄的弹丸立即移除，
      // 避免"永久卡死弹体"无限累积 → 列表膨胀 + 粒子池被 NaN 洗成不可见
      p.age = (p.age || 0) + dt;
      const pp = p.mesh.position;
      if (p.age > 8 || !Number.isFinite(pp.x + pp.y + pp.z)) { p.alive = false; continue; }
      if (p.mode === 'homing') {
        if (p.target?.alive) p.last.copy(p.target.pos).y += 0.45;
        const pos = p.mesh.position;
        const dir = p.last.clone().sub(pos);
        const dist = dir.length();
        // 拖尾火花（限频）
        p._trail = (p._trail || 0) + dt;
        if (p._trail > 0.028) {
          p._trail = 0;
          ctx.fx.spark(pos, p.kind === 'bullet' ? 0xfff2b0 : 0xd8e8ff);
        }
        if (dist < 0.28 || (p.target?.alive && p.target.pos.distanceTo(pos) < 0.32)) {
          p.alive = false;
          if (p.target?.alive) ctx.hitEnemy(p.target, p.dmg, { pierce: p.pierce });
          ctx.fx.burst(p.last, 0xfff0c0, 8);
          continue;
        }
        dir.normalize().multiplyScalar(Math.min(dist, p.speed * dt));
        pos.add(dir);
        if (p.mode === 'homing') p.mesh.lookAt(p.last);
      } else { // arc
        p.t += dt / p.T;
        // 炮弹飞行火花拖尾
        p._trail = (p._trail || 0) + dt;
        if (p._trail > 0.03) {
          p._trail = 0;
          ctx.fx.spark(p.mesh.position, 0xffa050);
        }
        if (p.t >= 1) {
          p.alive = false;
          ctx.explode(p.p1, p.dmg, p.splash);
          ctx.fx.burst(p.p1, 0xffa050, 16);
          continue;
        }
        const x = p.p0.x + (p.p1.x - p.p0.x) * p.t;
        const z = p.p0.z + (p.p1.z - p.p0.z) * p.t;
        const y = p.p0.y + (0.15 - p.p0.y) * p.t + 4 * p.h * p.t * (1 - p.t);
        p.mesh.position.set(x, y, z);
      }
    }
    this.list = this.list.filter((p) => {
      if (p.alive) return true;
      this.scene.remove(p.mesh);
      return false;
    });
  }
}

// ———— 特效层：GPU粒子池 / 冲击环 / 闪电 / 枪口点光 ————
const PARTICLE_MAX = 1600;
const _viewportH = () => (typeof innerHeight !== 'undefined' ? innerHeight : 720);

let _discPromise = null;
function getDiscTexture() {
  if (_discPromise) return _discPromise;
  // Node/无头模拟环境没有 DOM —— 提供占位纹理即可（模拟器不渲染）
  if (typeof document === 'undefined') {
    _discPromise = Promise.resolve(new THREE.Texture());
    return _discPromise;
  }
  const fallback = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  };
  const discUrl = new URL('../../assets/textures/particle-disc.png', import.meta.url).href;
  _discPromise = new Promise((res) => {
    new THREE.TextureLoader().load(discUrl, (t) => res(t), undefined, () => res(fallback()));
  });
  return _discPromise;
}

export class FxLayer {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5);
      scene.add(l);
      this.lights.push({ l, life: 0 });
    }

    // —— 粒子池（死亡粒子颜色为黑 → 加法混合下不可见，免压缩）——
    this.pCursor = 0;
    this.pPos = new Float32Array(PARTICLE_MAX * 3);
    this.pVel = new Float32Array(PARTICLE_MAX * 3);
    this.pCol = new Float32Array(PARTICLE_MAX * 3);   // 基色（发射时写入）
    this.pLife = new Float32Array(PARTICLE_MAX);      // 剩余寿命
    this.pMaxL = new Float32Array(PARTICLE_MAX);
    this.pGrav = new Float32Array(PARTICLE_MAX);
    const geo = new THREE.BufferGeometry();
    const lifeAttr = new Float32Array(PARTICLE_MAX);  // 0..1 归一化寿命
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(lifeAttr, 1));
    this.pGeo = geo;
    this._lifeAttr = lifeAttr;
    this.pMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: null },
        uProj: { value: _viewportH() / (2 * Math.tan((50 * Math.PI) / 360)) },
        uSizeW: { value: 0.14 },
      },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aLife;
        varying vec3 vC; varying float vA;
        uniform float uProj; uniform float uSizeW;
        void main(){
          vC = aColor; vA = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uSizeW * uProj / max(0.1, -mv.z), 1.0, 40.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vC; varying float vA;
        void main(){
          vec4 tex = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vC * vA * 1.6, 1.0) * tex.a;
        }`,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    getDiscTexture().then((t) => { t.colorSpace = THREE.SRGBColorSpace; this.pMat.uniforms.uMap.value = t; });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.pMat.uniforms.uProj.value = _viewportH() / (2 * Math.tan((50 * Math.PI) / 360));
      });
    }
  }

  flash(pos, color, intensity, life) {
    const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    slot.l.position.copy(pos);
    slot.l.color.set(color);
    slot.l.intensity = intensity;
    slot.life = life;
  }

  burst(pos, colorHex, count = 10, opts = {}) {
    const speed = opts.speed ?? 3.4;
    const up = opts.up ?? 2.6;
    const grav = opts.grav ?? 8;
    const r = ((colorHex >> 16) & 255) / 255, g = ((colorHex >> 8) & 255) / 255, b = (colorHex & 255) / 255;
    for (let n = 0; n < count; n++) {
      const i = this.pCursor++ % PARTICLE_MAX;
      const i3 = i * 3;
      this.pPos[i3] = pos.x + (Math.random() - 0.5) * 0.15;
      this.pPos[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.15;
      this.pPos[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.15;
      this.pVel[i3] = (Math.random() - 0.5) * speed;
      this.pVel[i3 + 1] = Math.random() * up;
      this.pVel[i3 + 2] = (Math.random() - 0.5) * speed;
      const k = 0.9 + Math.random() * 0.9; // 提亮喂泛光
      this.pCol[i3] = Math.min(1.6, r * k);
      this.pCol[i3 + 1] = Math.min(1.6, g * k);
      this.pCol[i3 + 2] = Math.min(1.6, b * k);
      this.pMaxL[i] = this.pLife[i] = 0.28 + Math.random() * 0.34;
      this.pGrav[i] = grav;
    }
    this.pGeo.attributes.aColor.needsUpdate = true;
  }

  ring(pos, radius, color, life = 0.4) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.05, 8, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    r.rotation.x = Math.PI / 2;
    r.position.copy(pos).y = 0.12;
    this.scene.add(r);
    this.items.push({ mesh: r, life, max: life, kind: 'ring', targetR: radius });
  }

  lightning(pts) {
    const verts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        verts.push(a.x + (b.x - a.x) * t0 + (Math.random() - .5) * .18,
          a.y + (b.y - a.y) * t0 + (Math.random() - .5) * .18,
          a.z + (b.z - a.z) * t0 + (Math.random() - .5) * .18,
          a.x + (b.x - a.x) * t1 + (Math.random() - .5) * .18,
          a.y + (b.y - a.y) * t1 + (Math.random() - .5) * .18,
          a.z + (b.z - a.z) * t1 + (Math.random() - .5) * .18);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xbfe0ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(line);
    this.items.push({ mesh: line, life: 0.14, max: 0.14, kind: 'fade' });
  }

  /** 爆炸焦痕贴花（循环复用 20 块） */
  decal(pos, size) {
    if (typeof document === 'undefined') return; // Node/无头模拟环境：跳过 DOM 贴花
    if (!this._decalInit) {
      this._decalInit = true;
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(48, 48, 4, 48, 48, 46);
      gr.addColorStop(0, 'rgba(12,8,6,0.92)');
      gr.addColorStop(0.55, 'rgba(20,14,10,0.55)');
      gr.addColorStop(1, 'rgba(24,18,12,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 96, 96);
      this._decalTex = new THREE.CanvasTexture(cv);
      this._decals = [];
      for (let i = 0; i < 20; i++) {
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(1, 22),
          new THREE.MeshBasicMaterial({ map: this._decalTex, transparent: true, opacity: 0, depthWrite: false }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.042;
        m.visible = false;
        this.scene.add(m);
        this._decals.push({ mesh: m, t: -1, dur: 7 });
      }
      this._decalCursor = 0;
    }
    const d = this._decals[this._decalCursor++ % this._decals.length];
    d.mesh.position.set(pos.x, 0.042, pos.z);
    d.mesh.scale.setScalar(size * (0.85 + Math.random() * 0.3));
    d.mesh.rotation.z = Math.random() * 6.283;
    d.mesh.material.opacity = 0.78;
    d.mesh.visible = true;
    d.t = 0;
  }

  /** 冲击波球（爆炸瞬间快速膨胀的加法球） */
  shockwave(pos, radius) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.items.push({ mesh: m, life: 0.2, max: 0.2, kind: 'shock', targetR: radius });
  }

  /** 死亡/击杀光柱：细长发光柱渐隐 */
  beam(pos, color, h = 3.2) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.02, h, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.set(pos.x, h / 2, pos.z);
    this.scene.add(m);
    this.items.push({ mesh: m, life: 0.45, max: 0.45, kind: 'fade' });
  }

  /** 单粒火花（弹道拖尾用） */
  spark(pos, colorHex) {
    this.burst(pos, colorHex, 1, { speed: 0.15, up: 0.05, grav: 0, life: 0.3 });
  }

  /** 冰霜寒雾：向上飘散的蓝色冷雾粒（负重力） */
  frostPuff(pos, radius) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.283;
      const r = Math.random() * radius;
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r * 0.5, 0.1, pos.z + Math.sin(a) * r * 0.5);
      const i3 = (this.pCursor++ % PARTICLE_MAX) * 3;
      // 直接借用 burst 的发射器：自定义一次
      const colorHex = 0x9fdcff;
      const rr = ((colorHex >> 16) & 255) / 255, gg = ((colorHex >> 8) & 255) / 255, bb = (colorHex & 255) / 255;
      this.pPos[i3] = p.x; this.pPos[i3 + 1] = p.y; this.pPos[i3 + 2] = p.z;
      this.pVel[i3] = (Math.random() - 0.5) * 0.6;
      this.pVel[i3 + 1] = 1.2 + Math.random() * 0.8;
      this.pVel[i3 + 2] = (Math.random() - 0.5) * 0.6;
      const k = 0.9 + Math.random() * 0.5;
      this.pCol[i3] = rr * k; this.pCol[i3 + 1] = gg * k; this.pCol[i3 + 2] = bb * k;
      this.pMaxL[i] = this.pLife[i] = 0.6 + Math.random() * 0.4;
      this.pGrav[i] = -0.6; // 负重力 → 上飘
    }
    this.pGeo.attributes.aColor.needsUpdate = true;
  }

  update(dt) {
    // 焦痕贴花渐隐
    if (this._decalInit) {
      for (const d of this._decals) {
        if (!d.mesh.visible) continue;
        d.t += dt;
        const k = Math.max(0, 1 - d.t / d.dur);
        d.mesh.material.opacity = 0.78 * k;
        if (k <= 0) d.mesh.visible = false;
      }
    }
    for (const slot of this.lights) {
      if (slot.life > 0) {
        slot.life -= dt;
        slot.l.intensity *= Math.max(0, 1 - dt * 14);
        if (slot.life <= 0) slot.l.intensity = 0;
      }
    }
    // 粒子积分
    let any = false;
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      const i3 = i * 3;
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.03) { this.pPos[i3 + 1] = 0.03; this.pVel[i3 + 1] *= -0.4; }
      this.pLife[i] -= dt;
      this._lifeAttr[i] = Math.max(0, this.pLife[i] / this.pMaxL[i]);
    }
    if (any || this._wasAny) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.aLife.needsUpdate = true;
    }
    this._wasAny = any;

    for (const it of this.items) {
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      if (it.kind === 'ring') {
        const r = 0.35 + (1 - k) * it.targetR;
        it.mesh.scale.setScalar(r / 0.35);
        it.mesh.material.opacity = k * 0.9;
      } else if (it.kind === 'shock') {
        const r = 0.3 + (1 - k) * it.targetR * 1.35;
        it.mesh.scale.setScalar(r);
        it.mesh.material.opacity = 0.75 * k;
      } else {
        it.mesh.material.opacity = k;
      }
    }
    this.items = this.items.filter((it) => {
      if (it.life > 0) return true;
      this.scene.remove(it.mesh);
      it.mesh.material.dispose?.();
      if (it.kind !== 'spark') it.mesh.geometry.dispose?.();
      return false;
    });
  }
}
