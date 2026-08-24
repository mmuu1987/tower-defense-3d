// 游戏入口：状态机（主菜单/选关/战斗）+ 引擎装配 + 战斗生命周期管理
import * as THREE from 'three';
import { installErrorReporting } from './core/errors.js';
import { save } from './core/save.js';
import { AudioEngine } from './core/audio.js';
import { createRenderer, createSunLights } from './engine/renderer.js';
import { PostFX } from './engine/bloom.js';
import { createSky, createClouds } from './engine/sky.js';
import { CameraRig } from './engine/camera.js';
import { buildTerrain, isPathCell } from './engine/terrain.js';
import { scatterDecor, initDecorModels } from './engine/decor.js';
import { GRID, QUALITY_PRESETS, themeForWorld } from './game/config.js';
import { mapForLevel } from './game/maps.js';
import { buildLevel, starsFor } from './game/levelgen.js';
import { Battle } from './game/battle.js';
import { FxLayer, makePathSampler } from './game/entities.js';
import { TOWER_DEFS } from './game/towers.js';
import { ENEMY_MODEL_NAMES } from './game/units.js';
import { preloadEnemyModels } from './engine/modellib.js';
import { Floaters } from './ui/floaters.js';
import { createHud } from './ui/hud-lite.js';
import { createMenu, createSelect, createSettingsPanel, createPause } from './ui/screens.js';
import { createResult } from './ui/result.js';

const rep = installErrorReporting('td');
const params = new URLSearchParams(location.search);
const AUTO = params.get('auto') === '1';
const bootEl = document.getElementById('boot-status');

function fatal(err) {
  const msg = String((err && err.stack) || err);
  window.__TD_FATAL = msg;
  rep.post('[main-fatal] ' + msg.slice(0, 1800));
  const div = document.createElement('div');
  div.id = 'fatal';
  div.textContent = '初始化失败：' + msg;
  document.body.appendChild(div);
}

