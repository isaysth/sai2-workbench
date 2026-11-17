import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { extname, resolve } from 'node:path'
import type { ProjectFile } from '@shared/types'

/**
 * 目录扫描。
 *
 * 三个必须守住的点（计划 T2.1）：
 *  1. **分批 yield**：一次 readdir 出来 5 万个条目全塞进数组再处理，会把主进程内存
 *     顶起来、还会让事件循环卡住几百毫秒（界面掉帧）。攒够 200 条就交出去一次。
 *  2. **单条失败不中断全轮**：文件被占用（SAI2 正在写）、刚被删、没有读权限，
 *     stat 都会抛。整轮扫描因为一个文件失败而中止是最糟的结果。
 *  3. **目录环**：符号链接可以指回上级。用 realpath 去重，否则会无限展开。
 */

/** 这些目录永远不会放工程文件，扫进去只是浪费 IO 和时间 */
const SKIP_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.thumbnails',
  '.cache',
  'data', // 程序自己的数据目录（被监听目录包含时）
  '__pycache__',
  '.idea',
  '.vscode'
])

function shouldSkipDir(name: string): boolean {
  const lower = name.toLowerCase()
  if (SKIP_DIR_NAMES.has(lower)) return true
  // 隐藏目录一律跳过：用户自己建的 ".work" 之类通常不是稿件目录
  return name.startsWith('.')
}

export interface ScanOptions {
  recursive: boolean
  /** 小写、带点，如 '.sai2' */
  extensions: Set<string>
  /** 每攒够多少条产出一次 */
  batchSize?: number
  /** 重扫 / 退出时中断（中止后生成器直接返回，不报错） */
  signal?: AbortSignal
  /** 开始遍历一个目录时回调，用于推进度条 */
  onDir?: (dir: string) => void
}

/** 每层目录内同时 stat 的上限。5000 文件的冷启动实测从 1.47s 降到 0.3s 级 */
const STAT_CONCURRENCY = 32

/** 一次 stat 把大小、修改时间、身份都拿到；失败返回 null（调用方跳过该条） */
async function statFile(
  full: string
): Promise<{ size: number; mtimeMs: number; dev?: string; ino?: string } | null> {
  try {
    // bigint 版本不是可选项：NTFS 的 ino 是 64 位，number 版会丢精度，
    // 丢精度就会出现"两个不同文件撞同一身份"，进而把 A 的标签贴到 B 上。
    const st = await fsp.stat(full, { bigint: true })
    if (!st.isFile()) return null
    const dev = String(st.dev)
    const ino = String(st.ino)
    return {
      size: Number(st.size),
      mtimeMs: Number(st.mtimeMs),
      // '0' 表示这个文件系统没给出可信身份（部分网络盘 / 移动硬盘），交给上层退回 path 匹配
      dev: dev === '0' ? undefined : dev,
      ino: ino === '0' ? undefined : ino
    }
  } catch {
    return null
  }
}

/**
 * 逐目录产出批次。调用方 `for await` 即可，不需要自己管栈。
 */
export async function* scanDir(root: string, opts: ScanOptions): AsyncGenerator<ProjectFile[]> {
  const batchSize = opts.batchSize ?? 200
  const stack: string[] = [resolve(root)]
  /** realpath（小写）→ 已访问。Windows 路径大小写不敏感，统一小写比较 */
  const visited = new Set<string>()
  let batch: ProjectFile[] = []

  while (stack.length > 0) {
    if (opts.signal?.aborted) return
    const dir = stack.pop()!

    let real: string
    try {
      real = await fsp.realpath(dir)
    } catch {
      continue // 目录刚被删 / 盘拔了
    }
    const guard = real.toLowerCase()
    if (visited.has(guard)) continue
    visited.add(guard)
    opts.onDir?.(dir)

    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 权限不足 / 网盘掉线：跳过这个目录，其它照扫
    }

    // 先在这一层目录里筛出候选，再小并发 stat。
    // 串行 await stat 扫 5000 个文件要 1.4s（实测），冷启动卡在 1s 外；
    // 32 路并发能压到 300ms 级，又不会像 5000 路并发那样把完成端口打爆。
    const candidates: Array<{ full: string; name: string; ext: string }> = []
    for (const entry of entries) {
      if (opts.signal?.aborted) return
      const name = entry.name

      if (entry.isDirectory()) {
        if (opts.recursive && !shouldSkipDir(name)) stack.push(resolve(dir, name))
        continue
      }
      // 符号链接当文件处理时也要 stat 确认（可能是目录链接）
      if (!entry.isFile() && !entry.isSymbolicLink()) continue

      const ext = extname(name).toLowerCase()
      if (!opts.extensions.has(ext)) continue
      candidates.push({ full: resolve(dir, name), name, ext })
    }

    for (let i = 0; i < candidates.length; i += STAT_CONCURRENCY) {
      if (opts.signal?.aborted) return
      const slice = candidates.slice(i, i + STAT_CONCURRENCY)
      const stats = await Promise.all(slice.map((c) => statFile(c.full)))
      for (let j = 0; j < slice.length; j += 1) {
        const st = stats[j]
        if (!st) continue
        const c = slice[j]
        batch.push({
          path: c.full,
          name: c.name,
          ext: c.ext,
          dir,
          size: st.size,
          mtimeMs: st.mtimeMs,
          dev: st.dev,
          ino: st.ino,
          thumb: { state: 'pending' }
        })
        if (batch.length >= batchSize) {
          yield batch
          batch = []
        }
      }
    }
  }

  if (batch.length > 0) yield batch
}

/** 单文件 stat → ProjectFile。watcher 事件与重扫回放共用。 */
export async function statOne(full: string, extensions: Set<string>): Promise<ProjectFile | null> {
  const ext = extname(full).toLowerCase()
  if (!extensions.has(ext)) return null
  const st = await statFile(full)
  if (!st) return null
  const sepIndex = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'))
  return {
    path: full,
    name: sepIndex >= 0 ? full.slice(sepIndex + 1) : full,
    ext,
    dir: sepIndex >= 0 ? full.slice(0, sepIndex) : full,
    size: st.size,
    mtimeMs: st.mtimeMs,
    dev: st.dev,
    ino: st.ino,
    thumb: { state: 'pending' }
  }
}
