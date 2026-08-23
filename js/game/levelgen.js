// 40 关难度曲线：世界 w(0..3) 关卡 l(0..9)，d = w*10+l 为难度分
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';
import { mapForLevel } from './maps.js';

export function buildLevel(worldIdx, lvlIdx) {
  const d = worldIdx * 10 + lvlIdx;
  const waveCount = 6 + Math.floor(d / 3);            // 6 → 15 波
  const hpMul = Math.pow(1.085, d);                   // 1x → ~11x
  const speedMul = 1 + Math.min(0.28, d * 0.01);      // 1x → 1.28x
  const rewardMul = Math.pow(1.085, d);               // 1x → ~11x
  const countMul = 1 + d * 0.04;                      // 数量缓增

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
    const mainCount = Math.max(4, Math.round((5 + w * 0.8 + lvlIdx * 0.5) * countMul));
    groups.push({ type: main, count: mainCount, gap: Math.max(0.72, 1.1 - w * 0.045), delay: 0.5 });

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
    startGold: 220 + d * 14,
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
