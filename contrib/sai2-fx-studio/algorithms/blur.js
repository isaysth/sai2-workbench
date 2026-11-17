/**
 * 模糊算法（JS 移植，来源：上游 plugins/blur/src/BlurKernels.h）。
 * 4 种：box（盒式）/ gaussian（高斯）/ motion（运动）/ zoom（缩放模糊）。
 * 用可分离卷积做 box/gaussian，保证大半径也不卡。
 */
'use strict'

const { ImageBuffer, clamp8 } = require('../core/image.js')

/** 盒式模糊：分离式滑动窗口，O(n) 与半径无关 */
function boxBlur(src, radius) {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return src.clone()
  const { width: w, height: h, data } = src
  const tmp = new Uint8ClampedArray(data.length)
  const out = new Uint8ClampedArray(data.length)
  const win = r * 2 + 1

  // 水平
  for (let y = 0; y < h; y += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0
      for (let k = -r; k <= r; k += 1) sum += data[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c]
      for (let x = 0; x < w; x += 1) {
        tmp[(y * w + x) * 4 + c] = sum / win
        const outX = Math.max(0, x - r)
        const inX = Math.min(w - 1, x + r + 1)
        sum += data[(y * w + inX) * 4 + c] - data[(y * w + outX) * 4 + c]
      }
    }
  }
  // 垂直
  for (let x = 0; x < w; x += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0
      for (let k = -r; k <= r; k += 1) sum += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + c]
      for (let y = 0; y < h; y += 1) {
        out[(y * w + x) * 4 + c] = sum / win
        const outY = Math.max(0, y - r)
        const inY = Math.min(h - 1, y + r + 1)
        sum += tmp[(inY * w + x) * 4 + c] - tmp[(outY * w + x) * 4 + c]
      }
    }
  }
  return new ImageBuffer(w, h, out)
}

/** 高斯核（一维，归一化） */
function gaussianKernel(radius, sigma) {
  const r = Math.max(1, Math.round(radius))
  const s = sigma || Math.max(0.5, r / 2)
  const k = []
  let sum = 0
  for (let i = -r; i <= r; i += 1) {
    const v = Math.exp(-(i * i) / (2 * s * s))
    k.push(v)
    sum += v
  }
  return k.map((v) => v / sum)
}

/** 高斯模糊：分离式卷积 */
function gaussianBlur(src, radius, sigma) {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return src.clone()
  const { width: w, height: h, data } = src
  const kernel = gaussianKernel(r, sigma)
  const tmp = new Uint8ClampedArray(data.length)
  const out = new Uint8ClampedArray(data.length)

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let acc = 0
        for (let i = -r; i <= r; i += 1) {
          const sx = Math.min(w - 1, Math.max(0, x + i))
          acc += data[(y * w + sx) * 4 + c] * kernel[i + r]
        }
        tmp[(y * w + x) * 4 + c] = acc
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let acc = 0
        for (let i = -r; i <= r; i += 1) {
          const sy = Math.min(h - 1, Math.max(0, y + i))
          acc += tmp[(sy * w + x) * 4 + c] * kernel[i + r]
        }
        out[(y * w + x) * 4 + c] = acc
      }
    }
  }
  return new ImageBuffer(w, h, out)
}

/** 运动模糊：沿方向多次采样平均 */
function motionBlur(src, distance, angleDeg) {
  const d = Math.max(0, Math.round(distance))
  if (d === 0) return src.clone()
  const { width: w, height: h, data } = src
  const out = new Uint8ClampedArray(data.length)
  const a = (angleDeg * Math.PI) / 180
  const dx = (Math.cos(a) * d) / Math.max(1, d)
  const dy = (Math.sin(a) * d) / Math.max(1, d)
  const samples = d * 2 + 1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let acc = 0
        for (let s = 0; s < samples; s += 1) {
          const t = s - d
          const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx * t)))
          const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy * t)))
          acc += data[(sy * w + sx) * 4 + c]
        }
        out[(y * w + x) * 4 + c] = acc / samples
      }
    }
  }
  return new ImageBuffer(w, h, out)
}

/** 缩放模糊：从中心向外放射采样 */
function zoomBlur(src, strength, centerX, centerY) {
  const z = Math.max(0, Math.min(1, strength))
  if (z === 0) return src.clone()
  const { width: w, height: h, data } = src
  const out = new Uint8ClampedArray(data.length)
  const cx = centerX == null ? w / 2 : centerX
  const cy = centerY == null ? h / 2 : centerY
  const samples = 16
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let acc = 0
        for (let s = 0; s < samples; s += 1) {
          const t = 1 - (z * s) / samples
          const sx = Math.min(w - 1, Math.max(0, Math.round(cx + (x - cx) * t)))
          const sy = Math.min(h - 1, Math.max(0, Math.round(cy + (y - cy) * t)))
          acc += data[(sy * w + sx) * 4 + c]
        }
        out[(y * w + x) * 4 + c] = acc / samples
      }
    }
  }
  return new ImageBuffer(w, h, out)
}

/** 统一入口：type ∈ box|gaussian|motion|zoom */
function blur(src, type, params = {}) {
  switch (type) {
    case 'box': return boxBlur(src, params.radius ?? 3)
    case 'motion': return motionBlur(src, params.distance ?? 5, params.angle ?? 0)
    case 'zoom': return zoomBlur(src, params.strength ?? 0.3, params.centerX, params.centerY)
    case 'gaussian':
    default: return gaussianBlur(src, params.radius ?? 3, params.sigma)
  }
}

module.exports = { blur, boxBlur, gaussianBlur, motionBlur, zoomBlur, gaussianKernel, clamp8 }
