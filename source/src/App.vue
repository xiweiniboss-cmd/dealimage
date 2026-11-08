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
const status = ref('还没有图片')
const fileName = ref('')
const fileSize = ref(0)
const srcW = ref(0)
const srcH = ref(0)
const resultSize = ref(0)
const scale = ref('1')
const zoom = ref('fit')
const stageW = ref(0)
const stageH = ref(0)
const rainCols = ref([])

let bitmap = null
let resultUrl = ''
let jobId = 0
let startedAt = 0
let worker
let resizeObserver
let syncingScroll = false
let textureCache = null
let rainResizeTimer = 0

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
const scaleHint = computed(() => {
  if (scale.value === '0.75') return '导出为原图的 75%。底纹会一起缩小，字还在，文件更小。'
  if (scale.value === '0.5') return '导出为原图的一半。聊天软件如果再压缩一次，底纹可能变淡，发之前看右边。'
  return '按原图像素导出。底纹最完整，也最接近你现在看到的效果。'
})

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
  status.value = '正在读取图片，并按拍摄方向摆正…'
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
    status.value = '这张图读不了'
    error.value = e instanceof Error ? e.message : '浏览器无法读取这张图片。换一张 PNG 或 JPG 试试。'
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

async function process() {
  if (!bitmap) return
  const id = ++jobId
  busy.value = true
  resetResult()
  error.value = ''
  status.value = '正在清理灰底、加入笔画扰动，并铺上底纹…'
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
  if ('stage' in msg) { status.value = '正在清理灰底、加入笔画扰动，并铺上底纹…'; return }
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
    const time = ms < 1000 ? '不到 1 秒' : `${(ms / 1000) | 0} 秒`
    status.value = `已生成，用时${time}。右边就是将要下载的图。`
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
  status.value = '还没有图片'
}

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

function buildRain() {
  const font = 15
  const count = Math.max(8, Math.ceil(window.innerWidth / font))
  const rows = Math.max(24, Math.ceil(window.innerHeight / (font * 1.15)) + 2)
  const cols = []
  for (let i = 0; i < count; i++) {
    let bits = ''
    for (let r = 0; r < rows; r++) bits += (Math.random() > 0.5 ? '1' : '0') + '\n'
    cols.push({
      id: `${i}-${rows}`,
      text: bits + bits,
      style: {
        left: `${i * font}px`,
        animationDuration: `${12 + (i % 7) * 1.6 + (i % 3)}s`,
        animationDelay: `${-((i * 1.7) % 18)}s`,
        opacity: (0.62 + (i % 5) * 0.07).toFixed(2),
      },
    })
  }
  rainCols.value = cols
}

function onRainResize() {
  window.clearTimeout(rainResizeTimer)
  rainResizeTimer = window.setTimeout(buildRain, 180)
}

watch(scale, () => { if (bitmap) process() })
watch(zoom, async () => {
  await nextTick()
  for (const el of [originalStage.value, resultStage.value]) if (el) { el.scrollLeft = 0; el.scrollTop = 0 }
})

