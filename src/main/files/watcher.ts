import { watch, type FSWatcher } from 'chokidar'
import { extname, resolve } from 'node:path'

/**
 * 多目录监听 + 去抖归一。
 *
 * 为什么不用 fs.watch 自己写：Windows 上 ReadDirectoryChangesW 的语义很难对齐 ——
 * 一次保存会连着来 3~5 个事件（临时文件改名、内容写入、属性更新），还经常拿到
 * 目录级事件而不是文件级。chokidar 把这些坑都趟过了，代价是一个依赖。
 *
 * 去抖不是"为了省事件"这么简单：SAI2 存盘是**先写 .tmp 再改名**，不去抖的话
 * 渲染端会先收到一个不存在的临时文件、再收到正式文件，两批事件之间列表会闪。
 */

export type WatchKind = 'upsert' | 'remove' | 'remove-dir'

export interface WatcherOptions {
  recursive: boolean
  debounceMs: number
  onBatch: (kind: WatchKind, paths: string[]) => void
  onError: (err: unknown) => void
}

/** 这些目录不监听（与 scanner 跳过的保持一致，避免白占句柄） */
const SKIP_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.thumbnails',
  '.cache',
  '__pycache__',
  '.idea',
  '.vscode'
])

function ignoredPath(p: string): boolean {
  // 只看最后一段，避免把 C:\Users\.foo 这类路径里的用户名当成隐藏目录
  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const name = sep >= 0 ? p.slice(sep + 1) : p
  if (!name) return false
  if (SKIP_DIR_NAMES.has(name.toLowerCase())) return true
  return name.startsWith('.') && name.length > 1
}

export class DirWatcher {
  private watcher: FSWatcher | null = null
  private upserts = new Set<string>()
  private removes = new Set<string>()
  private removedDirs = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly opts: WatcherOptions) {}

  watch(dirs: string[]): void {
    if (dirs.length === 0) return
    if (!this.watcher) {
      this.watcher = watch([], {
        ignoreInitial: true,
        // 等文件写完再报：SAI2 / PS 存盘时文件会短暂处于半写状态，
        // 这时候去 stat 会拿到半截大小，缩略图键算错就永远修不回来
        awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
        ignorePermissionErrors: true,
        followSymlinks: false,
        depth: this.opts.recursive ? undefined : 0,
        ignored: (p: string) => ignoredPath(p)
      })
      this.watcher.on('add', (p) => this.push('upsert', p))
      this.watcher.on('change', (p) => this.push('upsert', p))
      this.watcher.on('unlink', (p) => this.push('remove', p))
      this.watcher.on('unlinkDir', (p) => this.push('remove-dir', p))
      this.watcher.on('error', (err) => this.opts.onError(err))
    }
    this.watcher.add(dirs.map((d) => resolve(d)))
  }

  unwatch(dirs: string[]): void {
    if (!this.watcher || dirs.length === 0) return
    this.watcher.unwatch(dirs.map((d) => resolve(d)))
  }

  private push(kind: WatchKind, raw: string): void {
    const p = resolve(raw)
    if (kind === 'remove-dir') {
      this.removedDirs.add(p)
    } else if (kind === 'upsert') {
      this.removes.delete(p)
      this.upserts.add(p)
    } else {
      this.upserts.delete(p)
      this.removes.add(p)
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.opts.debounceMs)
  }

  flush(): void {
    this.timer = null
    if (this.upserts.size > 0) {
      const list = [...this.upserts]
      this.upserts.clear()
      this.opts.onBatch('upsert', list)
    }
    if (this.removes.size > 0) {
      const list = [...this.removes]
      this.removes.clear()
      this.opts.onBatch('remove', list)
    }
    if (this.removedDirs.size > 0) {
      const list = [...this.removedDirs]
      this.removedDirs.clear()
      this.opts.onBatch('remove-dir', list)
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.upserts.clear()
    this.removes.clear()
    this.removedDirs.clear()
    const w = this.watcher
    this.watcher = null
    if (w) {
      try {
        await w.close()
      } catch {
        /* 关闭失败说明进程正在退出，无需处理 */
      }
    }
  }
}

/** 扩展名过滤外置：watcher 只负责事件，白名单由索引层掌握（设置页可改） */
export function extOf(p: string): string {
  return extname(p).toLowerCase()
}
