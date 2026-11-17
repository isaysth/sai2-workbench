import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ImageBuffer } = require('../../contrib/sai2-fx-studio/core/image.js')
const filters = require('../../contrib/sai2-fx-studio/algorithms/filters.js')
const { LiquifySession } = require('../../contrib/sai2-fx-studio/algorithms/liquify.js')

/** 造一张左黑右白的测试图 */
function half() {
  const img = ImageBuffer.create(16, 8)
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const v = x < 8 ? 0 : 255
      img.setPixel(x, y, v, v, v, 255)
    }
  }
  return img
}

describe('filters 滤镜库', () => {
  it('注册了 10 个效果', () => {
    expect(filters.EFFECTS).toHaveLength(10)
    expect(filters.EFFECTS.map((e) => e.id)).toContain('sharpen')
  })

  it('锐化保持尺寸，纯色区域不被改坏', () => {
    const out = filters.apply(half(), 'sharpen')
    expect(out.width).toBe(16)
    expect(out.pixel(2, 4)[0]).toBe(0)
  })

  it('怀旧色调改变颜色', () => {
    const img = ImageBuffer.create(1, 1)
    img.setPixel(0, 0, 100, 150, 200, 255)
    const out = filters.apply(img, 'sepia')
    expect(out.pixel(0, 0)[0]).not.toBe(100)
  })

  it('黑白阈值', () => {
    const out = filters.apply(half(), 'bw', { threshold: 128 })
    expect(out.pixel(2, 4)[0]).toBe(0)
    expect(out.pixel(12, 4)[0]).toBe(255)
  })

  it('像素化按块取色，尺寸不变', () => {
    const out = filters.apply(half(), 'pixelate', { block: 4 })
    expect(out.width).toBe(16)
    expect(out.height).toBe(8)
    expect(out.pixel(0, 0)[0]).toBe(0)
    expect(out.pixel(15, 7)[0]).toBe(255)
  })

  it('未知效果原样返回', () => {
    const img = half()
    const out = filters.apply(img, 'nonexistent')
    expect(out.pixel(0, 0)).toEqual(img.pixel(0, 0))
  })
})

describe('LiquifySession 液化', () => {
  it('初始位移场为零，render 原样', () => {
    const s = new LiquifySession(16, 8)
    const out = s.render(half())
    expect(out.pixel(4, 4)).toEqual([0, 0, 0, 255])
    expect(out.pixel(12, 4)).toEqual([255, 255, 255, 255])
  })

  it('向前变形推动边界，产生位移', () => {
    const s = new LiquifySession(16, 8)
    // 把边界附近的黑色往右推
    s.forward(7, 4, 10, 4, 4, 1)
    expect(s.strokeCount).toBe(1)
    const out = s.render(half())
    // 边界被推移，某些原本黑的位置变白或反之
    let changed = 0
    for (let x = 0; x < 16; x += 1) if (out.pixel(x, 4)[0] !== (x < 8 ? 0 : 255)) changed += 1
    expect(changed).toBeGreaterThan(0)
  })

  it('膨胀改变局部位移场，reset 归零', () => {
    const s = new LiquifySession(16, 8)
    s.inflate(8, 4, 3, 2)
    const before = s.render(half())
    s.reset()
    const after = s.render(half())
    expect(s.strokeCount).toBe(0)
    // reset 后应回到原图
    expect(after.pixel(0, 0)).toEqual([0, 0, 0, 255])
    expect(before.width).toBe(16)
  })

  it('位移场缩放保持数量级', () => {
    const s = new LiquifySession(100, 100)
    s.forward(50, 50, 60, 50, 20, 1)
    const scaled = LiquifySession.rescale(s.field, 100, 100, 50, 50)
    expect(scaled).toHaveLength(50 * 50 * 2)
    expect(scaled.some((v) => Math.abs(v) > 0.01)).toBe(true)
  })
})
