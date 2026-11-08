// texture.worker.js
// 从线上 /assets/texture.worker-BhDJqA30.js 逐行还原（变量改名 + 注释），算法与原版一致。
// 流水线：cleanup（降噪/量化） → spectrum（频域陷波） → texture（叠加底纹）

/**
 * 第 3 步：把 256×256 的 texture.png 平铺叠加到图上。
 * 亮底图（平均亮度 ≥ 0.5）做“减法”，暗底图做“加法”；
 * 叠加量 = strength × 底纹像素 × (亮度或 1-亮度)²，所以越接近背景的地方底纹越重，
 * 文字笔画（与背景反差大）处底纹很轻，人眼仍能读，OCR 却被干扰。
 */
function applyTexture(rgba, width, height, texture, texW, texH, strength) {
  const out = new Uint8ClampedArray(rgba);
  if (strength === 0) return out;
  const f = Math.fround;
  const W = [f(0.299), f(0.587), f(0.114)];
  const luma = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    const p = i * 4;
    const r = f(f(rgba[p] / 255) * W[0]);
    const g = f(f(rgba[p + 1] / 255) * W[1]);
    const b = f(f(rgba[p + 2] / 255) * W[2]);
    const y = f(f(r + g) + b);
    luma[i] = y;
    sum += y;
  }
  const lightBackground = sum / luma.length >= 0.5;
  const s = f(strength);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      // 注意：原版用 (y % texH) * texW + x % texW 取底纹像素（参数顺序 texW, texH）
      const t = ((y % texH) * texW + (x % texW)) * 4;
      const base = lightBackground ? luma[i] : f(1 - luma[i]);
      const weight = f(base * base);
      for (let c = 0; c < 3; c++) {
        const v = f(rgba[p + c] / 255);
        const d = f(f(s * f(texture[t + c] / 255)) * weight);
        const nv = f(lightBackground ? v - d : v + d);
        out[p + c] = Math.floor(f(f(Math.min(1, Math.max(0, nv)) * 255) + 0.5));
      }
    }
  }
  return out;
}

/**
 * 第 1 步：清理。5×5 邻域按 alpha 加权求平均色，
 * 邻域近乎灰色（最大-最小通道 < 12）→ 输出量化后的灰度（暗部 16 级、中间 32 级、亮部吸到 240/255）；
 * 否则 → 每通道量化到 8 的倍数，并以 1.2 倍增强饱和度。
 * 作用：抹掉 JPEG 噪点、统一背景，让后面的底纹效果稳定。
 */
function cleanup(rgba, width, height) {
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) {
          const q = (yy * width + xx) * 4;
          const a = rgba[q + 3];
          sr += rgba[q] * a; sg += rgba[q + 1] * a; sb += rgba[q + 2] * a; sa += a;
        }
      }
      const div = Math.max(sa, 1);
      const isGray = Math.max(sr, sg, sb) / div - Math.min(sr, sg, sb) / div < 12;
      const lum = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
      const grayLevel =
        lum < 24 ? Math.floor(lum / 16 + 0.5) * 16
        : lum >= 232 ? (lum < 247.5 ? 240 : 255)
        : Math.floor(lum / 32 + 0.5) * 32;
      const q8 = [0, 1, 2].map((c) => Math.min(255, Math.floor(rgba[p + c] / 8 + 0.5) * 8));
      const qLum = (q8[0] * 299 + q8[1] * 587 + q8[2] * 114) / 1000;
      for (let c = 0; c < 3; c++) {
        out[p + c] = isGray
          ? grayLevel
          : Math.floor(Math.max(0, Math.min(255, qLum + 1.2 * (q8[c] - qLum))) + 0.5);
      }
    }
  }
  return out;
}

/** 原地 1D FFT（基 2，位反转 + 蝶形）。forward=false 为正变换，true 为逆变换（并除以 N）。 */
function fft1d(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** 2D FFT：先逐行，再逐列。 */
function fft2d(re, im, w, h, inverse) {
  for (let y = 0; y < h; y++) fft1d(re.subarray(y * w, (y + 1) * w), im.subarray(y * w, (y + 1) * w), inverse);
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { cr[y] = re[y * w + x]; ci[y] = im[y * w + x]; }
    fft1d(cr, ci, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = cr[y]; im[y * w + x] = ci[y]; }
  }
}

