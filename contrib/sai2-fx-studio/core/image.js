/**
 * RGBA8 图像模型（JS 版，对应上游 sdk/src/ImageBuffer.cpp）。
 *
 * 内存布局紧凑无行填充：stride = width*4，通道 0..255，RGBA 顺序。
 * 上游用 RGBA16，但我们从剪贴板 CF_DIBV5 拿到的是 8bit，直接按 RGBA8 处理。
 * 所有算法（blur/adjust/filter/liquify）都基于这个模型。
 */
'use strict'

/** 8bit 通道钳制 */
function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0
}

class ImageBuffer {
  constructor(width, height, data) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`非法画布尺寸：${width}x${height}`)
    }
    this.width = width
    this.height = height
    this.data = data instanceof Uint8ClampedArray
      ? data
      : new Uint8ClampedArray(width * height * 4)
  }

  static create(width, height) {
    return new ImageBuffer(width, height)
  }

  /** 从 RGBA Uint8Array / Buffer 构造（拷贝） */
  static fromRGBA(width, height, rgba) {
    if (rgba.length !== width * height * 4) {
      throw new Error(`像素数据长度不符：期望 ${width * height * 4}，实际 ${rgba.length}`)
    }
    return new ImageBuffer(width, height, new Uint8ClampedArray(rgba))
  }

  clone() {
    return new ImageBuffer(this.width, this.height, new Uint8ClampedArray(this.data))
  }

  /** 取像素，返回 [r,g,b,a] */
  pixel(x, y) {
    const i = (y * this.width + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }

  setPixel(x, y, r, g, b, a) {
    const i = (y * this.width + x) * 4
    this.data[i] = clamp8(r)
    this.data[i + 1] = clamp8(g)
    this.data[i + 2] = clamp8(b)
    this.data[i + 3] = clamp8(a)
  }

  /** 区域有效判断 */
  contains(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /**
   * 最近邻降采样到最长边 <= maxDim（对应 SDK 的 BeginPreview）。
   * 返回新图；若已满足条件则克隆。
   */
  downsample(maxDim) {
    if (maxDim <= 0 || (this.width <= maxDim && this.height <= maxDim)) return this.clone()
    const scale = maxDim / Math.max(this.width, this.height)
    const w = Math.max(1, Math.round(this.width * scale))
    const h = Math.max(1, Math.round(this.height * scale))
    const out = new ImageBuffer(w, h)
    for (let y = 0; y < h; y += 1) {
      const sy = Math.min(this.height - 1, Math.floor(y / scale))
      for (let x = 0; x < w; x += 1) {
        const sx = Math.min(this.width - 1, Math.floor(x / scale))
        const si = (sy * this.width + sx) * 4
        const di = (y * w + x) * 4
        out.data[di] = this.data[si]
        out.data[di + 1] = this.data[si + 1]
        out.data[di + 2] = this.data[si + 2]
        out.data[di + 3] = this.data[si + 3]
      }
    }
    return out
  }

  /**
   * 把 image 按 offset 补边到 canvasW x canvasH（对应 BridgeCore::PadToCanvas）。
   * 透明背景（全 0）；image 放在 (offsetX, offsetY)。
   */
  static padToCanvas(image, canvasW, canvasH, offsetX, offsetY) {
    const out = new ImageBuffer(canvasW, canvasH)
    for (let y = 0; y < image.height; y += 1) {
      const dy = y + offsetY
      if (dy < 0 || dy >= canvasH) continue
      for (let x = 0; x < image.width; x += 1) {
        const dx = x + offsetX
        if (dx < 0 || dx >= canvasW) continue
        const si = (y * image.width + x) * 4
        const di = (dy * canvasW + dx) * 4
        out.data[di] = image.data[si]
        out.data[di + 1] = image.data[si + 1]
        out.data[di + 2] = image.data[si + 2]
        out.data[di + 3] = image.data[si + 3]
      }
    }
    return out
  }

  /**
   * 读 SAI2 画布精确尺寸：文件头 magic 'SAI-CANVAS-TYPE0'（offset 4），
   * offset 20/24 是 uint32 LE 的宽高（上游 10.6.4 的 RE 成果）。
   * 返回 {width,height} 或 null（非 sai2 文件/未保存文档）。
   */
  static sai2CanvasSize(bytes) {
    if (!bytes || bytes.length < 28) return null
    const magic = Buffer.from(bytes.slice(4, 20)).toString('latin1')
    if (!magic.startsWith('SAI-CANVAS-TYPE0')) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(20, true)
    const height = view.getUint32(24, true)
    if (width <= 0 || height <= 0 || width > 100000 || height > 100000) return null
    return { width, height }
  }
}

module.exports = { ImageBuffer, clamp8 }
