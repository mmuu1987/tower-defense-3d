// 渐变天空穹顶 + 太阳光晕（HDR 输出喂给泛光），按主题着色
import * as THREE from 'three';

export function createSky(theme) {
  const geo = new THREE.SphereGeometry(320, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(theme.skyTop) },
      uBottom: { value: new THREE.Color(theme.skyBottom) },
      uSunColor: { value: new THREE.Color(theme.sunColor) },
      uSunDir: { value: new THREE.Vector3(0.45, 0.55, 0.35).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunColor; uniform vec3 uSunDir;
      void main(){
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uBottom, uTop, pow(h, 1.25));
        float s = max(dot(vDir, uSunDir), 0.0);
        col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.10);
        col *= mix(0.5, 1.0, smoothstep(-0.12, 0.04, vDir.y)); // 地平线以下压暗
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// 飘动云层：水平放置的柔边白云板，缓慢漂移（按主题微调颜色）
export function createClouds(theme) {
  const group = new THREE.Group();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 20 + Math.random() * 88, y = 40 + Math.random() * 48;
    const r = 10 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 1, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(cv);
  const tint = new THREE.Color(theme.fog).lerp(new THREE.Color(0xffffff), 0.72);
  const items = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(9 + Math.random() * 9, 5 + Math.random() * 4),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.3 + Math.random() * 0.25,
        depthWrite: false, fog: false, color: tint,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((Math.random() - 0.5) * 90, 20 + Math.random() * 16, (Math.random() - 0.5) * 70 - 6);
    m.renderOrder = -5;
    group.add(m);
    items.push({ m, speed: 0.25 + Math.random() * 0.5 });
  }
  return {
    group,
    update(dt) {
      for (const it of items) {
        it.m.position.x += it.speed * dt;
        if (it.m.position.x > 55) it.m.position.x = -55;
      }
    },
  };
}
