// M3 轻量 HUD：资源条 + 塔坞 + 波次控制 + 选中塔面板（M5 全面美化重做）
const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
import { ENEMY_DEFS } from '../game/units.js';
export function createHud(battle, { audio, onSpeed, onQuit, onPause }) {
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div id="hud-top">
      <span id="hud-gold">💰 0</span>
      <span id="hud-lives">❤️ 0</span>
      <span id="hud-wave">波次 0/0</span>
      <span id="hud-state"></span>
    </div>
    <div id="hud-next" class="hidden"></div>
    <div id="hud-dock"></div>
    <div id="hud-panel" class="hidden"></div>
    <div id="hud-actions">
      <button id="btn-wave" class="hidden">开始下一波</button>
      <button id="btn-speed">⏩ x1</button>
      <button id="btn-mute">🔊</button>
      <button id="btn-pause" title="暂停">⏸</button>
      <button id="btn-quit">🏳️ 撤退</button>
    </div>
    <div id="hud-cancel" class="hidden"><button id="btn-cancel">✕ 取消建造</button></div>
    <div id="hud-hint" class="hidden"></div>
  `;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const dock = $('#hud-dock');
  const panel = $('#hud-panel');
  const hint = $('#hud-hint');
  const nextEl = $('#hud-next');
  const btnWave = $('#btn-wave');
  const btnSpeed = $('#btn-speed');

  // ———— 下一波预览：敌人构成 + 飞行标记 + 波次强化倍率（让 HP 爬坡对玩家可见）————
  function updateNextWave() {
    if (battle.state === 'won' || battle.state === 'lost') { nextEl.classList.add('hidden'); return; }
    const idx = battle.waveIdx + 1;                       // 下一波（0 基）
    const waves = battle.level.waves;
    if (idx >= waves.length) {
      nextEl.classList.remove('hidden');
      nextEl.innerHTML = '<b>⚡ 最终波</b> 守住！';
      return;
    }
    const wv = waves[idx];
    const parts = wv.groups.map((g) => {
      const def = ENEMY_DEFS[g.type];
      if (!def) return null;
      return `${def.name}×${g.count}${def.fly ? '<span class="fly">🕊飞行</span>' : ''}`;
    }).filter(Boolean);
    const ramp = 1 + Math.max(0, idx - 1) * (battle.level.waveHpRamp ?? 0);
    const rampTag = ramp > 1.001 ? ` <span class="ramp">⚔️×${ramp.toFixed(2)}</span>` : '';
    nextEl.classList.remove('hidden');
    nextEl.innerHTML = (wv.boss ? '<b>👑 BOSS 波</b> ' : '<b>下一波</b> ') + parts.join(' · ') + rampTag;
  }

  // 塔坞
  const DOCK = [
    { key: 'arrow', name: '箭塔', cost: 70 },
    { key: 'cannon', name: '炮塔', cost: 110 },
    { key: 'frost', name: '寒霜', cost: 90 },
    { key: 'tesla', name: '特斯拉', cost: 130 },
    { key: 'sniper', name: '狙击', cost: 150 },
  ];
  const cards = {};
  for (const d of DOCK) {
    const b = document.createElement('button');
    b.className = 'dock-card';
    b.innerHTML = `<img src="./assets/textures/ui/tower_${d.key}.png" alt="${d.name}" class="dock-thumb"><b>${d.name}</b><i>${d.cost}</i><em>再点取消</em>`;
    b.onclick = () => { audio?.click(); battle.selectBuild(battle.selectedType === d.key ? null : d.key); };
    dock.appendChild(b);
    cards[d.key] = { b, cost: d.cost };
  }

  function refreshDock() {
    for (const [key, c] of Object.entries(cards)) {
      c.b.classList.toggle('sel', battle.selectedType === key);
      c.b.classList.toggle('poor', battle.gold < c.cost);
    }
    // 建造模式显示取消芯片（触摸设备没有右键，必须有可见的退出途径）
    root.querySelector('#hud-cancel').classList.toggle('hidden', !battle.selectedType);
  }

  function showPanel(t) {
    if (!t) { panel.classList.add('hidden'); return; }
    const s = t.stats;
    const isMax = !t.canUpgrade();
    const lvTag = isMax ? '<span class="lv max-tag">Lv.5 👑MAX</span>' : `<span class="lv">Lv.${t.level + 1}</span>`;
    const extraStat = s.slow ? ` · 减速 ${(s.slow.pct * 100).toFixed(0)}%` : (s.chains ? ` · 连锁 ${s.chains}体` : (s.splash ? ` · 溅射 ${s.splash.toFixed(1)}` : (s.pierce ? ' · 穿甲' : '')));
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <b>${t.def.name} ${lvTag}</b>
      <div class="stats">伤害 ${s.dmg} · 射速 ${s.rate.toFixed(2)}/s · 射程 ${s.range.toFixed(1)}${extraStat}</div>
      <div class="row">
        ${t.canUpgrade() ? `<button id="p-up">升级 Lv.${t.level + 2} (${t.upgradeCost()}💰)</button>` : '<span class="max">已达最高级 👑</span>'}
        <button id="p-sell">出售 ${t.sellValue()}💰</button>
      </div>`;
    const up = panel.querySelector('#p-up');
    const sell = panel.querySelector('#p-sell');
    if (up) up.onclick = () => { if (battle.upgradeSelected()) audio?.upgradeSnd(); };
    sell.onclick = () => { battle.sellSelected(); audio?.sell(); };
  }

  const api = {
    root,
    gold(v) {
      const el = $('#hud-gold');
      el.textContent = `💰 ${v}`;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      refreshDock();
    },
    lives(v) { $('#hud-lives').textContent = `❤️ ${v}`; },
    wave(cur, total, boss) {
      $('#hud-wave').textContent = `波次 ${cur}/${total}` + (boss ? ' 👑BOSS' : '');
      if (boss) api.banner('👑 BOSS 来袭！');
      btnWave.classList.add('hidden'); // 波已开打（无论手动/倒计时自动），收起开波按钮
      btnWave.classList.remove('rush');
      updateNextWave();
    },
    state(txt) { $('#hud-state').textContent = txt || ''; },
    intermission(sec) {
      btnWave.classList.remove('hidden');
      const bonus = battle.earlyCallBonus(Math.max(0, sec));
      if (sec > 0.15) {
        btnWave.classList.add('rush');
        btnWave.textContent = `⏩ 提前开战 +${bonus}💰 (${sec.toFixed(0)}s)`;
      } else {
        btnWave.classList.remove('rush');
        btnWave.textContent = '下一波即将开始…';
      }
    },
    hideWaveBtn() { btnWave.classList.add('hidden'); },
    hint(txt) {
      if (!txt) { hint.classList.add('hidden'); return; }
      hint.classList.remove('hidden');
      hint.textContent = txt;
    },
    banner(txt) {
      const b = document.createElement('div');
      b.className = 'banner';
      b.textContent = txt;
      root.appendChild(b);
      setTimeout(() => b.remove(), 1800);
    },
    onSelectChanged() {
      refreshDock();
      showPanel(battle.selectedTower);
      api.hint(battle.selectedType
        ? (IS_TOUCH ? '点空地放置 · 拖动可平移视角' : '点击空地放置（右键取消）')
        : '');
    },
    end(win) {
      api.hint('');
      btnWave.classList.add('hidden');
      const b = document.createElement('div');
      b.className = 'banner big';
      b.textContent = win ? '🏆 胜利！' : '💀 失败…';
      root.appendChild(b);
      setTimeout(() => b.remove(), 2600); // 结算弹窗已接管，横幅短暂展示后移除
    },
  };

  // 开波按钮：休整期=提前开战（拿奖励金）；建造期=正常开战
  btnWave.onclick = () => {
    if (battle.state === 'intermission') battle.callWaveEarly();
    else battle.startWave();
    api.hideWaveBtn();
  };
  const speeds = [1, 2, 3];
  let spIdx = 0;
  btnSpeed.onclick = () => {
    spIdx = (spIdx + 1) % speeds.length;
    battle.speed = speeds[spIdx];
    btnSpeed.textContent = `⏩ x${speeds[spIdx]}`;
    onSpeed?.(speeds[spIdx]);
  };
  $('#btn-mute').onclick = (e) => {
    const m = !audio.muted;
    audio.setMuted(m);
    e.currentTarget.textContent = m ? '🔇' : '🔊';
  };
  $('#btn-pause').onclick = () => onPause?.();
  root.querySelector('#btn-cancel').onclick = () => battle.selectBuild(null);
  $('#btn-quit').onclick = () => onQuit();

  api.setSpeedLabel = (m) => { btnSpeed.textContent = `⏩ x${m}`; };

  // 钩子链化：不覆盖 main 预先注册的监听者
  const chain = (key, fn) => {
    const prev = battle.hooks[key];
    battle.hooks[key] = (...args) => { prev?.(...args); fn(...args); };
  };
  chain('onGold', (v) => api.gold(v));
  chain('onLives', (v) => api.lives(v));
  chain('onWave', (c, t, boss) => api.wave(c, t, boss));
  chain('onSelectChanged', () => api.onSelectChanged());
  chain('onWaveClear', (n) => api.banner(`第 ${n} 波清除！+${battle._lastBonus ?? 30}💰`));
  chain('onIntermission', (sec) => api.intermission(sec));
  chain('onEarlyCall', (bonus) => {
    api.banner(`⏩ 提前开战 +${bonus}💰`);
    audio?.coin();
  });
  chain('onEnd', (r) => api.end(r.win));

  api.gold(battle.gold);
  api.lives(battle.lives);
  api.wave(0, battle.level.waves.length, false);
  // 建造阶段就要显示开波按钮（此前仅波间倒计时显示，导致开局找不到入口）
  if (battle.state === 'build') btnWave.classList.remove('hidden');
  return api;
}
