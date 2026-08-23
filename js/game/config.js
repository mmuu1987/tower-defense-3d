// 全局配置与世界主题（塔/敌人数值表在 M3 扩充）
export const GRID = { w: 22, h: 15, cell: 1 };

// cellToWorld: 格子中心的世界坐标；地图中心为原点
export const cellToWorldX = (cx) => (cx - GRID.w / 2 + 0.5) * GRID.cell;
export const cellToWorldZ = (cz) => (cz - GRID.h / 2 + 0.5) * GRID.cell;

export const THEMES = [
  {
    id: 'meadow', name: '翠谷草原',
    skyTop: 0x4a9bf5, skyBottom: 0xd6ecff, fog: 0xcfe3f7, fogNear: 36, fogFar: 150,
    sunColor: 0xfff2d8, sunIntensity: 3.0,
    hemiSky: 0xbfd9ff, hemiGround: 0x57753f, hemiIntensity: 0.8,
    groundTex: './assets/textures/grass.jpg', groundFallback: 'grass', groundTint: 0xa3c285,
    pathTint: 0xd8cfbf, accent: 0x59d97a,
    decor: ['tree', 'rock', 'flower', 'bush', 'tuft', 'mushroom', 'ruin'],
  },
  {
    id: 'lava', name: '熔岩荒地',
    skyTop: 0x1c1030, skyBottom: 0x8a3b22, fog: 0x571f14, fogNear: 26, fogFar: 112,
    sunColor: 0xffb27a, sunIntensity: 2.5,
    hemiSky: 0x664433, hemiGround: 0x220a08, hemiIntensity: 0.55,
    groundTex: './assets/textures/stone.jpg', groundFallback: 'rock', groundTint: 0x8a5f52,
    pathTint: 0x4a3a34, accent: 0xff7a3c,
    decor: ['deadTree', 'rockDark', 'emberRock', 'lavaPool', 'campfire'],
  },
  {
    id: 'frost', name: '霜寒要塞',
    skyTop: 0x2a5a9a, skyBottom: 0xeaf6ff, fog: 0xdceafa, fogNear: 30, fogFar: 132,
    sunColor: 0xeaf4ff, sunIntensity: 2.7,
    hemiSky: 0xcfe4ff, hemiGround: 0x8fa6bd, hemiIntensity: 0.85,
    groundTex: '', groundFallback: 'snow', groundTint: 0xffffff,
    pathTint: 0x9fb4c8, accent: 0x7ad8ff,
    decor: ['pine', 'crystal', 'snowRock', 'iceStatue'],
  },
  {
    id: 'sand', name: '黄沙戈壁',
    skyTop: 0x3f74c9, skyBottom: 0xf7e3c0, fog: 0xe8d5ae, fogNear: 32, fogFar: 130,
    sunColor: 0xffe8b0, sunIntensity: 3.1,
    hemiSky: 0xd9c9a8, hemiGround: 0x8a6f4d, hemiIntensity: 0.75,
    groundTex: '', groundFallback: 'sand', groundTint: 0xd8b98a,
    pathTint: 0xb99b6b, accent: 0xffb347,
    decor: ['cactus', 'rock', 'ruin', 'deadTree'],
  },
];

export const QUALITY_PRESETS = {
  high:   { pixelRatioCap: 1.75, shadowMapSize: 2048, bloom: true,  bloomRes: 0.5,  bloomIter: 2 },
  medium: { pixelRatioCap: 1.25, shadowMapSize: 1024, bloom: true,  bloomRes: 0.5,  bloomIter: 1 },
  low:    { pixelRatioCap: 1.0,  shadowMapSize: 512,  bloom: false, bloomRes: 0.5,  bloomIter: 1 },
};

export function themeForWorld(worldIdx) { return THEMES[Math.max(0, Math.min(THEMES.length - 1, worldIdx))]; }
