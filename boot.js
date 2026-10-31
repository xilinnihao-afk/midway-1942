/* 首屏先绘制；HTTP 按需加载模型，file:// 保留完整离线资源。 */
(() => {
  const version = new URL(document.currentScript.src).search;
  const byId = id => document.getElementById(id);
  let value = 0, failed = false;
  const scripts = new Map();
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const loadScript = path => {
    if (!scripts.has(path)) scripts.set(path, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path + version;
      script.onload = resolve;
      script.onerror = () => { scripts.delete(path); reject(new Error('资源读取失败，请检查网络后重试')); };
      document.head.append(script);
    }));
    return scripts.get(path);
  };
  window.MIDWAY_BOOT = {
    paint,
    embedded: () => loadScript('./assets/embedded.js'),
    report(percent, label) {
      if (failed) return;
      value = Math.max(value, Math.min(100, Math.round(percent)));
      byId('loading-fill').style.width = value + '%';
      byId('loading-percent').textContent = value + '%';
      byId('loading-progress').setAttribute('aria-valuenow', value);
      byId('loading-progress').setAttribute('aria-valuetext', `${label}，${value}%`);
      byId('loading-stage').textContent = label;
      byId('loading-panel').dataset.complete = String(value === 100);
      byId('loading-caption-state').textContent = value === 100 ? 'READY' : '请稍候';
    },
    fail(error) {
      if (failed) return;
      failed = true;
      byId('hud').dataset.state = 'error';
      byId('loading-stage').textContent = '准备中断 · 请重试';
      byId('loading-panel').dataset.error = 'true';
      byId('overlay-description').textContent = `无法完成准备：${error.message}`;
      byId('overlay-action').textContent = '重新加载 ↻';
      byId('overlay-action').disabled = false;
      byId('overlay-action').addEventListener('click', () => location.reload(), { once: true });
      console.error(error);
    }
  };
  (async () => {
    await paint();
    window.MIDWAY_BOOT.report(3, '正在连接飞行系统');
    if (location.protocol === 'file:') {
      window.MIDWAY_BOOT.report(5, '正在读取离线飞机与舰船资源');
      await window.MIDWAY_BOOT.embedded();
      window.MIDWAY_BOOT.report(12, '正在准备离线音效');
      await loadScript('./assets/audio/embedded.js');
      await loadScript('./standalone.js');
    } else {
      await import('./js/main.js');
    }
  })().catch(window.MIDWAY_BOOT.fail);
})();