/**
 * 第 2 步：频域处理。灰度图镜像补边到 2 的幂 → FFT →
 * 把归一化半径 1/32~1/16 的环形频段：
 *   mode="notch"：直接清零（线上实际用的就是这个）；
 *   mode="phase"：保留幅度、相位随机化（LCG 种子 6108，代码保留但未调用）。
 * 逆变换后把亮度差加回原图；limit=Infinity 表示不限幅，
 * 否则在边缘（相邻差 ≥24）和彩色区跳过/弱化，并用 tanh 软限幅。
 */
function spectrum(rgba, width, height, limit = 12, mode = 'phase') {
  if (limit === 0) return new Uint8ClampedArray(rgba);
  const W = 2 ** Math.ceil(Math.log2(width));
  const H = 2 ** Math.ceil(Math.log2(height));
  const re = new Float64Array(W * H), im = new Float64Array(W * H);
  const gray = new Float64Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4, a = rgba[p + 3] / 255;
    gray[i] = ((rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000) * a + 255 * (1 - a);
  }
  for (let y = 0; y < H; y++) {
    const sy = y < height ? y : 2 * height - y - 1;
    for (let x = 0; x < W; x++) {
      const sx = x < width ? x : 2 * width - x - 1;
      re[y * W + x] = gray[sy * width + sx];
    }
  }
  fft2d(re, im, W, H, false);
  let seed = 6108;
  for (let y = 0; y < H; y++) {
    const fy = (y <= H / 2 ? y : y - H) / H;
    for (let x = 0; x < W; x++) {
      const fx = (x <= W / 2 ? x : x - W) / W;
      const r = Math.hypot(fx, fy);
      const i = y * W + x;
      const j = ((H - y) % H) * W + ((W - x) % W); // 共轭对称点
      if (i >= j || r < 1 / 32 || r > 1 / 16) continue;
      if (mode === 'notch') { re[i] = 0; im[i] = 0; re[j] = 0; im[j] = 0; continue; }
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const phase = ((seed / 4294967296) * 2 - 1) * Math.PI;
      const mag = Math.hypot(re[i], im[i]);
      re[i] = mag * Math.cos(phase); im[i] = mag * Math.sin(phase);
      re[j] = re[i]; im[j] = -im[i];
    }
  }
  fft2d(re, im, W, H, true);
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      if (rgba[p + 3] === 0) continue;
      let edge = 0;
      if (x > 0) edge = Math.max(edge, Math.abs(gray[i] - gray[i - 1]));
      if (x + 1 < width) edge = Math.max(edge, Math.abs(gray[i] - gray[i + 1]));
      if (y > 0) edge = Math.max(edge, Math.abs(gray[i] - gray[i - width]));
      if (y + 1 < height) edge = Math.max(edge, Math.abs(gray[i] - gray[i + width]));
      const chroma = Math.max(rgba[p], rgba[p + 1], rgba[p + 2]) - Math.min(rgba[p], rgba[p + 1], rgba[p + 2]);
      const lim = limit === Infinity ? Infinity
        : edge >= 24 ? 0
        : chroma >= 12 ? (edge < 4 ? 0 : Math.min(2, limit))
        : limit;
      if (lim === 0) continue;
      const diff = re[y * W + x] - gray[i];
      const delta = lim === Infinity
        ? Math.min(255 - Math.max(rgba[p], rgba[p + 1], rgba[p + 2]), Math.max(-Math.min(rgba[p], rgba[p + 1], rgba[p + 2]), diff))
        : lim * Math.tanh(diff / lim);
      for (let c = 0; c < 3; c++) out[p + c] = Math.floor(Math.min(255, Math.max(0, rgba[p + c] + delta)) + 0.5);
    }
  }
  return out;
}

self.onmessage = (e) => {
  const { id, width, height, rgba, texture, textureWidth, textureHeight, strength } = e.data;
  try {
    self.postMessage({ id, stage: 'cleanup' });
    const cleaned = cleanup(new Uint8ClampedArray(rgba), width, height);
    self.postMessage({ id, stage: 'spectrum' });
    const filtered = spectrum(cleaned, width, height, Infinity, 'notch');
    self.postMessage({ id, stage: 'texture' });
    const result = {
      id, width, height,
      rgba: applyTexture(filtered, width, height, new Uint8ClampedArray(texture), textureWidth, textureHeight, strength).buffer,
    };
    self.postMessage(result, { transfer: [result.rgba] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
