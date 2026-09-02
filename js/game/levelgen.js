// 40 关难度曲线：世界 w(0..3) 关卡 l(0..9)，d = w*10+l 为难度分
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';
import { mapForLevel } from './maps.js';

// —— 平衡常数（集中于此便于调参；tools/econprobe.mjs / balance-probe.mjs 可运行时覆盖做扫描）——
// 历史问题①：hpMul 曾是关卡常数 → 关卡内越往后敌人相对越弱（波次爬坡已修）。
// 历史问题②（本轮）：塔在世界 4 即 12 座全满 Lv5 封顶，金币再无出口（世界5 剩金 41200 = 收入 75%），
//   而敌人 HP 仅 1.048^d→9.95x，玩家总火力（塔数 4x × 单塔 DPS 10~23x）达 40~90x → 中后期零压力。
//   对策：敌人后期加速爬坡 + 高阶升级提价（造出金币出口）+ 后期收入增速低于 HP 增速。
export const BALANCE = {
  startGoldBase: 280,      // 开局基础金
  startGoldPerWorld: 160,  // 每进一个新世界额外开局金（确保高难度世界开局可直接部署 2-3 级塔）
  startGoldPerLvl: 18,     // 关卡微增
  waveSurplusBase: 1.6,    // 关卡内最终波额外强度
  waveSurplusHalfD: 20,    // 富余衰减半衰期
  waveRewardFraction: 0.5, // 赏金爬坡 = HP 爬坡 × 此比例
  earlyCountRamp: 0.65,    // 前三波数量折扣 0.65/0.75/0.85（开局手牌少，先给玩家喘息）
  earlyGapBonus: 0.20,     // 前两波出怪间隔加宽（每只 +0.20s，给塔留输出窗口）
  // ——— 难度主曲线（本轮按用户要求：终局约现在的 2 倍，世界1-2 完全不动）———
  hpBase: 1.048,           // HP 基础指数（世界1-2 手感已验证良好，不动）
  hpLateFrom: 14,          // 后期加速起点（难度点 d，约世界2中段；之前的关卡零影响）
  hpLatePow: 1.35,         // 后期加速幂次
  hpLateK: 0.010,          // 后期加速系数：W3 ×1.1~1.4、W4 ×1.4~1.8、W5 ×1.8~2.2（终局 9.95→22.0）
  // ——— 经济（收入增速刻意低于 HP 增速，杜绝后期钱花不完）———
  rewardBase: 1.048,       // 击杀赏金指数：刻意不跟随 HP 后期加速
                           // → 敌人变硬但赏金不变 = "每点血赚的钱"自然下降，最自然的收紧方式
  rewardLateK: 0,          // 后期赏金加速（0 = 完全不加速）
  waveBonusBase: 60,       // 清波奖金基数（保持：高阶升级提价已经吸走富余，不必再砍收入）
  waveBonusPerWave: 10,    // 每波递增
  // ——— 数量与速度（制造"波次更密、推进更快"的压迫感，且不像 HP 那样直接放大赏金总量）———
  countPerD: 0.03,         // 数量随难度线性增长
  countLateFrom: 20,       // 数量后期加速起点
  countLateK: 0.012,       // 数量后期加速系数
  speedCap: 0.26,          // 移速上限增幅（原 0.18）
  speedPerD: 0.005,        // 移速增速（原 0.004）
};

export function buildLevel(worldIdx, lvlIdx, overrides = {}) {
  const d = worldIdx * 10 + lvlIdx;
  // 波次长度：6 波（第 1 世界）→ 15 波（第 5 世界），每小关耗时 2.5~4 分钟节奏紧凑
  const waveCount = 6 + Math.floor(d / 4.5);
  // HP 曲线：前期温和指数，中后期加速——对冲"塔封顶后火力过剩"
  const lateD = Math.max(0, d - BALANCE.hpLateFrom);
  const hpLateMul = 1 + Math.pow(lateD, BALANCE.hpLatePow) * BALANCE.hpLateK;
  const hpMul = Math.pow(BALANCE.hpBase, d) * hpLateMul;
  const speedMul = 1 + Math.min(BALANCE.speedCap, d * BALANCE.speedPerD);
  // 赏金：只走基础指数（+可选后期加速），刻意慢于 HP → 后期金币变紧
  const rewardLateD = Math.max(0, d - BALANCE.hpLateFrom);
  const rewardMul = Math.pow(BALANCE.rewardBase, d) *
    (1 + Math.pow(rewardLateD, BALANCE.hpLatePow) * BALANCE.rewardLateK);
  // 数量：线性 + 后期加速（波次更密）
  const countLateD = Math.max(0, d - BALANCE.countLateFrom);
  const countMul = 1 + d * BALANCE.countPerD + countLateD * BALANCE.countLateK;

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
    waveBonusBase: BALANCE.waveBonusBase,
    waveBonusPerWave: BALANCE.waveBonusPerWave,
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
