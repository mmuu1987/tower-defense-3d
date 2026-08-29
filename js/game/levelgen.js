// 40 关难度曲线：世界 w(0..3) 关卡 l(0..9)，d = w*10+l 为难度分
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';
import { mapForLevel } from './maps.js';

// —— 平衡常数（集中于此便于调参；tools/balance-probe.mjs 可运行时覆盖做扫描）——
// 问题背景：旧曲线 hpMul 是关卡常数 → 关卡内越往后敌人相对越弱，
// 而玩家收入（击杀赏金+波次奖金）持续累积 → 开局漏怪、中后期必然全歼（难度倒挂）。
export const BALANCE = {
  startGoldBase: 240,      // 开局金（原 220：首波前只够 3 座箭塔，开局漏怪高发）
  startGoldPerD: 14,
  waveSurplusBase: 2.0,    // 关卡内最终波额外强度（d=0 时约 +2.4x→随 d 衰减），对冲经济富余
  waveSurplusHalfD: 16,    // 富余衰减半衰期（难度点）：高难度关卡本身已紧张，爬坡放缓防叠加过量
  waveRewardFraction: 0.5, // 赏金爬坡 = HP 爬坡 × 此比例（压制滚雪球但不饿死玩家）
  earlyCountRamp: 0.70,    // 前三波数量折扣 0.70/0.80/0.90（开局手牌少，先给玩家喘息）
  earlyGapBonus: 0.14,     // 前两波出怪间隔加宽（每只 +0.14s，给塔留输出窗口）
};

export function buildLevel(worldIdx, lvlIdx, overrides = {}) {
  const d = worldIdx * 10 + lvlIdx;
  const waveCount = 6 + Math.floor(d / 3);            // 6 → 15 波
  const hpMul = Math.pow(1.085, d);                   // 1x → ~11x
  const speedMul = 1 + Math.min(0.28, d * 0.01);      // 1x → 1.28x
  const rewardMul = Math.pow(1.085, d);               // 1x → ~11x
  const countMul = 1 + d * 0.04;                      // 数量缓增

  // 关卡内波次 HP 爬坡：把"最终波额外强度"摊到各波（前两波免爬坡，见 battle.startWave）。
  // 低难度关（教学世界）玩家 DPS 富余大 → 爬坡陡；高难度关间 hpMul 已陡 → 爬坡放缓。
  const surplus = BALANCE.waveSurplusBase / (1 + d / BALANCE.waveSurplusHalfD);
  const waveHpRamp = surplus / Math.max(4, waveCount - 2);
  const waveRewardRamp = waveHpRamp * BALANCE.waveRewardFraction;

  const pool = ['grunt'];
  if (d >= 2) pool.push('runner');
  if (d >= 4) pool.push('tank');
  if (d >= 5) pool.push('flyer');
  if (d >= 8) pool.push('healer');
  if (d >= 12) pool.push('splitter');
  // —— 扩充包：新怪物按难度逐步入池 ——
  if (d >= 13) pool.push('fox');
  if (d >= 15) pool.push('flamingo');
  if (d >= 17) pool.push('mummy');
  if (d >= 19) pool.push('stork');
  if (d >= 21) pool.push('dancer');

  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const groups = [];
    const isBossWave = lvlIdx === 9 && w === waveCount - 1;
    const isElite = lvlIdx >= 5 && w === Math.floor(waveCount / 2);

    if (isBossWave) {
      groups.push({ type: Object.keys(BOSS_DEFS)[worldIdx], count: 1, gap: 0, delay: 0.8 });
      const escort = pool[Math.min(pool.length - 1, 1)];
      groups.push({ type: escort, count: Math.round(6 * countMul), gap: 0.9, delay: 3 });
      waves.push({ groups, boss: true });
      continue;
    }

    // 基础波：主兵种 + 解锁池副兵种（间隔拉开，避免瞬时血量洪峰）
    const main = pool[Math.floor((w * 0.7 + lvlIdx)) % pool.length];
    // 开局软化：前三波数量打折（玩家手牌少，先给喘息），第 4 波起恢复全量
    const earlyCount = w >= 3 ? 1 : BALANCE.earlyCountRamp + 0.10 * w;
    const mainCount = Math.max(4, Math.round((5 + w * 0.8 + lvlIdx * 0.5) * countMul * earlyCount));
    // 前两波出怪间隔加宽：拉开首波血量洪峰，初始 2-3 座塔也接得住
    const earlyGap = w < 2 ? (2 - w) * BALANCE.earlyGapBonus : 0;
    groups.push({ type: main, count: mainCount, gap: Math.max(0.72, 1.1 - w * 0.045) + earlyGap, delay: 0.5 });

    if (pool.length > 1 && w % 2 === 1) {
      const sub = pool[(w + lvlIdx + 1) % pool.length];
      if (sub !== main) {
        groups.push({ type: sub, count: Math.round(mainCount * 0.35), gap: 0.85, delay: 5.5 });
      }
    }
    if (isElite) {
      groups.push({ type: 'tank', count: 2 + Math.floor(d / 12), gap: 2.0, delay: 8 });
    }
    waves.push({ groups });
  }

  return {
    worldIdx, lvlIdx,
    name: `第${worldIdx + 1}世界 · 第${lvlIdx + 1}关`,
    map: mapForLevel(worldIdx, lvlIdx),
    waves,
    hpMul, speedMul, rewardMul,
    waveHpRamp: overrides.waveHpRamp ?? waveHpRamp,        // 关卡内波次爬坡（battle 按波应用）
    waveRewardRamp: overrides.waveRewardRamp ?? waveRewardRamp,
    startGold: BALANCE.startGoldBase + d * BALANCE.startGoldPerD,
    lives: 20,
    intermission: 6,
    unlockPool: pool,
  };
}

// 三星标准
export function starsFor(lives, maxLives) {
  const r = lives / maxLives;
  if (r >= 0.999) return 3;
  if (r >= 0.5) return 2;
  return 1;
}