onMounted(() => {
  buildRain()
  window.addEventListener('resize', onRainResize)
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
  window.clearTimeout(rainResizeTimer)
  window.removeEventListener('resize', onRainResize)
  worker.terminate()
  resizeObserver.disconnect()
  bitmap?.close()
  resetResult()
  window.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div class="binary-rain" aria-hidden="true">
    <span v-for="col in rainCols" :key="col.id" class="rain-col" :style="col.style">{{ col.text }}</span>
  </div>

  <div class="app-shell" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
    <header class="topbar">
      <a class="brand" href="./" aria-label="OCR 底纹首页">
        <img src="/app-icon.svg" alt="" />
        <span class="brand-text">
          <span class="brand-kicker">本地图片工具</span>
          <span class="brand-name">OCR 底纹</span>
        </span>
      </a>
      <p class="top-note">图片只在这台设备里处理，不会上传，也没有账号。</p>
    </header>

    <main class="workspace">
      <section class="intro">
        <div class="intro-copy">
          <p class="eyebrow">不是打码，也不是去水印</p>
          <h1>给人看的截图，不给机器一次认对</h1>
          <p class="lede">
            放进带文字的图片。工具会先把灰底收平，再在笔画附近加一层很浅的波纹，最后铺上固定底纹。亮的地方纹更明显，深色笔画上更淡，所以你自己还能读，文字识别在切字时更容易切错。字还留在图上。
          </p>
        </div>
        <ol class="steps">
          <li>
            <span>01</span>
            <strong>放入图片</strong>
            <p>点选、拖进页面，或直接粘贴。手机照片会按拍摄方向摆正。</p>
          </li>
          <li>
            <span>02</span>
            <strong>本机处理</strong>
            <p>清理背景、加扰动、铺底纹，通常一两秒。图片不会离开这台设备。</p>
          </li>
          <li>
            <span>03</span>
            <strong>对照后下载</strong>
            <p>左边是缩放后的原图，右边是加过底纹的结果。确认字还能读，再保存 PNG。</p>
          </li>
        </ol>
      </section>

      <section class="panel controls" aria-label="图片处理">
        <div class="upload-area">
          <button
            :class="['drop-zone', { dragging }]"
            @click="fileInput?.click()"
            @dragover.prevent.stop="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent.stop="onDrop"
          >
            <span class="drop-mark" aria-hidden="true"></span>
            <span class="drop-copy">
              <strong>{{ fileName ? '更换另一张图片' : '选择一张图片' }}</strong>
              <span>拖到这里，或在页面上按 Ctrl / ⌘ + V 粘贴</span>
            </span>
          </button>
          <input ref="fileInput" class="file-input" type="file" accept="image/*" aria-label="选择图片" @change="onFileChange" />
          <div v-if="fileName" class="file-info">
            <span class="file-name" :title="fileName">{{ fileName }}</span>
            <span>{{ srcW }} × {{ srcH }} · {{ formatBytes(fileSize) }}</span>
            <button class="clear-button" type="button" @click="clearAll">清空，重新开始</button>
          </div>
          <p v-else class="field-hint">支持 PNG、JPG、WebP 等浏览器能打开的图片。处理完的文件名是 image-protected.png。</p>
        </div>

        <label class="size-control" for="output-size">
          <span>导出多大</span>
          <select id="output-size" v-model="scale" :disabled="busy">
            <option value="1">原始尺寸</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
          </select>
          <p class="field-hint">{{ scaleHint }}</p>
        </label>

        <div class="download-block">
          <button class="download-button" type="button" :disabled="!hasResult || busy" @click="download">
            {{ busy ? '正在处理…' : '下载处理后的 PNG' }}
          </button>
          <p class="field-hint">{{ hasResult ? '保存的就是右边这张，不是原图。' : '右边出结果之后，这个按钮才能点。' }}</p>
        </div>
      </section>

      <p v-if="fileName || busy || error" :class="['process-status', { busy }]" role="status" aria-live="polite">{{ status }}</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>

      <section class="pipeline" aria-label="处理内容说明">
        <div class="section-head">
          <h2>结果里具体加了什么</h2>
          <p>三步按顺序做，强度固定。不是把字涂掉。</p>
        </div>
        <div class="pipeline-grid">
          <article>
            <span>1</span>
            <h3>背景清理</h3>
            <p>大片灰色收成少数几个灰阶，接近白的底会更平；彩色部分稍微提一点饱和。去掉细碎噪点，让字和底分开。</p>
          </article>
          <article>
            <span>2</span>
            <h3>笔画扰动</h3>
            <p>在文字附近加一层很浅的波纹。人看只觉得“有一点纹”，文字识别在二值化、切字符时更容易切错。</p>
          </article>
          <article>
            <span>3</span>
            <h3>底纹叠加</h3>
            <p>铺一张固定纹理，强度 40%。越亮的地方叠得越重，越暗的笔画叠得越轻。字还在，干净的白底不在了。</p>
          </article>
        </div>
      </section>

      <section class="preview-workspace" aria-label="图片对照">
        <div class="preview-toolbar">
          <p>两个画面一起滚动。放大是为了检查底纹细不细，不影响导出大小。</p>
          <div class="zoom-controls" role="group" aria-label="预览缩放">
            <button type="button" :class="{ active: zoom === 'fit' }" @click="zoom = 'fit'">适应画面</button>
            <button type="button" :class="{ active: zoom === '1' }" @click="zoom = '1'">100%</button>
            <button type="button" :class="{ active: zoom === '2' }" @click="zoom = '2'">200%</button>
          </div>
        </div>
        <div class="preview-grid">
          <article class="preview-panel">
            <div class="panel-heading">
              <div>
                <h2>原图</h2>
                <p>只按导出尺寸缩放，还没加底纹。</p>
              </div>
              <span v-if="fileName">{{ outW }} × {{ outH }}</span>
            </div>
            <div ref="originalStage" :class="['canvas-stage', { 'fit-mode': zoom === 'fit' }]" @scroll="syncScroll">
              <canvas v-if="fileName" ref="originalCanvas" :style="canvasStyle" aria-label="原图预览"></canvas>
              <div v-if="!fileName" class="empty-state">
                <strong>还没有原图</strong>
                <span>选择、拖入或粘贴之后，缩放后的原图会显示在这里。</span>
              </div>
            </div>
          </article>
          <article class="preview-panel">
            <div class="panel-heading">
              <div>
                <h2>处理结果</h2>
                <p>三步都做完。下载的就是这一张。</p>
              </div>
              <span v-if="hasResult">{{ outW }} × {{ outH }} · {{ formatBytes(resultSize) }}</span>
            </div>
            <div ref="resultStage" :class="['canvas-stage', { 'fit-mode': zoom === 'fit' }]" @scroll="syncScroll">
              <canvas v-if="fileName" v-show="hasResult" ref="resultCanvas" :style="canvasStyle" aria-label="处理结果预览"></canvas>
              <div v-if="!hasResult" class="empty-state">
                <strong>{{ busy ? '正在处理' : '还没有结果' }}</strong>
                <span>{{ busy ? '请稍等，完成前不要关掉页面。' : '处理完成后，在这里看字还能不能读、底纹会不会太重。' }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
