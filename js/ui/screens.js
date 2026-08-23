// 界面覆盖层：主菜单 / 世界选关 / 设置面板（DOM，覆盖在渲染画布上）
export function createMenu({ onPlay, onSelect, onSettings }) {
  const root = document.createElement('div');
  root.id = 'screen-menu';
  root.innerHTML = `
    <div class="menu-inner">
      <h1 class="title">三境守卫</h1>
      <div class="subtitle">TRI-REALM DEFENSE</div>
      <div class="menu-btns">
        <button id="m-play" class="big">▶ 开始冒险</button>
        <button id="m-select">🗺 选择关卡</button>
        <button id="m-settings">⚙ 设置</button>
      </div>
      <div class="menu-tip">WASD/中键 移动视角 · 滚轮缩放 · Q/E 旋转</div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#m-play').onclick = onPlay;
  root.querySelector('#m-select').onclick = onSelect;
  root.querySelector('#m-settings').onclick = onSettings;
  return {
    root,
    show() { root.classList.remove('hidden'); },
    hide() { root.classList.add('hidden'); },
  };
}

export function createSelect({ save, onStart, onBack, onSettings }) {
  const WORLD_NAMES = ['翠谷草原', '熔岩荒地', '霜寒要塞', '黄沙戈壁'];
  const root = document.createElement('div');
  root.id = 'screen-select';
  root.innerHTML = `
    <div class="sel-inner">
      <div class="sel-head">
        <button id="s-back">← 返回</button>
        <h2>选择关卡</h2>
        <span id="s-stars">⭐ 0/120</span>
        <button id="s-settings">⚙</button>
      </div>
      <div id="s-tabs"></div>
      <div id="s-grid"></div>
    </div>`;
  document.body.appendChild(root);
  let curWorld = 0;

  function renderTabs() {
    const tabs = root.querySelector('#s-tabs');
    tabs.innerHTML = '';
    WORLD_NAMES.forEach((name, w) => {
      const unlocked = save.isUnlocked(w, 0) || (w === 0 ? true : false);
      const b = document.createElement('button');
      b.className = 'tab' + (w === curWorld ? ' on' : '') + (unlocked ? '' : ' lock');
      b.textContent = unlocked ? name : `🔒 ${name}`;
      b.onclick = () => { if (save.isUnlocked(w, 0)) { curWorld = w; render(); } };
      tabs.appendChild(b);
    });
  }

  function renderGrid() {
    const grid = root.querySelector('#s-grid');
    grid.innerHTML = '';
    for (let l = 0; l < 10; l++) {
      const unlocked = save.isUnlocked(curWorld, l);
      const stars = save.getStars(curWorld, l);
      const card = document.createElement('button');
      card.className = 'lvl-card' + (unlocked ? '' : ' lock') + (stars ? ' cleared' : '');
      card.innerHTML = `
        <b>${l + 1}</b>
        <span class="st">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
        ${l === 9 ? '<i>👑</i>' : ''}`;
      if (unlocked) card.onclick = () => onStart(curWorld, l);
      grid.appendChild(card);
    }
    root.querySelector('#s-stars').textContent =
      `⭐ ${save.totalStars()}/120`;
  }

  function render() { renderTabs(); renderGrid(); }
  root.querySelector('#s-back').onclick = onBack;
  root.querySelector('#s-settings').onclick = onSettings;
  render();

  return {
    root,
    refresh: render,
    show(worldIdx = 0) { if (save.isUnlocked(worldIdx, 0)) curWorld = worldIdx; render(); root.classList.remove('hidden'); },
    hide() { root.classList.add('hidden'); },
  };
}

// 设置面板（主菜单与暂停菜单共用）
export function createSettingsPanel({ save, audio, applyQuality }) {
  const root = document.createElement('div');
  root.id = 'panel-settings';
  root.className = 'modal hidden';
  const s = save.data.settings;
  root.innerHTML = `
    <div class="modal-box">
      <h3>⚙ 设置</h3>
      <label>音量
        <input id="set-vol" type="range" min="0" max="100" value="${Math.round((s.volume ?? .55) * 100)}"/>
        <span id="set-vol-v">${Math.round((s.volume ?? .55) * 100)}%</span>
      </label>
      <label>画质
        <select id="set-q">
          <option value="high">高（泛光+高清阴影）</option>
          <option value="medium">中</option>
          <option value="low">低（流畅优先）</option>
        </select>
      </label>
      <div class="row"><button id="set-ok">完成</button></div>
    </div>`;
  document.body.appendChild(root);

  const vol = root.querySelector('#set-vol');
  const volV = root.querySelector('#set-vol-v');
  vol.oninput = () => {
    const v = Number(vol.value) / 100;
    volV.textContent = `${vol.value}%`;
    audio?.setVolume(v);
    audio?.setMuted(v === 0 || audio.muted);
    save.setSetting('volume', v);
  };
  const q = root.querySelector('#set-q');
  q.value = s.quality || 'high';
  q.onchange = () => { save.setSetting('quality', q.value); applyQuality?.(q.value); };

  root.querySelector('#set-ok').onclick = () => root.classList.add('hidden');
  return {
    root,
    show() { root.classList.remove('hidden'); },
    hide() { root.classList.add('hidden'); },
  };
}

// 暂停菜单
export function createPause({ onResume, onRestart, onSelect, onSettings }) {
  const root = document.createElement('div');
  root.id = 'screen-pause';
  root.className = 'modal hidden';
  root.innerHTML = `
    <div class="modal-box">
      <h3>⏸ 暂停</h3>
      <div class="col">
        <button id="p-resume">▶ 继续</button>
        <button id="p-restart">🔄 重新开始</button>
        <button id="p-settings">⚙ 设置</button>
        <button id="p-quit">🗺 返回选关</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#p-resume').onclick = onResume;
  root.querySelector('#p-restart').onclick = onRestart;
  root.querySelector('#p-settings').onclick = onSettings;
  root.querySelector('#p-quit').onclick = onSelect;
  return {
    root,
    show() { root.classList.remove('hidden'); },
    hide() { root.classList.add('hidden'); },
    get visible() { return !root.classList.contains('hidden'); },
  };
}
