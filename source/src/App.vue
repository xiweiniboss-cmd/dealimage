<!-- 从线上压缩包 index-I5qFkFm0.js 里的 Vue 3 组件还原。模板结构、class、文案、逻辑与原版一致，变量名为我起的。 -->
<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const PRESET = { name: '标准底纹', strength: 0.4, textureUrl: '/texture.png' }

const fileInput = ref()
const originalCanvas = ref()
const resultCanvas = ref()
const originalStage = ref()
const resultStage = ref()

const dragging = ref(false)
const busy = ref(false)
const hasResult = ref(false)
const error = ref('')
const status = ref('等待选择图片')
const fileName = ref('')
const fileSize = ref(0)
const srcW = ref(0)
const srcH = ref(0)
const resultSize = ref(0)
const scale = ref('1') // 输出尺寸：1 / 0.75 / 0.5
const zoom = ref('fit') // 预览：fit / 1 / 2
const stageW = ref(0)
const stageH = ref(0)

let bitmap = null
let resultUrl = ''
let jobId = 0
let startedAt = 0
let worker
let resizeObserver
let syncingScroll = false
let textureCache = null

const outW = computed(() => Math.max(1, Math.round(srcW.value * Number(scale.value))))
const outH = computed(() => Math.max(1, Math.round(srcH.value * Number(scale.value))))
const viewScale = computed(() =>
  zoom.value === 'fit'
    ? Math.min(1, (stageW.value - 40) / outW.value, (stageH.value - 40) / outH.value)
    : Number(zoom.value),
)
const canvasStyle = computed(() => ({
  width: `${Math.max(1, outW.value * viewScale.value)}px`,
  height: `${Math.max(1, outH.value * viewScale.value)}px`,
}))

function formatBytes(n) {
  return n >= 1048576 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function resetResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  resultUrl = ''
  resultSize.value = 0
  hasResult.value = false
  if (resultCanvas.value) resultCanvas.value.width = 0
}

async function loadTexture() {
  if (textureCache) return textureCache
  const img = new Image()
  img.src = PRESET.textureUrl
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  textureCache = { pixels: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height }
  return textureCache
}

function drawOriginal() {
  if (!bitmap || !originalCanvas.value) return
  const c = originalCanvas.value
  c.width = outW.value
  c.height = outH.value
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)
}

async function loadFile(file) {
  if (!file) return
  const id = ++jobId
  busy.value = true
  error.value = ''
  resetResult()
  status.value = '正在读取图片…'
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (id !== jobId) { bmp.close(); return }
    bitmap?.close()
    bitmap = bmp
    fileName.value = file.name || '粘贴的图片.png'
    fileSize.value = file.size
    srcW.value = bmp.width
    srcH.value = bmp.height
    zoom.value = 'fit'
    await nextTick()
    drawOriginal()
    await process()
  } catch (e) {
    if (id !== jobId) return
    busy.value = false
    status.value = '图片读取失败'
    error.value = e instanceof Error ? e.message : '浏览器无法读取这张图片。'
  }
}

function onFileChange(e) {
  const input = e.target
  const file = input.files?.[0]
  input.value = ''
  loadFile(file)
}
function onDrop(e) {
  dragging.value = false
  loadFile(e.dataTransfer?.files[0])
}
function onPaste(e) {
  const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile()
  if (file) { e.preventDefault(); loadFile(file) }
}

// 原图按原始分辨率送进 Worker 处理，回来后再缩放到“输出尺寸”
async function process() {
  if (!bitmap) return
  const id = ++jobId
  busy.value = true
  resetResult()
  error.value = ''
  status.value = '正在处理…'
  startedAt = performance.now()
  try {
    const tex = await loadTexture()
    if (id !== jobId || !bitmap) return
    drawOriginal()
    const c = document.createElement('canvas')
    c.width = bitmap.width
    c.height = bitmap.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    const texCopy = new Uint8ClampedArray(tex.pixels)
    const msg = {
      id, width: c.width, height: c.height,
      rgba: data.data.buffer, texture: texCopy.buffer,
      textureWidth: tex.width, textureHeight: tex.height,
      strength: PRESET.strength,
    }
    worker.postMessage(msg, [msg.rgba, msg.texture])
  } catch (e) {
    if (id !== jobId) return
    busy.value = false
    status.value = '生成失败'
    error.value = e instanceof Error ? e.message : '图片处理失败。'
  }
}

async function onWorkerMessage(msg) {
  if (msg.id !== jobId) return
  if ('stage' in msg) { status.value = '正在处理…'; return }
  if ('error' in msg) { error.value = msg.error; busy.value = false; status.value = '生成失败'; return }
  const full = document.createElement('canvas')
  full.width = msg.width
  full.height = msg.height
  full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(msg.rgba), msg.width, msg.height), 0, 0)
  const c = resultCanvas.value
  c.width = outW.value
  c.height = outH.value
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, c.width, c.height)
  status.value = '正在导出 PNG…'
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  if (msg.id !== jobId) return
  busy.value = false
  if (blob) {
    resultUrl = URL.createObjectURL(blob)
    resultSize.value = blob.size
    hasResult.value = true
    const ms = performance.now() - startedAt
    status.value = `已生成 · ${ms < 1000 ? '< 1 秒' : `${(ms / 1000) | 0} 秒`}`
  } else {
    error.value = '浏览器未能导出 PNG。'
    status.value = '导出失败'
  }
}

