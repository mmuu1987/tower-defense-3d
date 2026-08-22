// 结算弹窗：胜利（星级动画 + 下一关/重玩/选关）/ 失败（重试/选关）
export function createResult({ onRetry, onNext, onSelect }) {
  const root = document.createElement('div');
  root.id = 'screen-result';
  root.className = 'modal hidden';
  root.innerHTML = `<div class="modal-box result" id="res-box"></div>`;
  document.body.appendChild(root);

  function show(win, { stars = 0, hasNext = false, levelName = '' } = {}) {
    const box = root.querySelector('#res-box');
    if (win) {
      const starEls = [1, 2, 3].map((i) =>
        `<span class="rstar ${i <= stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.28}s">★</span>`).join('');
      box.innerHTML = `
        <div class="r-title win">🏆 胜利！</div>
        <div class="r-stars">${starEls}</div>
        <div class="r-sub">${levelName}</div>
        <div class="row">
          ${hasNext ? '<button id="r-next">➡ 下一关</button>' : ''}
          <button id="r-retry">🔄 重玩</button>
          <button id="r-select">🗺 选关</button>
        </div>`;
    } else {
      box.innerHTML = `
        <div class="r-title lose">💀 基地陷落…</div>
        <div class="r-sub">${levelName} · 再试试别的布防思路？</div>
        <div class="row">
          <button id="r-retry">🔄 重试</button>
          <button id="r-select">🗺 选关</button>
        </div>`;
    }
    box.querySelector('#r-retry').onclick = () => { hide(); onRetry(); };
    const nx = box.querySelector('#r-next');
    if (nx) nx.onclick = () => { hide(); onNext(); };
    box.querySelector('#r-select').onclick = () => { hide(); onSelect(); };
    root.classList.remove('hidden');
  }

  function hide() { root.classList.add('hidden'); }
  return { root, show, hide };
}
