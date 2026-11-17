import { promises as fsp } from 'node:fs'

/**
 * SAI2 容器解析（`SAI-CANVAS-TYPE0`）。
 *
 * ★ 块表的第三个字段是**绝对文件偏移**，不是长度。块长度 = 下一块的 pos - 本块 pos，
 *   最后一块算到文件末尾。
 *   （历史坑：早期当成长度，结果把 `intg` 块当 `thum` 解了两轮。）
 *
 * 只读文件头 + 块表 + 目标块，**不整读文件**：真实稿件 75MB，整读会让首屏明显变慢。
 */

export const SAI2_MAGIC = 'SAI-CANVAS-TYPE0'

export interface Sai2Block {
  tag: string
  layerId: number
  offset: number
  size: number
}

export interface Sai2Header {
  width: number
  height: number
  /** 第 2 个标志字节 & 7 == 0 → 画布带透明背景 */
  transparent: boolean
  blocks: Sai2Block[]
  /** 画布小于 512 走 intg/dpcm（当前留桩，靠封面兜底） */
  smallCanvas: boolean
}

/** 块表最多读这么多条：正常稿件几百条，几千条的要么是异常文件要么是超大工程 */
const MAX_BLOCKS = 8192

export class Sai2Error extends Error {}

/**
 * 头像级的读法：一次 open，读 64 字节头 → 按 table_count 读块表 → 关闭。
 */
export async function readSai2Header(path: string): Promise<Sai2Header> {
  const handle = await fsp.open(path, 'r')
  try {
    const head = Buffer.alloc(64)
    const { bytesRead } = await handle.read(head, 0, 64, 0)
    if (bytesRead < 64) throw new Sai2Error('文件头不完整')

    if (head.toString('latin1', 0, 16) !== SAI2_MAGIC) {
      throw new Sai2Error('不是 SAI2 画布文件（魔数不匹配）')
    }

    const bgFlags = head[17]!
    const width = head.readUInt32LE(20)
    const height = head.readUInt32LE(24)
    const tableCount = head.readUInt32LE(32)
    if (width === 0 || height === 0) throw new Sai2Error(`画布尺寸异常：${width}×${height}`)
    if (tableCount === 0 || tableCount > MAX_BLOCKS) {
      throw new Sai2Error(`块表条数异常：${tableCount}`)
    }

    const tableBuf = Buffer.alloc(tableCount * 16)
    const t = await handle.read(tableBuf, 0, tableBuf.length, 64)
    if (t.bytesRead < tableBuf.length) throw new Sai2Error('块表不完整')

    const stat = await handle.stat()
    const fileSize = stat.size

    const blocks: Sai2Block[] = []
    for (let i = 0; i < tableCount; i++) {
      const base = i * 16
      const tag = tableBuf.toString('latin1', base, base + 4)
      const layerId = tableBuf.readUInt32LE(base + 4)
      const offset = tableBuf.readUInt32LE(base + 8)
      if (offset < 64 || offset > fileSize) continue // 坏条目直接丢，别让下游算出负长度
      blocks.push({ tag, layerId, offset, size: 0 })
    }
    // 块表本身可能不是按偏移升序排的，先排序再算长度
    blocks.sort((a, b) => a.offset - b.offset)
    for (let i = 0; i < blocks.length; i++) {
      const next = blocks[i + 1]
      blocks[i]!.size = (next ? next.offset : fileSize) - blocks[i]!.offset
    }

    return {
      width,
      height,
      transparent: (bgFlags & 7) === 0,
      blocks,
      smallCanvas: Math.max(width, height) < 512
    }
  } finally {
    await handle.close()
  }
}

/** 按偏移读一个块（只读需要的那一段） */
export async function readBlock(path: string, block: Sai2Block): Promise<Uint8Array> {
  const handle = await fsp.open(path, 'r')
  try {
    const buf = Buffer.alloc(block.size)
    const { bytesRead } = await handle.read(buf, 0, block.size, block.offset)
    if (bytesRead < block.size) throw new Sai2Error(`块 ${block.tag} 读取不完整`)
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
  } finally {
    await handle.close()
  }
}

export function findBlock(header: Sai2Header, tag: string): Sai2Block | undefined {
  return header.blocks.find((b) => b.tag === tag)
}

/**
 * 取缩略图源数据。
 *  - `thum`（jssf）：画布 ≥ 512，交给 jssf.ts 重建
 *  - `intg`（dpcm）：画布 < 512，**本版留桩返回 null** → 走封面兜底 / 信息卡
 *
 * TODO(M2a-补)：dpcm 解码 —— 256×256 分块 + 行差分 + 变长 RLE16。
 *   参照 Wunkolo/libsai 的 ConvertDpcmToBmp，预计 100~150 行 TS。
 *   未实现的判断依据是块 tag，不是画布尺寸 —— 有些小画布也带 thum。
 */
export async function readSai2ThumbSource(
  path: string
): Promise<{ header: Sai2Header; kind: 'jssf' | 'dpcm'; bytes: Uint8Array } | null> {
  const header = await readSai2Header(path)
  const thum = findBlock(header, 'thum')
  if (thum) {
    if (thum.size < 20) return null
    return { header, kind: 'jssf', bytes: await readBlock(path, thum) }
  }
  const intg = findBlock(header, 'intg')
  if (intg) return { header, kind: 'dpcm', bytes: new Uint8Array(0) }
  return null
}
