// 全局错误捕获与上报：写入本地服务器 logs/client.log，支持远程诊断（GET /api/logs）
export function installErrorReporting(tag = 'td') {
  const post = (msg) => {
    try {
      fetch('/api/log', { method: 'POST', body: String(msg).slice(0, 2000) }).catch(() => {});
    } catch {}
  };
  const fmt = (e) => (e && e.stack ? String(e.stack).slice(0, 1400) : String(e));
  window.addEventListener('error', (ev) =>
    post(`[${tag}-error] ${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}\n${fmt(ev.error)}`));
  window.addEventListener('unhandledrejection', (ev) =>
    post(`[${tag}-rejection] ${fmt(ev.reason)}`));
  // 拦截 console.error（GLTF/动画库等内部异常走这条路）
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try {
      post(`[${tag}-console-error] ` + args.map((a) => {
        const s = typeof a === 'object' ? fmt(a) : String(a);
        return s.slice(0, 300);
      }).join(' | '));
    } catch {}
    origError(...args);
  };
  return { post };
}
