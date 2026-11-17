/**
 * 滤镜库（JS 移植，来源：上游 plugins/filter-gallery/src/Filters.h 等）。
 * 精选 10 个常用效果：锐化 / 浮雕 / 边缘 / 怀旧 / 冷色 / 暖色 / 高对比黑白 /
 * 柔光 / 像素化 / 马赛克。全部基于 RGBA8 点运算或小邻域卷积。
 */
'use strict'

const { ImageBuffer, clamp8 } = require('../core/image.js')

/** 卷积（3x3，alpha 不变） */
function convolve3(src, kernel, divisor = 1, bias = 0) {
  const { width: w, height: h, data } = src
  const out = new ImageBuffer(w, h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let acc = 0
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const sx = Math.min(w - 1, Math.max(0, x + kx))
            const sy = Math.min(h - 1, Math.max(0, y + ky))
            acc += data[(sy * w + sx) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)]
          }
        }
        out.data[(y * w + x) * 4 + c] = acc / divisor + bias
      }
      out.data[(y * w + x) * 4 + 3] = data[(y * w + x) * 4 + 3]
    }
  }
  return out
}

function sharpen(src, amount = 1) {
  const base = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0
  ]
  const k = base.map((v, i) => (i === 4 ? 1 + 4 * (amount - 1) : v * amount))
  return convolve3(src, k, 1, 0)
}

function emboss(src) {
  return convolve3(src, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 128)
}

function edge(src) {
  return convolve3(src, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0)
}

function sepia(src) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2]
    out.data[i] = clamp8(0.393 * r + 0.769 * g + 0.189 * b)
    out.data[i + 1] = clamp8(0.349 * r + 0.686 * g + 0.168 * b)
    out.data[i + 2] = clamp8(0.272 * r + 0.534 * g + 0.131 * b)
  }
  return out
}

function tint(src, kr, kg, kb) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = clamp8(out.data[i] * kr)
    out.data[i + 1] = clamp8(out.data[i + 1] * kg)
    out.data[i + 2] = clamp8(out.data[i + 2] * kb)
  }
  return out
}

function highContrastBW(src, threshold = 128) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    const g = 0.299 * out.data[i] + 0.587 * out.data[i + 1] + 0.114 * out.data[i + 2]
    const v = g >= threshold ? 255 : 0
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v
  }
  return out
}

function soften(src, amount = 0.5) {
  const blurred = convolve3(src, [1, 2, 1, 2, 4, 2, 1, 2, 1], 16, 0)
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out.data[i + c] = out.data[i + c] * (1 - amount) + blurred.data[i + c] * amount
    }
  }
  return out
}

/** 像素化：把图分成 block x block 的块，每块取中心色 */
function pixelate(src, block = 8) {
  const { width: w, height: h } = src
  const out = new ImageBuffer(w, h)
  const b = Math.max(1, Math.round(block))
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      const cx = Math.min(w - 1, bx + (b >> 1))
      const cy = Math.min(h - 1, by + (b >> 1))
      const color = src.pixel(cx, cy)
      for (let y = by; y < Math.min(h, by + b); y += 1) {
        for (let x = bx; x < Math.min(w, bx + b); x += 1) {
          out.setPixel(x, y, color[0], color[1], color[2], color[3])
        }
      }
    }
  }
  return out
}

/** 马赛克：与像素化类似但保留块内平均色 */
function mosaic(src, block = 8) {
  const { width: w, height: h } = src
  const out = new ImageBuffer(w, h)
  const b = Math.max(1, Math.round(block))
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      let r = 0, g = 0, bl = 0, a = 0, n = 0
      for (let y = by; y < Math.min(h, by + b); y += 1) {
        for (let x = bx; x < Math.min(w, bx + b); x += 1) {
          const p = src.pixel(x, y)
          r += p[0]; g += p[1]; bl += p[2]; a += p[3]; n += 1
        }
      }
      r /= n; g /= n; bl /= n; a /= n
      for (let y = by; y < Math.min(h, by + b); y += 1) {
        for (let x = bx; x < Math.min(w, bx + b); x += 1) out.setPixel(x, y, r, g, bl, a)
      }
    }
  }
  return out
}

const EFFECTS = [
  { id: 'sharpen', name: '锐化', fn: (s, p) => sharpen(s, p.amount ?? 1) },
  { id: 'emboss', name: '浮雕', fn: (s) => emboss(s) },
  { id: 'edge', name: '边缘', fn: (s) => edge(s) },
  { id: 'sepia', name: '怀旧', fn: (s) => sepia(s) },
  { id: 'cool', name: '冷色', fn: (s) => tint(s, 0.85, 0.95, 1.15) },
  { id: 'warm', name: '暖色', fn: (s) => tint(s, 1.15, 0.98, 0.8) },
  { id: 'bw', name: '高对比黑白', fn: (s, p) => highContrastBW(s, p.threshold ?? 128) },
  { id: 'soften', name: '柔光', fn: (s, p) => soften(s, p.amount ?? 0.5) },
  { id: 'pixelate', name: '像素化', fn: (s, p) => pixelate(s, p.block ?? 8) },
  { id: 'mosaic', name: '马赛克', fn: (s, p) => mosaic(s, p.block ?? 8) }
]

function apply(src, id, params = {}) {
  const effect = EFFECTS.find((e) => e.id === id)
  return effect ? effect.fn(src, params) : src.clone()
}

module.exports = {
  EFFECTS, apply, sharpen, emboss, edge, sepia, tint, highContrastBW, soften, pixelate, mosaic, convolve3
}
