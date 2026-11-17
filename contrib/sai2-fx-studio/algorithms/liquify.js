/**
 * 液化（JS 移植，来源：上游 plugins/liquify/src/LiquifyCore.h / LiquifySession.h）。
 *
 * 核心思路（对齐她"置换场累积、不重放笔画"的设计）：
 *  - 维护一个与图同尺寸的 float 位移场 field[w*h*2]（dx, dy）；
 *  - 每一笔在笔刷范围内累加位移（向前变形按鼠标移动方向，膨胀/收缩按径向）；
 *  - 渲染时按位移场**反向采样**原图，一次性出结果，从不重放笔画。
 *
 * 大画布性能：位移场全分辨率会占 w*h*8 字节（5000² 约 200MB），
 * 预览阶段用降采样图跑（由 Session 提供），提交时在全分辨率重放同批次笔画几何。
 */
'use strict'

const { ImageBuffer, clamp8 } = require('../core/image.js')

class LiquifySession {
  constructor(width, height) {
    this.width = width
    this.height = height
    // 位移场：每像素 2 个 float32（dx, dy）
    this.field = new Float32Array(width * height * 2)
    this.strokeCount = 0
  }

  /** 向前变形：从 (fromX,fromY) 到 (toX,toY) 的笔刷涂抹 */
  forward(fromX, fromY, toX, toY, radius, strength = 1) {
    const dx = toX - fromX
    const dy = toY - fromY
    this._stamp(toX, toY, radius, (px, py, falloff) => {
      this._add(px, py, dx * strength * falloff, dy * strength * falloff)
    })
    this.strokeCount += 1
  }

  /** 膨胀（正）/ 收缩（负）：沿径向推移 */
  inflate(cx, cy, radius, amount = 1) {
    this._stamp(cx, cy, radius, (px, py, falloff) => {
      const vx = px - cx
      const vy = py - cy
      const len = Math.hypot(vx, vy) || 1
      this._add(px, py, (vx / len) * amount * falloff, (vy / len) * amount * falloff)
    })
    this.strokeCount += 1
  }

  /** 平滑：对位移场做一次局部平均（软化已有形变） */
  smooth(cx, cy, radius, amount = 1) {
    const copy = new Float32Array(this.field)
    this._stamp(cx, cy, radius, (px, py, falloff) => {
      let sx = 0, sy = 0, n = 0
      const r = 2
      for (let y = py - r; y <= py + r; y += 1) {
        for (let x = px - r; x <= px + r; x += 1) {
          if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue
          const i = (y * this.width + x) * 2
          sx += copy[i]; sy += copy[i + 1]; n += 1
        }
      }
      if (!n) return
      const i = (py * this.width + px) * 2
      this.field[i] += (sx / n - this.field[i]) * amount * falloff
      this.field[i + 1] += (sy / n - this.field[i + 1]) * amount * falloff
    })
    this.strokeCount += 1
  }

  /** 旋转（顺时针） */
  swirl(cx, cy, radius, angle = 0.5) {
    this._stamp(cx, cy, radius, (px, py, falloff) => {
      const vx = px - cx
      const vy = py - cy
      const a = angle * falloff
      const nx = vx * Math.cos(a) - vy * Math.sin(a)
      const ny = vx * Math.sin(a) + vy * Math.cos(a)
      this._add(px, py, nx - vx, ny - vy)
    })
    this.strokeCount += 1
  }

  _add(px, py, dx, dy) {
    const i = (py * this.width + px) * 2
    this.field[i] += dx
    this.field[i + 1] += dy
  }

  /** 遍历笔刷圆内的像素，falloff 为平滑衰减 1→0 */
  _stamp(cx, cy, radius, fn) {
    const r = Math.max(1, Math.round(radius))
    const x0 = Math.max(0, Math.floor(cx - r))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r))
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy)
        if (d > r) continue
        const t = 1 - d / r
        const falloff = t * t * (3 - 2 * t) // smoothstep
        fn(x, y, falloff)
      }
    }
  }

  /** 按位移场反向采样，渲染结果 */
  render(src) {
    if (src.width !== this.width || src.height !== this.height) {
      // 预览图与位移场尺寸不一致时，按比例缩放坐标采样
      return this._renderScaled(src)
    }
    const out = new ImageBuffer(this.width, this.height)
    const { data } = src
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const i = (y * this.width + x) * 2
        const sx = Math.min(this.width - 1, Math.max(0, Math.round(x - this.field[i])))
        const sy = Math.min(this.height - 1, Math.max(0, Math.round(y - this.field[i + 1])))
        const si = (sy * this.width + sx) * 4
        const di = (y * this.width + x) * 4
        out.data[di] = data[si]
        out.data[di + 1] = data[si + 1]
        out.data[di + 2] = data[si + 2]
        out.data[di + 3] = data[si + 3]
      }
    }
    return out
  }

  /** 位移场是全分辨率的，src 是降采样预览图 → 按比例缩放位移坐标 */
  _renderScaled(src) {
    const scaleX = src.width / this.width
    const scaleY = src.height / this.height
    const out = new ImageBuffer(src.width, src.height)
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const fx = Math.min(this.width - 1, Math.max(0, Math.round(x / scaleX)))
        const fy = Math.min(this.height - 1, Math.max(0, Math.round(y / scaleY)))
        const i = (fy * this.width + fx) * 2
        const sx = Math.min(src.width - 1, Math.max(0, Math.round(x - this.field[i] * scaleX)))
        const sy = Math.min(src.height - 1, Math.max(0, Math.round(y - this.field[i + 1] * scaleY)))
        const si = (sy * src.width + sx) * 4
        const di = (y * src.width + x) * 4
        out.data[di] = src.data[si]
        out.data[di + 1] = src.data[si + 1]
        out.data[di + 2] = src.data[si + 2]
        out.data[di + 3] = src.data[si + 3]
      }
    }
    return out
  }

  reset() {
    this.field.fill(0)
    this.strokeCount = 0
  }

  /** 按倍率缩放位移场（预览尺寸 ↔ 全分辨率之间切换时用） */
  static rescale(field, fromW, fromH, toW, toH) {
    const out = new Float32Array(toW * toH * 2)
    const sx = toW / fromW
    const sy = toH / fromH
    for (let y = 0; y < toH; y += 1) {
      for (let x = 0; x < toW; x += 1) {
        const fx = Math.min(fromW - 1, Math.round(x / sx))
        const fy = Math.min(fromH - 1, Math.round(y / sy))
        const si = (fy * fromW + fx) * 2
        const di = (y * toW + x) * 2
        out[di] = field[si] * sx
        out[di + 1] = field[si + 1] * sy
      }
    }
    return out
  }
}

module.exports = { LiquifySession }