function download() {
  if (!resultUrl) return
  const a = document.createElement('a')
  a.href = resultUrl
  a.download = 'image-protected.png'
  a.click()
}

function clearAll() {
  jobId++
  bitmap?.close()
  bitmap = null
  fileName.value = ''
  srcW.value = srcH.value = 0
  busy.value = false
  error.value = ''
  resetResult()
  if (originalCanvas.value) originalCanvas.value.width = 0
  status.value = '等待选择图片'
}

// 两个预览框同步滚动
function syncScroll(e) {
  if (syncingScroll) return
  const from = e.currentTarget
  const to = from === originalStage.value ? resultStage.value : originalStage.value
  if (!to) return
  syncingScroll = true
  to.scrollLeft = from.scrollLeft
  to.scrollTop = from.scrollTop
  requestAnimationFrame(() => { syncingScroll = false })
}

watch(scale, () => { if (bitmap) process() })
watch(zoom, async () => {
  await nextTick()
  for (const el of [originalStage.value, resultStage.value]) if (el) { el.scrollLeft = 0; el.scrollTop = 0 }
})

onMounted(() => {
  worker = new Worker(new URL('./texture.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => onWorkerMessage(e.data)
  worker.onerror = (e) => { busy.value = false; error.value = e.message; status.value = '处理出错' }
  resizeObserver = new ResizeObserver(() => {
    stageW.value = originalStage.value?.clientWidth ?? 0
    stageH.value = originalStage.value?.clientHeight ?? 0
  })
  resizeObserver.observe(originalStage.value)
  window.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  jobId++
  worker.terminate()
  resizeObserver.disconnect()
  bitmap?.close()
  resetResult()
  window.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div class="app-shell" @dragover.prevent @drop.prevent>
    <header class="topbar">
      <a class="brand" href="./" aria-label="OCR 底纹首页">
        <img src="/app-icon.svg" alt="" />
        <span>OCR 底纹</span>
      </a>
      <span class="local-label">本地处理</span>
    </header>

    <main class="workspace">
      <section class="controls" aria-label="图片处理">
        <div class="upload-area">
          <button
            :class="['drop-zone', { dragging }]"
            @click="fileInput?.click()"
            @dragover.prevent.stop="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent.stop="onDrop"
          >
            <strong>{{ fileName ? '更换图片' : '选择图片' }}</strong>
            <span>或拖入、粘贴</span>
          </button>
          <input ref="fileInput" class="file-input" type="file" accept="image/*" aria-label="选择图片" @change="onFileChange" />
          <div v-if="fileName" class="file-info">
            <span class="file-name" :title="fileName">{{ fileName }}</span>
            <span>{{ srcW }} × {{ srcH }} · {{ formatBytes(fileSize) }}</span>
            <button class="clear-button" @click="clearAll">清空</button>
          </div>
        </div>

        <label class="size-control" for="output-size">
          <span>输出尺寸</span>
          <select id="output-size" v-model="scale" :disabled="busy">
            <option value="1">原始尺寸</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
          </select>
        </label>

        <button class="download-button" :disabled="!hasResult || busy" @click="download">下载 PNG</button>
      </section>

      <div v-if="fileName || busy" class="process-status" role="status" aria-live="polite">{{ status }}</div>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>

      <section class="preview-workspace" aria-label="图片对照">
        <div class="preview-toolbar">
          <div class="zoom-controls" role="group" aria-label="预览缩放">
            <button :class="{ active: zoom === 'fit' }" @click="zoom = 'fit'">适应画面</button>
            <button :class="{ active: zoom === '1' }" @click="zoom = '1'">100%</button>
            <button :class="{ active: zoom === '2' }" @click="zoom = '2'">200%</button>
          </div>
        </div>
        <div class="preview-grid">
          <article class="preview-panel">
            <div class="panel-heading">
              <h2>原图</h2>
              <span v-if="fileName">{{ outW }} × {{ outH }}</span>
            </div>
            <div ref="originalStage" :class="['canvas-stage', { 'fit-mode': zoom === 'fit' }]" @scroll="syncScroll">
              <canvas v-show="fileName" ref="originalCanvas" :style="canvasStyle" aria-label="原图预览"></canvas>
              <div v-if="!fileName" class="empty-state">未选择图片</div>
            </div>
          </article>
          <article class="preview-panel">
            <div class="panel-heading">
              <h2>处理结果</h2>
              <span v-if="hasResult">{{ outW }} × {{ outH }} · {{ formatBytes(resultSize) }}</span>
            </div>
            <div ref="resultStage" :class="['canvas-stage', { 'fit-mode': zoom === 'fit' }]" @scroll="syncScroll">
              <canvas v-show="hasResult" ref="resultCanvas" :style="canvasStyle" aria-label="处理结果预览"></canvas>
              <div v-if="!hasResult" class="empty-state">{{ busy ? '处理中…' : '待处理' }}</div>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
