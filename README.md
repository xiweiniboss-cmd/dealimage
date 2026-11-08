# imageattackocr.vercel.app 拆解（OCR 底纹）

抓取时间：2026-11-09。用 REA（rea-agents 6.8.0，analyze-javascript-application）做静态分析，Evidence ID：
`ev_a2cc7d1d955fabf2eb31be30531fbda821a28c521db7c531ff717b9c2cbc3653`。

## 压缩包里有什么

- `site/`：线上原样镜像（index.html、打包后的 JS/CSS、Worker、texture.png、图标、manifest、sw.js）。直接丢到 Vercel / Cloudflare Pages 就能跑。
- `source/`：我还原出来的可读源码（Vite + Vue 3）。`npm install && npm run dev` 开发，`npm run build` 出 `dist/`。
- `REA分析摘要.txt`：REA 输出的要点。

## 它是怎么做的

**技术栈（观察到的）**：Vite 打包的 Vue 3 单组件应用，没有后端、没有 fetch 调用、没有 localStorage。处理在一个 module Web Worker 里跑，PWA 用手写 Service Worker 做离线缓存。

**页面流程**：选择 / 拖入 / 粘贴图片 → `createImageBitmap`（按 EXIF 摆正）→ 原图像素和 256×256 的 `texture.png` 像素一起转移给 Worker → Worker 返回结果 → 按“输出尺寸”（100% / 75% / 50%）缩放到 canvas → `toBlob` 导出 PNG，文件名 `image-protected.png`。两个预览框滚动同步，支持适应画面 / 100% / 200%。

**核心算法（Worker 三步）**：

1. **cleanup 清理**：5×5 邻域判断是不是灰色区域。灰色就量化成少数几个灰阶（背景吸到 240/255），彩色就每通道量化到 8 的倍数并把饱和度提高到 1.2 倍。等于先去噪、把背景压平。
2. **spectrum 频域陷波**：灰度图镜像补边到 2 的幂，做 2D FFT，把归一化半径 1/32 到 1/16 的环形频段清零，再逆变换，把亮度差直接加回原图（不限幅）。代码里还留着一个“相位随机化”模式（LCG 种子 6108），但线上没调用。
3. **texture 叠底纹**：把 texture.png 平铺叠上去，强度固定 0.4。亮底图做减法、暗底图做加法，叠加量乘以（亮度）²，所以背景处底纹重、文字笔画处轻。人眼还能读，OCR 的二值化和字符切分会被干扰。

**还原程度**：`source/src/texture.worker.js` 和原版 Worker 用同一张随机图测过，输出逐字节一致（23,668 字节，0 差异）。`App.vue` 的模板、class、文案和逻辑照着压缩代码还原，CSS 是原版格式化后的。变量名是我起的，原名已被压缩掉。

**改动**：原站 sw.js 是构建时生成的，写死了带 hash 的文件名；我换成了运行时缓存版本，功能相当。

## 观察 / 推断 / 未知

- 观察：以上流程、参数（强度 0.4、频段 1/32–1/16、灰阶规则）都直接来自线上代码。
- 推断：“干扰 OCR”的效果是从算法结构推出来的，我没有拿 OCR 引擎实测过它挡得住哪些。
- 未知：texture.png 是怎么生成的（只拿到成品图）；原作者的仓库和许可证。代码版权归原作者，这份拆解建议只用于学习。
