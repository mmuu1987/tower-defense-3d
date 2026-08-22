// 渲染器创建：ACES 由后处理合成通道统一处理，这里保持线性输出
import * as THREE from 'three';

export function createRenderer(preset) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // 抗锯齿由场景 RT 的 MSAA samples 提供
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 最终 gamma 在合成着色器完成
  return renderer;
}

// 方向光（太阳）：静态包围整个地图的阴影相机，稳定且省性能
export function createSunLights(theme, preset, mapHalfW, mapHalfH) {
  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.position.set(mapHalfW * 0.7 + 8, 22, mapHalfH * 0.7 + 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  const s = sun.shadow.camera;
  s.left = -mapHalfW - 8; s.right = mapHalfW + 8;
  s.top = mapHalfH + 8; s.bottom = -mapHalfH - 8;
  s.near = 2; s.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
  return { sun, hemi };
}
