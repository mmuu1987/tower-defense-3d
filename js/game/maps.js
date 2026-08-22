// 路径布局库：cell 坐标（可为小数、含场外出入口），30 关循环复用并按世界配主题
export const MAPS = [
  { id: 'river-snake',
    waypoints: [[-2, 7], [3.5, 7], [3.5, 3], [8, 3], [8, 11], [13, 11], [13, 4], [18, 4], [18, 8], [24, 8]] },
  { id: 'double-bend',
    waypoints: [[-2, 3], [5, 3], [5, 10], [10, 10], [10, 2], [15, 2], [15, 9], [20, 9], [20, 12], [24, 12]] },
  { id: 'spiral-in',
    waypoints: [[-2, 12], [19, 12], [19, 2], [4, 2], [4, 9], [15, 9], [15, 5], [8.5, 5]] },
];

export function mapForLevel(worldIdx, lvlIdx) {
  return MAPS[(worldIdx * 3 + lvlIdx) % MAPS.length];
}