async function init() {
  save.load();
  if (params.get('admin') === '1') save.setAdmin(true); // ?admin=1 直开管理员模式
  let worldIdx = 0, lvlIdx = 0;
  if (params.get('level')) {
    const [w, l] = params.get('level').split(',').map(Number);
    if (Number.isFinite(w)) worldIdx = THREE.MathUtils.clamp(w, 0, 3);
    if (Number.isFinite(l)) lvlIdx = THREE.MathUtils.clamp(l, 0, 9);
  }

  // ———— 引擎 ————
  const renderer = createRenderer(QUALITY_PRESETS[save.data.settings.quality || 'high']);
  renderer.domElement.id = 'gl';
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 700);
  scene.fog = new THREE.Fog(0xffffff, 30, 140);

  let curTheme = themeForWorld(worldIdx);
  scene.fog.color.setHex(curTheme.fog);
  scene.fog.near = curTheme.fogNear;
  scene.fog.far = curTheme.fogFar;

  let sky = createSky(curTheme);
  scene.add(sky);
  const preset0 = QUALITY_PRESETS[save.data.settings.quality || 'high'];
  const { sun, hemi } = createSunLights(curTheme, preset0, GRID.w / 2, GRID.h / 2);
  scene.add(sun, hemi);

  const rig = new CameraRig(camera, renderer.domElement, {
    minX: -GRID.w / 2 - 2, maxX: GRID.w / 2 + 2,
    minZ: -GRID.h / 2 - 1, maxZ: GRID.h / 2 + 1,
  });
  rig.cur.focus.set(-1.5, 0, 0.8);
  rig.dist = 17;

  const postfx = new PostFX(renderer, preset0);
  const fx = new FxLayer(scene);
  const audio = new AudioEngine();
  audio.setVolume(save.data.settings.volume ?? 0.55);
  audio.setMuted(!!save.data.settings.muted);
  const floaters = new Floaters(camera);

  // 受创红闪
  const flashEl = document.createElement('div');
  flashEl.id = 'dmg-flash';
  document.body.appendChild(flashEl);
  function damageFlash() {
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('on');
  }

  // ———— 世界构建（可按主题重建）————
  const modelsReady = Promise.all([
    initDecorModels(),
    preloadEnemyModels(ENEMY_MODEL_NAMES), // 敌人动画模型预热
  ]); // Kenney 模型预热（失败自动回退程序化装饰）
  let worldBuild = null; // {group, pathCells, pts}
  async function rebuildWorld(theme, map) {
    if (worldBuild) {
      for (const g of [worldBuild.group, worldBuild.decor.group, worldBuild.clouds?.group]) {
        if (!g) continue;
        g.traverse((o) => {
          o.geometry?.dispose?.();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
            .forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
        });
        scene.remove(g);
      }
      scene.remove(sky);
      sky.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    curTheme = theme;
    scene.fog.color.setHex(theme.fog);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;
    sky = createSky(theme);
    scene.add(sky);
    sun.color.setHex(theme.sunColor);
    sun.intensity = theme.sunIntensity;
    hemi.color.setHex(theme.hemiSky);
    hemi.groundColor.setHex(theme.hemiGround);
    hemi.intensity = theme.hemiIntensity;

    const terrain = await buildTerrain({ theme, map });
    scene.add(terrain.group);
    await modelsReady; // 模型就绪后再散布装饰（未加载完的项自动回退程序化）
    const decor = scatterDecor({ theme, pathCells: terrain.pathCells, seed: 777, pathPts: terrain.pts });
    scene.add(decor.group);
    const clouds = createClouds(theme);
    scene.add(clouds.group);
    worldBuild = { ...terrain, decor, clouds };
  }

  await rebuildWorld(curTheme, mapForLevel(worldIdx, lvlIdx));

  // ———— UI 覆盖层 ————
  let mode = 'menu';       // menu | select | battle
  let battle = null, hud = null, paused = false, slowmo = 0;

  const applyQuality = (name) => {
    const p = QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, p.pixelRatioCap));
    postfx.setBloom(p.bloom);
    postfx.iterations = p.bloomIter || 2;
    sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.setSize(innerWidth, innerHeight);
    postfx.resize();
  };

  const settingsPanel = createSettingsPanel({
    save, audio, applyQuality,
  });

  const menu = createMenu({
    onPlay: () => {
      const nxt = save.nextLevel();
      enterBattle(nxt ? nxt.w : 3, nxt ? nxt.l : 9);
    },
    onSelect: () => showSelect(),
    onSettings: () => settingsPanel.show(),
  });

  const selectScreen = createSelect({
    save,
    onStart: (w, l) => enterBattle(w, l),
    onBack: () => showMenu(),
    onSettings: () => settingsPanel.show(),
  });

  const pauseMenu = createPause({
    onResume: () => togglePause(false),
    onRestart: () => { const b = battle; togglePause(false); exitBattle(); enterBattle(b.level.worldIdx, b.level.lvlIdx); },
    onSelect: () => { togglePause(false); exitBattle(); showSelect(); },
    onSettings: () => settingsPanel.show(),
  });

  const resultModal = createResult({
    onRetry: () => { const b = lastBattleInfo; enterBattle(b.w, b.l); },
    onNext: () => { const b = lastBattleInfo; enterBattle(Math.min(3, b.w + (b.l === 9 ? 1 : 0)), (b.l + 1) % 10); },
    onSelect: () => { exitBattle(); showSelect(); },
  });
  let lastBattleInfo = { w: 0, l: 0 };

  // 射程预览环
  const preview = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x59d97a, transparent: true, opacity: 0.85, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x59d97a, transparent: true, opacity: 0.1, depthWrite: false });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), ringMat);
  const discMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), discMat);
  ringMesh.rotation.x = -Math.PI / 2;
  discMesh.rotation.x = -Math.PI / 2;
  preview.add(ringMesh, discMesh);
  preview.position.y = 0.06;
  preview.visible = false;
  scene.add(preview);
  function setPreview(pos, range, color) {
    preview.visible = true;
    preview.position.set(pos.x, 0.06, pos.z);
    preview.scale.set(range, range, range);
    ringMat.color.setHex(color);
    discMat.color.setHex(color);
  }

  // 教学步骤
  let tutEl = null, tutSteps = null;
  function startTutorial() {
    tutSteps = [
      { text: '① 点击下方「箭塔」按钮选择建造', done: () => battle.selectedType === 'arrow' },
      { text: '② 点击路径旁的绿色草地放置箭塔', done: () => battle.towers.length >= 1 },
      { text: '③ 点击右下「开始下一波」，保卫基地！', done: () => battle.waveIdx >= 0 },
    ];
    tutEl = document.createElement('div');
    tutEl.id = 'tutorial';
    tutEl.innerHTML = `<span id="tut-text"></span><button id="tut-skip">跳过</button>`;
    document.body.appendChild(tutEl);
    tutEl.querySelector('#tut-skip').onclick = () => endTutorial();
  }
  function tickTutorial() {
    if (!tutEl || !battle) return;
    const cur = tutSteps.find((s) => !s.done());
    if (!cur) { endTutorial(); return; }
    tutEl.querySelector('#tut-text').textContent = cur.text;
  }
  function endTutorial() {
    tutEl?.remove(); tutEl = null;
    save.markTutorialDone();
  }

  // ———— 战斗生命周期 ————
  async function enterBattle(w, l) {
    exitBattle(); // 关键：清理上一局的塔/敌人/HUD（重玩、下一关路径此前漏了这步）
    menu.hide(); selectScreen.hide(); resultModal.hide();
    const level = buildLevel(w, l);
    await rebuildWorld(themeForWorld(w), level.map);
    slowmo = 0; paused = false;

    // 相机归位：清掉菜单环绕残留的偏航角，避免视角歪斜
    rig.yaw = 0; rig.cur.yaw = 0;
    rig.dist = 17; rig.cur.dist = Math.min(rig.cur.dist, 24);
    rig.cur.focus.set(-1.5, 0, 0.8);

    battle = new Battle({
      scene, level,
      sampler: makePathSampler(worldBuild.pts),
      pathCells: worldBuild.pathCells,
      fx,
      hooks: {
        camera,
        onShake: (a) => rig.shake(a),
        onHit: (e, dmg) => {
          floaters.damage(e.pos.clone().setY(e.def.size * 2 + 0.55), dmg);
          audio.hit((e.def.armor || 0) > 0);
        },
        onKill: (e) => {
          floaters.gold(e.pos.clone().setY(1.4), e.reward);
          audio.coin();
          if (e.def.shape === 'boss') {
            slowmo = Math.max(slowmo, 0.3);
            rig.shake(0.22);
            audio.roar();
            fx.burst(e.pos.clone().setY(0.8), 0xffcc66, 60, { speed: 5 });
          }
        },
        onExplosion: (pos, splash) => {
          audio.explosion(splash);
          rig.shake(Math.min(0.14, 0.03 + splash * 0.04));
          slowmo = Math.max(slowmo, 0.05);
        },
        onLeak: () => { damageFlash(); audio.leak(); rig.shake(0.07); },
        onBuild: (t) => { audio.build(); fx.burst(t.pos.clone().setY(0.3), 0xbfae90, 14, { speed: 2 }); preview.visible = false; },
      },
    });
    lastBattleInfo = { w, l };

    hud = createHud(battle, {
      audio,
      onSpeed: () => {},
      onQuit: () => { exitBattle(); showSelect(); },
    });
    chainAfterHud(w, l); // 在 HUD 钩子之后链式挂结算

    mode = 'battle';
    audio.resume();
    if (audio.ctx && audio.ctx.state === 'running' && !audio._musicStarted) {
      audio._musicStarted = true;
    }
    if (audio.ctx && audio.ctx.state === 'running') audio.startMusic(curTheme.id);
    rep.post(`[battle] start ${w},${l} auto=${AUTO}`);
    if (w === 0 && l === 0 && !save.data.tutorialDone && !AUTO) startTutorial();
  }

  function chainAfterHud() {
    // 结算（在 hud.onEnd 之后链式触发）
    const prevEnd = battle.hooks.onEnd;
    battle.hooks.onEnd = (r) => {
      prevEnd?.(r);
      const { w, l } = lastBattleInfo;
      if (r.win) {
        const stars = starsFor(battle.lives, battle.level.lives);
        save.addResult(w, l, stars);
        selectScreen.refresh();
        audio.victory();
        resultModal.show(true, {
          stars, levelName: battle.level.name,
          hasNext: !(w === 3 && l === 9),
        });
        slowmo = Math.max(slowmo, 0.25);
      } else {
        audio.defeat();
        resultModal.show(false, { levelName: battle.level.name });
      }
    };
  }

  function exitBattle() {
    battle?.destroy();
    battle = null;
    hud?.root.remove();
    hud = null;
    preview.visible = false;
    endTutorial();
    slowmo = 0; paused = false;
  }

  // ———— 模式切换 ————
  function showMenu() {
    mode = 'menu';
    selectScreen.hide(); resultModal.hide(); settingsPanel.hide();
    hud?.root.classList.add('hidden');
    menu.show();
    const nxt = save.nextLevel();
    menu.root.querySelector('#m-play').textContent =
      nxt ? `▶ 开始冒险（${nxt.w + 1}-${nxt.l + 1}）` : '▶ 已全通关！再战 4-10';
    rig.autoOrbit = true;
  }
  function showSelect() {
    mode = 'select';
    menu.hide(); resultModal.hide();
    hud?.root.classList.add('hidden');
    selectScreen.refresh();
    selectScreen.show();
    rig.autoOrbit = true;
  }
  function togglePause(on) {
    if (mode !== 'battle' && on) return;
    paused = on ?? !paused;
    paused ? pauseMenu.show() : pauseMenu.hide();
  }

  // 首次交互解锁音频；进战斗时按主题启动 BGM
  window.addEventListener('pointerdown', () => {
    audio.resume();
    if (!audio._musicStarted && mode !== 'menu') {
      audio._musicStarted = true;
      audio.startMusic(curTheme.id);
    }
  });
  window.addEventListener('keydown', () => audio.resume());

  // ———— 输入 ————
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || mode !== 'battle' || paused) return;
    if (!battle || battle.state === 'won' || battle.state === 'lost') return;
    const ray = rig.screenRay(ev.clientX, ev.clientY);
    if (!ray.ray.intersectPlane(groundPlane, hitPoint)) return;
    const cx = Math.floor(hitPoint.x + GRID.w / 2);
    const cz = Math.floor(hitPoint.z + GRID.h / 2);
    if (battle.selectedType) {
      const r = battle.tryPlace(cx, cz);
      if (r === 'blocked') hud.hint('❌ 这里不能建造');
      else if (r === 'poor') hud.hint('💰 金币不足');
      else if (r === true) { hud.banner('建造完成'); hud.hint(''); }
    } else {
      battle.selectTower(battle.towerAt(cx, cz));
    }
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (mode !== 'battle' || !battle?.selectedType) return;
    const ray = rig.screenRay(ev.clientX, ev.clientY);
    if (!ray.ray.intersectPlane(groundPlane, hitPoint)) return;
    const cx = Math.floor(hitPoint.x + GRID.w / 2);
    const cz = Math.floor(hitPoint.z + GRID.h / 2);
    const range = TOWER_DEFS[battle.selectedType]?.range ?? 3;
    const ok = battle.isBuildable(cx, cz) && battle.gold >= battle.costOf(battle.selectedType);
    setPreview({ x: cx - GRID.w / 2 + 0.5, z: cz - GRID.h / 2 + 0.5 }, range, ok ? 0x59d97a : 0xff5d5d);
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (settingsPanel.root.classList.contains('hidden') &&
          resultModal.root.classList.contains('hidden')) {
        if (mode === 'battle') togglePause();
      }
    }
    if (mode === 'battle' && battle && !paused && /^Digit[1-5]$/.test(e.code)) {
      const keys = ['arrow', 'cannon', 'frost', 'tesla', 'sniper'];
      const key = keys[Number(e.code.slice(5)) - 1];
      battle.selectBuild(battle.selectedType === key ? null : key);
      audio.click();
    }
  });

  // ———— 自动化测试模式（与 tools/sim.mjs 同策略：严格建造优先，造不起才升级）————
  const AUTO_PLAN = ['arrow', 'frost', 'arrow', 'cannon', 'arrow', 'tesla', 'sniper', 'arrow'];
  const AUTO_COSTS = { arrow: 70, cannon: 110, frost: 90, tesla: 130, sniper: 150 };
  function autoStep() {
    if (!AUTO || !battle || battle.state === 'won' || battle.state === 'lost') return;
    if (battle.towers.length < AUTO_PLAN.length) {
      const key = AUTO_PLAN[battle.towers.length];
      if (battle.gold >= AUTO_COSTS[key]) {
        const mid = battle.sampler.at(battle.sampler.total * (0.22 + 0.07 * battle.towers.length));
        outer:
        for (let r = 1; r <= 4; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            const cx = Math.floor(mid.x + GRID.w / 2 + dx);
            const cz = Math.floor(mid.z + GRID.h / 2 + dz);
            if (battle.isBuildable(cx, cz)) {
              battle.selectedType = key;
              if (battle.tryPlace(cx, cz) === true) break outer;
            }
          }
        }
        battle.clearSelection();
      }
    } else {
      const upCand = battle.towers
        .filter((t) => t.canUpgrade())
        .sort((a, b) => a.upgradeCost() - b.upgradeCost())[0];
      if (upCand && (battle.gold >= upCand.upgradeCost() + 20 || battle.gold > 260)) {
        battle.upgradeTower(upCand);
      }
    }
    if ((battle.state === 'build' || (battle.state === 'intermission' && battle.intermission < 1.5))) {
      battle.startWave(); hud?.hideWaveBtn();
    }
    if (battle.speed !== 3) { battle.speed = 3; hud?.setSpeedLabel(3); }
  }

  // ———— 主循环 ————
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.resize();
  });

  const fpsEl = document.createElement('div');
  fpsEl.id = 'fps';
  document.body.appendChild(fpsEl);
  let frames = 0, acc = 0;

  if (bootEl) bootEl.remove();

  const clock = new THREE.Clock();
  let firstFrameSent = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (AUTO && mode === 'battle') autoStep();

    if (mode === 'battle' && battle && !paused) {
      slowmo = Math.max(0, slowmo - dt);
      battle.update(dt * (slowmo > 0 ? 0.16 : 1));
      tickTutorial();
      // 选中塔的白色射程圈
      if (battle.selectedTower) {
        setPreview(battle.selectedTower.pos, battle.selectedTower.stats.range, 0xffffff);
        discMat.opacity = 0.06;
      } else if (!battle.selectedType) {
        preview.visible = false;
      }
      discMat.opacity = battle.selectedTower ? 0.06 : 0.1;
    } else if (mode !== 'battle') {
      rig.cur.yaw += dt * 0.07; // 菜单背景环绕运镜
    }

    rig.update(dt);
    worldBuild.decor.update(clock.elapsedTime);
    worldBuild.clouds?.update(dt);
    postfx.render(scene, camera);
    if (!firstFrameSent) { firstFrameSent = true; window.__TD_READY = true; }

    frames++; acc += dt;
    if (acc >= 0.5) {
      fpsEl.textContent =
        `${Math.round(frames / acc)} FPS · ${curTheme.name}` +
        (battle ? ` · ${battle.level.name} · ${paused ? 'paused' : battle.state}` : ' · 主菜单');
      frames = 0; acc = 0;
    }
  });

  // ———— 启动模式 ————
  window.__TD_DEBUG = { renderer, scene, camera, postfx, rig, fx, floaters, audio, battle: () => battle,
    ui: { menu, selectScreen, pauseMenu, settingsPanel, resultModal } };
  Object.defineProperty(window, '__TD_SNAP', { value: () => battle ? battle.snapshot() : { mode } });
  window.__TD_SAVE = save;
  window.__TD_SELECT = selectScreen;
  window.__TD_ENTER = enterBattle;

  const scr = params.get('screen');
  if (params.get('level')) {
    await enterBattle(worldIdx, lvlIdx);
  } else if (AUTO) {
    const n = save.nextLevel() || { w: 0, l: 0 };
    await enterBattle(n.w, n.l);
  } else if (scr === 'select') {
    showSelect();
  } else {
    showMenu();
  }

  rep.post(`[main] ready three=${THREE.REVISION} screen=${params.get('screen') || 'menu'} ` +
    `auto=${AUTO} quality=${save.data.settings.quality}`);
}

init().catch(fatal);
