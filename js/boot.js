// 启动自检：加载 three、最小渲染、错误上报到本地服务器（正式入口后续替换为 main.js）
const post = (m) => { try { fetch('/api/log', { method: 'POST', body: String(m).slice(0, 2000) }).catch(() => {}); } catch {} };
window.addEventListener('error', (e) => post(`[boot-error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => post(`[boot-rejection] ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));

const el = document.getElementById('boot-status');
const say = (t, bad = false) => { el.textContent = t; el.classList.toggle('bad', bad); };

try {
  say('正在加载渲染引擎…');
  const THREE = await import('../vendor/three/three.module.js');
  post(`[boot] three r${THREE.REVISION}`);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
  cam.position.set(3, 2.5, 5);
  cam.lookAt(0, 0, 0);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x57a9ff, roughness: 0.35, metalness: 0.1 })
  );
  box.castShadow = true;
  scene.add(box);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 6, 3);
  sun.castShadow = true;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8899bb, 0.8));

  addEventListener('resize', () => {
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  say(`自检通过 · three.js r${THREE.REVISION} · 渲染循环已启动`);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    box.rotation.y += dt * 0.9;
    box.rotation.x += dt * 0.4;
    box.position.y = Math.sin(clock.elapsedTime * 2) * 0.15;
    renderer.render(scene, cam);
  });
} catch (err) {
  say('初始化失败：' + ((err && err.message) || err), true);
  post('[boot-fatal] ' + ((err && err.stack) || err));
}
