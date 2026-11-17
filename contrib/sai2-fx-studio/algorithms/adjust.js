/**
 * 调整算法（JS 移植，来源：上游 plugins/adjust/src/AdjustKernels.h）。
 * 反相 / 去色 / 亮度对比度 / 色相饱和度 / 色阶。
 * 全部是逐像素点运算，支持选区（mask 可选）。
 */
'use strict'

const { ImageBuffer, clamp8 } = require('../core/image.js')

function invert(src, mask) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    out.data[i] = 255 - out.data[i]
    out.data[i + 1] = 255 - out.data[i + 1]
    out.data[i + 2] = 255 - out.data[i + 2]
  }
  return out
}

function grayscale(src, mask) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    const g = Math.round(0.299 * out.data[i] + 0.587 * out.data[i + 1] + 0.114 * out.data[i + 2])
    out.data[i] = out.data[i + 1] = out.data[i + 2] = g
  }
  return out
}

/** brightness: -255..255；contrast: -100..100 */
function brightnessContrast(src, brightness = 0, contrast = 0, mask) {
  const out = src.clone()
  const c = (259 * (contrast + 255)) / (255 * (259 - contrast))
  for (let i = 0; i < out.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    for (let k = 0; k < 3; k += 1) {
      out.data[i + k] = clamp8(c * (out.data[i + k] - 128) + 128 + brightness)
    }
  }
  return out
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** hue: -180..180 度；sat/light 为倍率 0..2 */
function hueSaturation(src, hue = 0, sat = 1, light = 1, mask) {
  const out = src.clone()
  for (let i = 0; i < out.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    const [h, s, v] = rgbToHsv(out.data[i], out.data[i + 1], out.data[i + 2])
    const rgb = hsvToRgb((h + hue + 360) % 360, Math.max(0, Math.min(1, s * sat)), Math.max(0, Math.min(1, v * light)))
    out.data[i] = clamp8(rgb[0])
    out.data[i + 1] = clamp8(rgb[1])
    out.data[i + 2] = clamp8(rgb[2])
  }
  return out
}

/** 色阶：black/white 为 0..255，gamma 约 0.1..10 */
function levels(src, black = 0, white = 255, gamma = 1, mask) {
  const out = src.clone()
  const span = Math.max(1, white - black)
  const invGamma = 1 / Math.max(0.01, gamma)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v += 1) {
    const t = Math.max(0, Math.min(1, (v - black) / span))
    lut[v] = clamp8(Math.pow(t, invGamma) * 255)
  }
  for (let i = 0; i < out.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    for (let k = 0; k < 3; k += 1) out.data[i + k] = lut[out.data[i + k]]
  }
  return out
}

function apply(src, effect, params = {}) {
  switch (effect) {
    case 'invert': return invert(src, params.mask)
    case 'grayscale': return grayscale(src, params.mask)
    case 'brightnessContrast': return brightnessContrast(src, params.brightness ?? 0, params.contrast ?? 0, params.mask)
    case 'hueSaturation': return hueSaturation(src, params.hue ?? 0, params.saturation ?? 1, params.lightness ?? 1, params.mask)
    case 'levels': return levels(src, params.black ?? 0, params.white ?? 255, params.gamma ?? 1, params.mask)
    default: return src.clone()
  }
}

module.exports = {
  apply, invert, grayscale, brightnessContrast, hueSaturation, levels,
  rgbToHsv, hsvToRgb
}
