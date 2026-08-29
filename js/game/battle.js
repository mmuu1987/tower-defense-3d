// 战斗编排：波次生成/敌人生命周期/经济/建造与选塔/胜负判定
import * as THREE from 'three';
import { GRID } from './config.js';
import { Enemy, Tower, Projectiles } from './entities.js';
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';

const ALL_DEFS = { ...ENEMY_DEFS, ...BOSS_DEFS };

export class Battle {
  constructor({ scene, level, sampler, pathCells, fx, hooks = {} }) {
    this.scene = scene;
    this.level = level;
    this.sampler = sampler;
    this.pathCells = pathCells;
    this.fx = fx;
    this.hooks = hooks;

    this.gold = level.startGold;
    this.lives = level.lives;
    this.waveIdx = -1;              // 已开始的波
    this.state = 'build';           // build | combat | won | lost
    this.enemies = [];
    this.towers = [];
    this.occupied = new Map();      // "cx,cz" -> Tower
    this.spawnQueue = [];           // {t, type}
    this.intermission = 0;
    this.speed = 1;
    this.time = 0;
    this.kills = 0;
    this.leaks = 0;
    this.waveHpMul = 1;      // 当前波 HP 爬坡乘数（关卡内越后的波次敌人越硬）
    this.waveRewardMul = 1;  // 当前波赏金爬坡乘数

    this.selectedType = null;       // 待建造的塔类型
    this.selectedTower = null;

    this.projectiles = new Projectiles(scene);
    this._tangentTmp = new THREE.Vector3();
  }

