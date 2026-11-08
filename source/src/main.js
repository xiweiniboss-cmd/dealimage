import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

// 离线缓存（PWA）。sw.js 在 public/ 下，构建后位于站点根目录
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((r) => r.update())
      .catch((e) => console.warn('离线缓存未启用：', e))
  })
}
