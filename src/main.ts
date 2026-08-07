import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

function boot() {
  const el = document.getElementById('app');
  if (!el) { setTimeout(boot, 50); return; }
  try {
    const app = createApp(App);
    app.config.errorHandler = (err, _instance, info) => {
      el.innerHTML = `<div style="padding:30px;font-family:monospace;color:#f85149;white-space:pre-wrap">组件错误 (${info}):\n${err}</div>`;
    };
    window.addEventListener('error', (e) => {
      el.innerHTML = `<div style="padding:30px;font-family:monospace;color:#f85149;white-space:pre-wrap">全局错误:\n${e.message}\n${e.filename}:${e.lineno}</div>`;
    });
    window.addEventListener('unhandledrejection', (e) => {
      el.innerHTML = `<div style="padding:30px;font-family:monospace;color:#f85149;white-space:pre-wrap">Promise拒绝:\n${String(e.reason)}</div>`;
    });
    app.mount(el);
  } catch (e: any) {
    el.innerHTML = `<div style="padding:40px;font-family:monospace;color:#f85149;white-space:pre-wrap">启动失败：\n${e?.stack ?? e}</div>`;
  }
}
boot();