  // ———— 建造 ————
  isBuildable(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= GRID.w || cz >= GRID.h) return false;
    if (this.pathCells.has(`${cx},${cz}`)) return false;
    return !this.occupied.has(`${cx},${cz}`);
  }

  tryPlace(cx, cz) {
    if (!this.selectedType) return false;
    if (this.state === 'won' || this.state === 'lost') return false;
    const def = ALL_DEFS[this.selectedType] ? null : null; // noop 防御
    const tdef = this.selectedType;
    const cost = this.costOf(tdef);
    if (!this.isBuildable(cx, cz)) return 'blocked';
    if (this.gold < cost) return 'poor';
    const tower = new Tower(tdef, cx, cz);
    tower.placeAt(this.cellCenter(cx, cz));
    this.scene.add(tower.mesh);
    this.towers.push(tower);
    this.occupied.set(`${cx},${cz}`, tower);
    this.gold -= cost;
    this.hooks.onGold?.(this.gold);
    this.hooks.onBuild?.(tower);
    this.selectTower(tower);
    return true;
  }

  costOf(key) {
    // 后续可加难度折扣；当前为原价
    return ({ arrow: 70, cannon: 110, frost: 90, tesla: 130, sniper: 150 })[key] ?? 0;
  }
  cellCenter(cx, cz) {
    return new THREE.Vector3((cx - GRID.w / 2 + 0.5), 0, (cz - GRID.h / 2 + 0.5));
  }
  towerAt(cx, cz) { return this.occupied.get(`${cx},${cz}`) || null; }

  selectBuild(key) { this.selectedType = key; this.selectedTower = null; this.hooks.onSelectChanged?.(this); }
  selectTower(t) { this.selectedType = null; this.selectedTower = t || null; this.hooks.onSelectChanged?.(this); }
  clearSelection() { this.selectedType = null; this.selectedTower = null; this.hooks.onSelectChanged?.(this); }

  upgradeTower(t) {
    if (!t || !t.canUpgrade()) return false;
    const c = t.upgradeCost();
    if (this.gold < c) return false;
    this.gold -= c;
    t.upgrade();
    this.hooks.onGold?.(this.gold);
    this.hooks.onSelectChanged?.(this);
    return true;
  }
  upgradeSelected() { return this.upgradeTower(this.selectedTower); }
  sellSelected() {
    const t = this.selectedTower;
    if (!t) return;
    this.gold += t.sellValue();
    this.scene.remove(t.mesh);
    this.towers.splice(this.towers.indexOf(t), 1);
    this.occupied.delete(`${t.cx},${t.cz}`);
    this.clearSelection();
    this.hooks.onGold?.(this.gold);
  }

  // ———— 波次 ————
  startWave() {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'combat') return;
    if (this.waveIdx >= this.level.waves.length - 1) return; // 已是最后一波
    if (this.waveIdx + 1 >= this.level.waves.length) return;
    this.waveIdx++;
    const wave = this.level.waves[this.waveIdx];
    // 关卡内波次爬坡：前两波免爬坡（配合开局数量折扣），第 3 波起敌人越后越硬，
    // 对冲玩家经济滚雪球，掰正"开局难后期易"的难度倒挂
    this.waveHpMul = 1 + Math.max(0, this.waveIdx - 1) * (this.level.waveHpRamp ?? 0);
    this.waveRewardMul = 1 + Math.max(0, this.waveIdx - 1) * (this.level.waveRewardRamp ?? 0);
    this.spawnQueue = [];
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ t: g.delay + i * g.gap, type: g.type });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.state = 'combat';
    this.hooks.onWave?.(this.waveIdx + 1, this.level.waves.length, wave.boss);
  }

  get waveCleared() {
    return this.state === 'combat' && this.spawnQueue.length === 0 &&
      this.enemies.every((e) => !e.alive);
  }

  // ———— 提前开战：波间休整期跳过剩余倒计时，按剩余秒数返还奖励金 ————
  // 设计意图：与波次 HP 爬坡配合——休整时间是"备战资源"，高手可拿它换经济，但要少几秒布阵窗口
  earlyCallBonus(remainSec) {
    const upcoming = this.waveIdx + 1;   // 即将开始的一波（0 基）
    return Math.round(remainSec * (4 + upcoming * 1.0));
  }

  callWaveEarly() {
    if (this.state !== 'intermission') return 0;
    const remain = Math.max(0, this.intermission);
    const bonus = remain > 0.05 ? this.earlyCallBonus(remain) : 0;
    if (bonus > 0) {
      this.gold += bonus;
      this._lastEarlyBonus = bonus;
      this.hooks.onGold?.(this.gold);
      this.hooks.onEarlyCall?.(bonus, remain);
    }
    this.startWave();
    return bonus;
  }

  // ———— 主更新（dt 已乘速度倍率）————
  update(dtRaw) {
    if (this.state === 'won' || this.state === 'lost') return;
    const dt = Math.min(dtRaw, 0.05) * this.speed;
    this.time += dt;

    // 出兵
    for (const ev of this.spawnQueue) ev.t -= dt;
    while (this.spawnQueue.length && this.spawnQueue[0].t <= 0) {
      const ev = this.spawnQueue.shift();
      this.spawnEnemy(ev.type);
    }

    // 敌人
    const ctx = this._ctx();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt, ctx);
      if (e.dist >= this.sampler.total) {
        // 漏怪：立即标记清理（否则尸体永久堆积 → 数组膨胀 + 显存泄漏 → 越玩越卡）
        e.alive = false;
        e.disposed = true;
        this.lives--;
        this.leaks++;
        this.hooks.onLeak?.(e);
        this.hooks.onLives?.(this.lives);
      }
    }
    for (const e of this.enemies) if (e.dying) e.updateDeath(dt);
    // 死亡结算
    for (const e of this.enemies) {
      if (e.alive && e.hp <= 0) this.kill(e);
    }

    // 塔与弹道
    for (const t of this.towers) t.update(dt, ctx);
    this.projectiles.update(dt, ctx);
    this.fx.update(dt);

    // 清理尸体（死亡动画播完才移除；漏怪立即移除）
    let dirty = false;
    const remain = [];
    for (const e of this.enemies) {
      if (!e.disposed) remain.push(e);
      else { e.dispose(this.scene); dirty = true; }
    }
    if (dirty) this.enemies = remain;

    // 波次推进
    if (this.state === 'combat') {
      if (this.waveCleared) {
        if (this.waveIdx >= this.level.waves.length - 1) {
          this.state = 'won';
          this.hooks.onEnd?.({ win: true });
          return;
        }
        // 波次奖励金：帮玩家跟上强度曲线
        const bonus = 60 + (this.waveIdx + 1) * 10;
        this.gold += bonus;
        this.hooks.onGold?.(this.gold);
        this.intermission = this.level.intermission;
        this.state = 'intermission';
        this._lastBonus = bonus;
        this.hooks.onWaveClear?.(this.waveIdx + 1);
      }
    } else if (this.state === 'intermission') {
      this.intermission -= dt;
      this.hooks.onIntermission?.(Math.max(0, this.intermission));
      if (this.intermission <= 0) this.startWave();
    }

    if (this.lives <= 0 && this.state !== 'lost') {
      this.state = 'lost';
      this.hooks.onEnd?.({ win: false });
    }
  }

  spawnEnemy(type) {
    const def = ALL_DEFS[type];
    if (!def) return;
    const e = new Enemy(def, {
      sampler: this.sampler,
      hpMul: this.level.hpMul * this.waveHpMul,
      rewardMul: this.level.rewardMul * this.waveRewardMul,
      speedMul: this.level.speedMul,
    });
    this.sampler.at(0, e.pos);
    e.mesh.position.x = e.pos.x;
    e.mesh.position.z = e.pos.z;
    this.scene.add(e.mesh);
    this.enemies.push(e);
  }

  kill(e) {
    if (e.dying) return;
    e.startDeath(); // 死亡动画/沉没序列（alive=false, dying=true）
    this.kills++;
    this.gold += e.reward;
    // 死亡光柱：灵魂升天特效
    this.fx.beam?.(e.pos.clone().setY(0.1), e.def.color ?? 0xffffff, e.def.shape === 'boss' ? 5 : 2.6);
    this.hooks.onGold?.(this.gold);
    this.hooks.onKill?.(e);
    this.fx.burst(e.pos.clone().setY(0.5), e.def.color, e.def.shape === 'boss' ? 40 : 10);
    if (e.def.splitInto) {
      const si = e.def.splitInto;
      for (let i = 0; i < si.count; i++) {
        const child = new Enemy(ALL_DEFS[si.type], {
          sampler: this.sampler,
          hpMul: this.level.hpMul * this.waveHpMul * si.hpMul,
          rewardMul: this.level.rewardMul * this.waveRewardMul * (si.rewardMul ?? 0.5),
          speedMul: this.level.speedMul,
        });
        child.dist = Math.max(0, e.dist - i * 0.5);
        this.sampler.at(child.dist, child.pos);
        child.mesh.position.x = child.pos.x;
        child.mesh.position.z = child.pos.z;
        this.scene.add(child.mesh);
        this.enemies.push(child);
      }
    }
    // Boss 死亡裂变（熔火之心）
    if (e.def.deathSpawn) {
      const ds = e.def.deathSpawn;
      for (let i = 0; i < ds.count; i++) {
        const child = new Enemy(ALL_DEFS[ds.type], {
          sampler: this.sampler,
          hpMul: this.level.hpMul * this.waveHpMul * ds.hpMul,
          rewardMul: this.level.rewardMul * this.waveRewardMul * 0.5,
          speedMul: this.level.speedMul,
        });
        child.dist = Math.max(0, e.dist - i * 0.7);
        this.sampler.at(child.dist, child.pos);
        child.mesh.position.x = child.pos.x;
        child.mesh.position.z = child.pos.z;
        this.scene.add(child.mesh);
        this.enemies.push(child);
      }
    }
  }

  hitEnemy(e, dmg, opts) {
    const applied = e.hurt(dmg, opts);
    if (applied > 0) this.hooks.onHit?.(e, applied);
  }

  explode(pos, dmg, splash) {
    // 焦痕贴花 + 冲击波球
    this.fx.decal?.(pos, splash * 1.05);
    this.fx.shockwave?.(pos.clone().setY(0.25), splash);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.def.fly) continue; // 炮弹对空无效（地面爆炸）
      const d2 = e.pos.distanceToSquared(pos);
      if (d2 <= splash * splash) this.hitEnemy(e, dmg);
    }
    this.hooks.onExplosion?.(pos, splash);
  }

  _ctx() {
    return {
      enemies: this.enemies,
      time: this.time,
      camera: this.hooks.camera,
      fx: this.fx,
      projectiles: this.projectiles,
      hitEnemy: (e, d, o) => this.hitEnemy(e, d, o),
      explode: (p, d, s) => this.explode(p, d, s),
      tangentOf: (e) => e.sampler.tangentAt(e.dist, this._tangentTmp),
    };
  }

  snapshot() {
    return {
      state: this.state, gold: this.gold, lives: this.lives,
      wave: this.waveIdx + 1, totalWaves: this.level.waves.length,
      enemies: this.enemies.filter((e) => e.alive).length,
      towers: this.towers.length, speed: this.speed,
      kills: this.kills, leaks: this.leaks,
    };
  }

  // 战斗结束/退出时清理场景中的所有战斗实体（地形装饰保留）
  destroy() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    for (const t of this.towers) t.dispose(this.scene);
    this.towers = [];
    this.occupied.clear();
    for (const p of this.projectiles.list) this.scene.remove(p.mesh);
    this.projectiles.list = [];
    this.spawnQueue = [];
    this.state = 'lost';
  }
}
