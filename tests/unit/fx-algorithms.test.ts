import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ImageBuffer } = require('../../contrib/sai2-fx-studio/core/image.js')
const blur = require('../../contrib/sai2-fx-studio/algorithms/blur.js')
const adjust = require('../../contrib/sai2-fx-studio/algorithms/adjust.js')

function solid(w, h, r, g, b) {
  const img = ImageBuffer.create(w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
  }
  return img
}

describe('blur 算法', () => {
  it('半径 0 返回原样克隆', () => {
    const a = solid(4, 4, 100, 100, 100)
    const b = blur.boxBlur(a, 0)
    expect(b.pixel(0, 0)).toEqual([100, 100, 100, 255])
    expect(b).not.toBe(a)
  })

  it('盒式模糊保持纯色不变', () => {
    const out = blur.boxBlur(solid(8, 8, 77, 80, 90), 2)
    expect(out.pixel(4, 4)).toEqual([77, 80, 90, 255])
  })

  it('高斯核对中心加权更大', () => {
    const k = blur.gaussianKernel(2, 1)
    expect(k).toHaveLength(5)
    expect(k[2]).toBeGreaterThan(k[0])
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })

  it('运动模糊不越界、尺寸不变', () => {
    const out = blur.motionBlur(solid(6, 6, 120, 30, 40), 3, 45)
    expect(out.width).toBe(6)
    expect(out.pixel(0, 0)[0]).toBe(120)
  })

  it('统一入口按 type 分派', () => {
    expect(blur.blur(solid(4, 4, 10, 20, 30), 'box', { radius: 1 }).width).toBe(4)
    expect(blur.blur(solid(4, 4, 10, 20, 30), 'unknown').pixel(0, 0)).toEqual([10, 20, 30, 255])
  })
})

describe('adjust 算法', () => {
  it('反相', () => {
    const out = adjust.invert(solid(2, 2, 10, 200, 255))
    expect(out.pixel(0, 0)).toEqual([245, 55, 0, 255])
  })

  it('去色用亮度加权', () => {
    const out = adjust.grayscale(solid(1, 1, 255, 0, 0))
    const g = Math.round(0.299 * 255)
    expect(out.pixel(0, 0)).toEqual([g, g, g, 255])
  })

  it('亮度对比度提升亮度', () => {
    const out = adjust.brightnessContrast(solid(1, 1, 100, 100, 100), 30, 0)
    expect(out.pixel(0, 0)[0]).toBe(130)
  })

  it('色阶白场映射', () => {
    const out = adjust.levels(solid(1, 1, 128, 128, 128), 0, 255, 1)
    expect(out.pixel(0, 0)[0]).toBe(128)
  })

  it('HSV 往返', () => {
    const [h, s, v] = adjust.rgbToHsv(255, 0, 0)
    expect(h).toBe(0)
    expect(s).toBe(1)
    expect(v).toBe(1)
    const rgb = adjust.hsvToRgb(h, s, v)
    expect(rgb[0]).toBeCloseTo(255, 0)
    expect(rgb[1]).toBeCloseTo(0, 0)
  })

  it('选区 mask 只改选中像素', () => {
    const img = solid(2, 1, 100, 100, 100)
    const mask = new Uint8Array([1, 0])
    const out = adjust.invert(img, mask)
    expect(out.pixel(0, 0)[0]).toBe(155)
    expect(out.pixel(1, 0)[0]).toBe(100)
  })
})
