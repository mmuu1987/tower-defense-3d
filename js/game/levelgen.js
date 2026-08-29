// 40 关难度曲线：世界 w(0..3) 关卡 l(0..9)，d = w*10+l 为难度分
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';
import { mapForLevel } from './maps.js';

// —— 平衡常数（集中于此便于调参；tools/balance-probe.mjs 可运行时覆盖做扫描）——
// 问题背景：旧曲线 hpMul 是关卡常数 → 关卡内越往后敌人相对越弱，
// 而玩家收入（击杀赏金+波次奖金）持续累积 → 开局漏怪、中后期必然全歼（难度倒挂）。
export const BALANCE = {
  startGoldBase: 280,      // 开局基础金
  startGoldPerWorld: 160,  // 每进一个新世界额外开局金（确保高难度世界开局可直接部署 2-3 级塔）
  startGoldPerLvl: 18,     // 关卡微增
  waveSurplusBase: 1.6,    // 关卡内最终波额外强度
  waveSurplusHalfD: 20,    // 富余衰减半衰期
  waveRewardFraction: 0.5, // 赏金爬坡 = HP 爬坡 × 此比例
  earlyCountRamp: 0.65,    // 前三波数量折扣 0.65/0.75/0.85（开局手牌少，先给玩家喘息）
  earlyGapBonus: 0.20,     // 前两波出怪间隔加宽（每只 +0.20s，给塔留输出窗口）
};

export function buildLevel(worldIdx, lvlIdx, overrides = {}) {
  const d = worldIdx * 10 + lvlIdx;
  // 波次长度：6 波（第 1 世界）→ 15 波（第 5 世界），每小关耗时 2.5~4 分钟节奏紧凑
  const waveCount = 6 + Math.floor(d / 4.5);
  // 50 关平滑指数曲线：从 1x 平稳过渡到 ~10x（与 5 阶塔升级成长精准匹配）
  const hpMul = Math.pow(1.048, d);                   // 1x → 9.8x
  const speedMul = 1 + Math.min(0.18, d * 0.004);     // 1x → 1.18x 适度提速
  const rewardMul = Math.pow(1.048, d);               // 奖励同步爬坡
  const countMul = 1 + d * 0.03;                      // 数量缓增

  // 关卡内波次 HP 爬坡：把"最终波额外强度"摊到各波（前两波免爬坡，见 battle.startWave）。
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

  // 开局先锋怪池：前两波永远只刷基础步兵/疾行者，杜绝首波直接出高甲肉盾/萨满/极速灵狐导致开局崩盘
  const starterPool = (d >= 2) ? ['grunt', 'runner'] : ['grunt'];

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

    // 基础波：前 2 波使用 starterPool 先锋池，第 3 波起开放全怪池
    const activePool = (w < 2) ? starterPool : pool;
    const main = (w === 0)
      ? starterPool[lvlIdx % starterPool.length]
      : activePool[Math.floor((w * 0.7 + lvlIdx)) % activePool.length];

    // 开局软化：前三波数量打折（玩家手牌少，先给喘息），第 4 波起恢复全量
    const earlyCount = w >= 3 ? 1 : BALANCE.earlyCountRamp + 0.10 * w;
    const mainCount = Math.max(4, Math.round((5 + w * 0.8 + lvlIdx * 0.4) * countMul * earlyCount));
    // 前两波出怪间隔加宽：拉开首波血量洪峰，初始 2-3 座塔也接得住
    const earlyGap = w < 2 ? (2 - w) * BALANCE.earlyGapBonus : 0;
    groups.push({ type: main, count: mainCount, gap: Math.max(0.75, 1.15 - w * 0.04) + earlyGap, delay: 0.5 });

    if (activePool.length > 1 && w % 2 === 1) {
      const sub = activePool[(w + lvlIdx + 1) % activePool.length];
      if (sub !== main) {
        groups.push({ type: sub, count: Math.round(mainCount * 0.35), gap: 0.85, delay: 5.5 });
      }
    }
    if (isElite && w >= 2) {
      groups.push({ type: 'tank', count: 2 + Math.floor(d / 15), gap: 2.2, delay: 8 });
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
    startGold: BALANCE.startGoldBase + worldIdx * BALANCE.startGoldPerWorld + lvlIdx * BALANCE.startGoldPerLvl,
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
