/**
 * CF_DIBV5 编解码（JS 版，对应上游 tools/bridge/ClipboardImage.cpp）。
 *
 * 她的实测结论（docs/SAI2Injection.md §八之二）：
 *  - SAI2 只认 CF_DIBV5，且必须模仿 GDI 布局：124 字节 BITMAPV5HEADER
 *    + 12 字节掩码（RGB 掩码 + alpha 掩码）+ 像素；
 *  - 数据起点 136；alphaMask = 0xFF000000；cstype = 0；压缩 = BI_BITFIELDS(3)；
 *  - **绝不能同时写 CF_DIB**（无 alpha 语义，SAI2 优先读它 → 粘贴背景变黑）。
 *
 * 这里只做纯字节编解码（可单测）；真正的系统剪贴板读写在 clipboard-win.js
 * 用 PowerShell/.NET 完成。
 */
'use strict'

const { ImageBuffer, clamp8 } = require('../core/image.js')

const HEADER_SIZE = 124
const MASKS_SIZE = 12
const PIXEL_OFFSET = HEADER_SIZE + MASKS_SIZE // 136
const BI_BITFIELDS = 3

function writeU32(buf, off, v) { buf.writeUInt32LE(v >>> 0, off) }
function writeI32(buf, off, v) { buf.writeInt32LE(v | 0, off) }

/**
 * RGBA8 ImageBuffer → CF_DIBV5 Buffer（BGRA 底朝上 + 124 头 + 12 掩码）。
 * SAI2 的 DIBV5 是 32bpp BI_BITFIELDS：R=0x00FF0000 G=0x0000FF00
 * B=0x000000FF A=0xFF000000。
 */
function encodeDIBV5(image) {
  const { width, height, data } = image
  const rowBytes = width * 4
  const stride = rowBytes // 32bpp，天然 4 字节对齐
  const total = PIXEL_OFFSET + stride * height
  const buf = Buffer.alloc(total)

  // BITMAPV5HEADER（124 字节）
  writeU32(buf, 0, HEADER_SIZE)         // bV5Size
  writeI32(buf, 4, width)               // bV5Width
  // 正高度 = bottom-up（GDI 标准）；像素行序按从底到顶写，见下方像素循环
  writeI32(buf, 8, height)              // bV5Height（bottom-up）
  buf.writeUInt16LE(1, 12)              // bV5Planes
  buf.writeUInt16LE(32, 14)             // bV5BitCount
  writeU32(buf, 16, BI_BITFIELDS)       // bV5Compression
  writeU32(buf, 20, stride * height)    // bV5SizeImage
  writeI32(buf, 24, 0)                  // bV5XPelsPerMeter
  writeI32(buf, 28, 0)                  // bV5YPelsPerMeter
  writeU32(buf, 32, 0)                  // bV5ClrUsed
  writeU32(buf, 36, 0)                  // bV5ClrImportant
  writeU32(buf, 40, 0x00FF0000)         // bV5RedMask
  writeU32(buf, 44, 0x0000FF00)         // bV5GreenMask
  writeU32(buf, 48, 0x000000FF)         // bV5BlueMask
  writeU32(buf, 52, 0xFF000000)         // bV5AlphaMask
  writeU32(buf, 56, 0)                  // bV5CSType = LCS_CALIBRATED_RGB(0)
  // 56..124 的端点与 gamma 全 0（她的实测 SAI2 自产 DIBV5 就是这样）
  writeU32(buf, 108, 0)                 // bV5Intent
  writeU32(buf, 112, 0)                 // bV5ProfileData
  writeU32(buf, 116, 0)                 // bV5ProfileSize
  writeU32(buf, 120, 0)                 // bV5Reserved

  // 掩码写在 124..136（BI_BITFIELDS 在 V5 里已含于头，但 SAI2 的布局仍带 12 字节）
  writeU32(buf, 124, 0x00FF0000)
  writeU32(buf, 128, 0x0000FF00)
  writeU32(buf, 132, 0x000000FF)

  // 像素：BGRA，bottom-up（DIB 第一行是图像最底行）
  for (let y = 0; y < height; y += 1) {
    const dy = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4
      const di = PIXEL_OFFSET + (dy * width + x) * 4
      buf[di] = data[si + 2]      // B
      buf[di + 1] = data[si + 1]  // G
      buf[di + 2] = data[si]      // R
      buf[di + 3] = data[si + 3]  // A
    }
  }
  return buf
}

/** 读 CF_DIBV5 Buffer → RGBA8 ImageBuffer */
function decodeDIBV5(buf) {
  if (!buf || buf.length < PIXEL_OFFSET) return null
  const headerSize = buf.readUInt32LE(0)
  if (headerSize !== HEADER_SIZE) return null
  let width = buf.readInt32LE(4)
  let height = buf.readInt32LE(8)
  const bitCount = buf.readUInt16LE(14)
  const topDown = height < 0
  height = Math.abs(height)
  if (width <= 0 || height <= 0 || width > 50000 || height > 50000) return null
  if (bitCount !== 32 && bitCount !== 24) return null

  // 掩码位置：V5 头内置（40/44/48），也可能在 124..136
  let rMask = buf.readUInt32LE(40) || buf.readUInt32LE(124)
  let gMask = buf.readUInt32LE(44) || buf.readUInt32LE(128)
  let bMask = buf.readUInt32LE(48) || buf.readUInt32LE(132)
  let aMask = buf.readUInt32LE(52)
  if (!rMask || !gMask || !bMask) {
    // 缺省按 BGRA 布局
    rMask = 0x00FF0000; gMask = 0x0000FF00; bMask = 0x000000FF; aMask = 0xFF000000
  }

  const bpp = bitCount / 8
  // 数据起点：V5 头 124；若压缩=BITFIELDS 且掩码外置，加 12
  let offset = headerSize
  const compression = buf.readUInt32LE(16)
  if (compression === BI_BITFIELDS && buf.readUInt32LE(124)) offset += MASKS_SIZE
  const stride = Math.floor((width * bitCount + 31) / 32) * 4

  const img = new ImageBuffer(width, height)
  const shift = (mask) => {
    let s = 0
    while (mask && !(mask & 1)) { mask >>>= 1; s += 1 }
    return s
  }
  const rs = shift(rMask), gs = shift(gMask), bs = shift(bMask), as = shift(aMask)
  const scale = (mask) => {
    let n = 0, m = mask >>> shift(mask)
    while (m & 1) { n += 1; m >>>= 1 }
    return n === 8 ? 1 : 255 / Math.max(1, (1 << n) - 1)
  }
  const rscale = scale(rMask), gscale = scale(gMask), bscale = scale(bMask), ascale = aMask ? scale(aMask) : 1

  for (let row = 0; row < height; row += 1) {
    const sy = topDown ? row : height - 1 - row
    for (let x = 0; x < width; x += 1) {
      const si = offset + row * stride + x * bpp
      const v = buf.readUInt32LE(si)
      img.setPixel(
        x, sy,
        ((v & rMask) >>> rs) * rscale,
        ((v & gMask) >>> gs) * gscale,
        ((v & bMask) >>> bs) * bscale,
        aMask ? ((v & aMask) >>> as) * ascale : 255
      )
    }
  }
  return img
}

module.exports = {
  encodeDIBV5, decodeDIBV5,
  HEADER_SIZE, MASKS_SIZE, PIXEL_OFFSET, BI_BITFIELDS
}
