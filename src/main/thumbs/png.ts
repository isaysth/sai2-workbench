import { deflateSync } from 'node:zlib'

/**
 * 极简 PNG 编码器 + 降采样。
 *
 * 为什么不引 node-canvas / sharp：两者都是原生模块，会让免安装包从 ~80MB 涨到 150MB+，
 * 还得为每个 Electron ABI 重新编译，Win7 兼容性也差。我们需要的能力只有两件事：
 * 把 RGBA 缓冲压成 PNG、把大图缩成小图。手写两百行就够，还零依赖。
 *
 * PNG 结构（每个块都是 长度(4) + 类型(4) + 数据 + CRC32(4)）：
 *   IHDR 宽高/位深/颜色类型
 *   IDAT zlib 压缩后的扫描行（每行前有 1 字节过滤类型）
 *   IEND 结束
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8)
  const crc = crc32(out, 4, 8 + data.length)
  out.writeUInt32BE(crc, 8 + data.length)
  return out
}

/**
 * RGBA → PNG。`alpha` 为 false 时写成 RGB（少 25% 体积，照片类省得明显）。
 */
export function encodePng(width: number, height: number, rgba: Uint8Array, alpha = true): Buffer {
  const channels = alpha ? 4 : 3
  const stride = width * channels
  // 每行 1 字节过滤类型（0 = None）+ 像素数据
  const raw = Buffer.allocUnsafe((stride + 1) * height)

  let src = 0
  let dst = 0
  for (let y = 0; y < height; y++) {
    raw[dst++] = 0
    if (alpha) {
      raw.set(rgba.subarray(src, src + stride), dst)
      src += stride
      dst += stride
    } else {
      for (let x = 0; x < width; x++) {
        raw[dst++] = rgba[src]!
        raw[dst++] = rgba[src + 1]!
        raw[dst++] = rgba[src + 2]!
        src += 4
      }
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = alpha ? 6 : 2 // 6 = RGBA, 2 = RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  const idat = deflateSync(raw, { level: 6 })

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0))
  ])
}

/**
 * 检测 PNG 是否真带 alpha：读 IHDR 的颜色类型（第 25 字节）。
 * 6 = RGBA / 4 = 灰度+alpha。只看后缀不行 —— 大部分 PNG 截图其实是 RGB，
 * 当成有 alpha 处理会让体积翻三倍。
 */
export function pngHasAlpha(head: Uint8Array): boolean {
  if (head.length < 26) return true
  if (head[0] !== 0x89 || head[1] !== 0x50) return true
  const colorType = head[25]!
  return colorType === 6 || colorType === 4
}

/**
 * 箱式滤波降采样（RGBA）。
 *
 * 用**预乘 alpha**再平均：直接平均 RGBA 会让透明像素的黑色渗进边缘，
 * 缩出来的图一圈发黑（"毛边"），这在贴图/线稿上特别明显。
 */
export function downscaleRgba(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): { data: Uint8Array; opaque: boolean } {
  const out = new Uint8Array(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  let opaque = true

  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        let idx = (sy * sw + x0) * 4
        for (let sx = x0; sx < x1; sx++) {
          const alpha = src[idx + 3]!
          r += src[idx]! * alpha
          g += src[idx + 1]! * alpha
          b += src[idx + 2]! * alpha
          a += alpha
          idx += 4
          count++
        }
      }

      const o = (y * dw + x) * 4
      if (a === 0 || count === 0) {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 0
        opaque = false
      } else {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        const alphaAvg = Math.round(a / count)
        out[o + 3] = alphaAvg
        if (alphaAvg < 255) opaque = false
      }
    }
  }
  return { data: out, opaque }
}
