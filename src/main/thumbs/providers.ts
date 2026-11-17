import { nativeImage } from 'electron'
import { promises as fsp } from 'node:fs'
import { extname, dirname, join, basename } from 'node:path'
import type { ProjectFile } from '@shared/types'
import { THUMB_JPEG_QUALITY, THUMB_MAX_EDGE } from './consts'
import { pngHasAlpha } from './png'
import { decodePsdBuffer } from './psd'
import { readSai2ThumbSource } from './sai2'
import { jssfToJpeg } from './jssf'

/**
 * 缩略图提供者链。
 *
 * 接口刻意写成插件的形状（`{ id, match(ext), resolve(file) }`）：
 * M3a 接原生格式插件（.clip / .kra）时只要把对象塞进数组，不用改调度层。
 *
 * 约定的返回值：
 *   ThumbOutput    → 已编码好的字节，调度层写进缓存
 *   'passthrough'  → 主进程解不了，直接把原文件交给浏览器显示（webp / bmp / gif）
 *   null           → 这张图没有可用的预览（走封面兜底或信息卡）
 *   抛异常          → 同上，但会记一条日志说明原因
 */

export interface ThumbOutput {
  bytes: Uint8Array
  format: 'jpg' | 'png'
  /** 画布尺寸，信息卡与详情面板要用 */
  canvas?: { width: number; height: number }
}

export interface ThumbProvider {
  id: string
  match: (ext: string) => boolean
  resolve: (file: ProjectFile) => Promise<ThumbOutput | 'passthrough' | null>
}

/** nativeImage 只认 PNG / JPEG，其它位图交给浏览器解 —— 别在这里试图硬解 */
const NATIVE_DECODABLE = new Set(['.png', '.jpg', '.jpeg'])
const PASSTHROUGH_IMAGE = new Set(['.webp', '.bmp', '.gif', '.avif', '.tif', '.tiff', '.ico'])

async function readHead(path: string, bytes: number): Promise<Uint8Array> {
  const h = await fsp.open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await h.read(buf, 0, bytes, 0)
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
  } finally {
    await h.close()
  }
}

/**
 * 位图：PNG/JPEG 用 nativeImage 缩放（快，且走 libjpeg/libpng 的高质量缩放），
 * webp/bmp 之类直接 passthrough。
 */
export const imageProvider: ThumbProvider = {
  id: 'image',
  match: (ext) => NATIVE_DECODABLE.has(ext) || PASSTHROUGH_IMAGE.has(ext),
  async resolve(file) {
    if (!NATIVE_DECODABLE.has(file.ext)) return 'passthrough'

    const img = nativeImage.createFromPath(file.path)
    if (img.isEmpty()) return 'passthrough' // 后缀骗人的文件（把 webp 改名成 png）

    const { width, height } = img.getSize()
    if (!width || !height) return 'passthrough'

    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height))
    const out =
      scale < 1
        ? img.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: 'good'
          })
        : img

    // 带 alpha 的图压成 JPEG 会把透明区变黑（线稿、贴图尤其明显）
    const alpha = file.ext === '.png' ? pngHasAlpha(await readHead(file.path, 33)) : false
    return {
      bytes: alpha ? out.toPNG() : out.toJPEG(THUMB_JPEG_QUALITY),
      format: alpha ? 'png' : 'jpg',
      canvas: { width, height }
    }
  }
}

/** SAI2：解 `thum` 块的 jssf。小画布走 intg/dpcm，本版返回 null（封面兜底） */
export const sai2Provider: ThumbProvider = {
  id: 'sai2',
  match: (ext) => ext === '.sai2' || ext === '.sai',
  async resolve(file) {
    const src = await readSai2ThumbSource(file.path)
    if (!src) return null
    if (src.kind === 'dpcm') {
      // TODO(M2a-补)：intg/dpcm 解码。目前交给封面兜底 / 信息卡，
      // 不是"出错"，所以不抛异常 —— 抛了会在日志里刷一堆 warn。
      return null
    }
    const { jpeg } = jssfToJpeg(src.bytes)
    return {
      bytes: jpeg,
      format: 'jpg',
      canvas: { width: src.header.width, height: src.header.height }
    }
  }
}

/** PSD / PSB：合成图 → 缩放 → PNG。大文件由调度层丢 worker，这里只管进程内解码 */
export const psdProvider: ThumbProvider = {
  id: 'psd',
  match: (ext) => ext === '.psd' || ext === '.psb',
  async resolve(file) {
    const buf = await fsp.readFile(file.path)
    const thumb = decodePsdBuffer(buf)
    return {
      bytes: thumb.png,
      format: 'png',
      canvas: { width: thumb.width, height: thumb.height }
    }
  }
}

export const PROVIDERS: ThumbProvider[] = [imageProvider, psdProvider, sai2Provider]

export function providerFor(ext: string): ThumbProvider | undefined {
  return PROVIDERS.find((p) => p.match(ext))
}

/**
 * 封面兜底：同目录找同名图片（`foo.sai2` → `foo.png`）。
 * 画师导出预览图的习惯很普遍，这比信息卡有用得多。
 */
export async function findCover(file: ProjectFile): Promise<string | null> {
  const stem = basename(file.name, extname(file.name))
  const dir = dirname(file.path)
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const candidate = join(dir, stem + ext)
    try {
      const st = await fsp.stat(candidate)
      if (st.isFile() && st.size > 0) return candidate
    } catch {
      /* 不存在就试下一个 */
    }
  }
  return null
}
