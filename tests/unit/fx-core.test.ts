import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ImageBuffer } = require('../../contrib/sai2-fx-studio/core/image.js')
const { Session } = require('../../contrib/sai2-fx-studio/core/session.js')

function solid(w, h, r, g, b, a = 255) {
  const img = ImageBuffer.create(w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a
  }
  return img
}

describe('ImageBuffer', () => {
  it('像素读写与钳制', () => {
    const img = ImageBuffer.create(2, 2)
    img.setPixel(1, 1, 300, -5, 128, 255)
    expect(img.pixel(1, 1)).toEqual([255, 0, 128, 255])
  })

  it('clone 是深拷贝', () => {
    const a = solid(1, 1, 10, 20, 30)
    const b = a.clone()
    b.setPixel(0, 0, 1, 2, 3, 255)
    expect(a.pixel(0, 0)).toEqual([10, 20, 30, 255])
  })

  it('downsample 到最长边限制', () => {
    const img = solid(100, 50, 1, 2, 3)
    const small = img.downsample(10)
    expect(small.width).toBe(10)
    expect(small.height).toBe(5)
    expect(small.pixel(5, 2)).toEqual([1, 2, 3, 255])
  })

  it('padToCanvas 按偏移补边，透明背景', () => {
    const img = solid(2, 2, 255, 0, 0)
    const out = ImageBuffer.padToCanvas(img, 4, 4, 1, 1)
    expect(out.width).toBe(4)
    expect(out.pixel(0, 0)).toEqual([0, 0, 0, 0])
    expect(out.pixel(1, 1)).toEqual([255, 0, 0, 255])
    expect(out.pixel(3, 3)).toEqual([0, 0, 0, 0])
  })

  it('从 SAI2 文件头读精确画布尺寸', () => {
    const buf = new ArrayBuffer(28)
    const bytes = new Uint8Array(buf)
    Buffer.from('SAI-CANVAS-TYPE0').copy(Buffer.from(bytes.buffer), 4)
    const view = new DataView(buf)
    view.setUint32(20, 1920, true)
    view.setUint32(24, 1080, true)
    expect(ImageBuffer.sai2CanvasSize(bytes)).toEqual({ width: 1920, height: 1080 })
    expect(ImageBuffer.sai2CanvasSize(new Uint8Array(8))).toBeNull()
  })
})

describe('Session', () => {
  it('setImage 建立原图/结果/预览', () => {
    const s = new Session({ previewMaxDim: 8 })
    s.setImage(solid(40, 20, 10, 10, 10))
    expect(s.hasImage()).toBe(true)
    expect(s.fullBase().width).toBe(40)
    expect(s.previewBase().width).toBe(8)
    expect(s.scale()).toBeCloseTo(0.2)
  })

  it('apply 压入历史，undo 恢复，reset 回原图', () => {
    const s = new Session()
    const orig = solid(2, 2, 10, 10, 10)
    s.setImage(orig)
    s.apply(solid(2, 2, 99, 99, 99))
    expect(s.applied.pixel(0, 0)[0]).toBe(99)
    expect(s.canUndo()).toBe(true)
    expect(s.undo()).toBe(true)
    expect(s.applied.pixel(0, 0)[0]).toBe(10)
    s.apply(solid(2, 2, 50, 50, 50))
    s.reset()
    expect(s.applied.pixel(0, 0)[0]).toBe(10)
    expect(s.canUndo()).toBe(false)
  })

  it('参数与效果管理', () => {
    const s = new Session()
    s.setEffect('blur', { radius: 3 })
    expect(s.getParam('radius')).toBe(3)
    s.setParam('radius', 8)
    expect(s.getParam('radius')).toBe(8)
    expect(s.getParam('missing', 42)).toBe(42)
  })
})
