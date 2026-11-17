import { readPsd } from 'ag-psd'
import { downscaleRgba, encodePng } from './png'
import { THUMB_MAX_EDGE } from './consts'

/**
 * PSD / PSB → 缩略图。
 *
 * 用 `ag-psd` 的 `imageData`（合成图）而不是图层：我们只要一张预览，
 * 解图层会多花几十倍内存与时间（300MB 的 PSB 图层展开能吃掉 2GB）。
 *
 * 不用 node-canvas：它会把免安装包从 80MB 撑到 150MB+，还得按 Electron ABI 重编译。
 * 合成图本身就是 RGBA 缓冲，自己缩、自己编码 PNG 就够（见 png.ts）。
 */

export class PsdError extends Error {}

export interface PsdThumb {
  /** 编码后的 PNG 字节 */
  png: Uint8Array
  width: number
  height: number
  /** 全不透明（可安全压成 JPEG） */
  opaque: boolean
}

export function decodePsdBuffer(buf: Buffer): PsdThumb {
  let psd: ReturnType<typeof readPsd>
  try {
    psd = readPsd(buf, {
      skipLayerImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      useImageData: true
    })
  } catch (err) {
    throw new PsdError(`PSD 解析失败：${String(err)}`)
  }

  const img = psd.imageData
  if (!img || !img.width || !img.height) {
    throw new PsdError('PSD 没有合成图（可能是纯图层工程或 16bit/CMYK 变体）')
  }

  let data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  let width = img.width
  let height = img.height
  let opaque = true

  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height))
  if (scale < 1) {
    const dw = Math.max(1, Math.round(width * scale))
    const dh = Math.max(1, Math.round(height * scale))
    const res = downscaleRgba(data, width, height, dw, dh)
    data = res.data
    width = dw
    height = dh
    opaque = res.opaque
  } else {
    // 原图就比 512 小，只需要判断有没有透明像素
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 255) {
        opaque = false
        break
      }
    }
  }

  return { png: encodePng(width, height, data, !opaque), width, height, opaque }
}
