import { existsSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import type { FileChangeEvent, IndexProgress, Project, ProjectFile, Tag } from '@shared/types'
import type { FileStore, FileUpsertInput, StoredFile } from '../db/files'
import type { Logger } from '../logger'
import { thumbKey } from '../thumbs/key'
import { scanDir, statOne } from './scanner'
import { DirWatcher } from './watcher'

/**
 * 文件索引。内存里一张 Map 是运行时唯一真相，数据库负责两件事：
 *   1. 启动时把行灌回来（`hydrate`）—— 省掉 5000 次 readdir + stat，秒开。
 *   2. 记住「这个文件是谁」（dev:ino）—— 改名/移动后还能认出它，标签不丢。
 *
 * 扫描方式（需求 v1.21）：默认 startup —— 启动时扫一次快照，之后不挂任何监听器，
 * 用户在文件页点「刷新」才会重扫；设置里切到 realtime 才恢复常驻 chokidar。
 *
 * 四个不变量（错了会出难查的 bug）：
 *  1. **扫描期间到来的 watcher 事件不能丢**。全量扫描是一次快照，扫到一半新建的文件
 *     有可能落在"已经遍历过的目录"里 —— 如果这时直接把事件应用上去，等扫描结束时
 *     它会被后来的批次覆盖掉。所以扫描期间只记路径，扫完统一回放并比对 mtime。
 *  2. **路径是内存里的键**，统一 `resolve()` 成绝对路径后再存。
 *  3. **byThumb 必须与 files 同步**，否则刷新后点开旧卡片会读到已删除文件的信息。
 *  4. **已 hydrate 之后的全量扫描是「比对」而不是「重来」**：内存不清空、内容没变的行
 *     不推 upsert、也不重写库。否则每次点刷新都会让 5000 张卡片重建一遍。
 */

export interface IndexSettings {
  dirs: string[]
  extensions: string[]
  recursive: boolean
  debounceMs: number
  /** true = 常驻监听；false = 只扫一次（默认，靠手动刷新更新） */
  realtime: boolean
  thumbVersion: number
}

export interface FilesIndexDeps {
  log: Logger
  /** 变更回调。这里不做合并，合并交给 IPC 层（它才知道窗口状态） */
  onChange: (ev: FileChangeEvent) => void
  onProgress: (p: IndexProgress) => void
  settings: () => IndexSettings
  /** 持久化门面。没传时退化成纯内存索引（测试与降级用） */
  store?: FileStore
}

export interface ListQuery {
  dir?: string
  keyword?: string
  limit?: number
  offset?: number
}

const EMPTY_PROGRESS: IndexProgress = { scanning: false, scanned: 0, dirs: 0, current: '' }

/** 一次刷新最多攒这么多行就落库：再大单次事务会卡住主线程上百毫秒 */
const PERSIST_BATCH = 300
const PERSIST_DELAY = 120

/** 身份键：dev:ino。取不到返回 undefined，缩略图键与入库都退回 path */
function identOf(dev?: string | null, ino?: string | null): string | undefined {
  if (!dev || !ino || dev === '0' || ino === '0') return undefined
  return `${dev}:${ino}`
}

export class FilesIndex {
  private files = new Map<string, ProjectFile>()
  private byThumb = new Map<string, ProjectFile>()
  /** 排好序的列表缓存，任何变更置 null */
  private sorted: ProjectFile[] | null = null

  private watcher: DirWatcher
  private abort: AbortController | null = null
  private scanPromise: Promise<void> | null = null
  private scanning = false
  private pendingUpserts = new Set<string>()
  private pendingRemoves = new Set<string>()

  private watchedDirs: string[] = []
  private appliedRules = ''
  private appliedVersion = 0
  /** null = 还没对齐过配置，首次 apply 由全量扫描统一按模式开/关监听 */
  private appliedRealtime: boolean | null = null
  private progress: IndexProgress = { ...EMPTY_PROGRESS }
  private lastProgressAt = 0
  private disposed = false

  /** 已从数据库恢复过。只有这个状态下全量扫描才走「比对」而不是「清空重来」 */
  private hydrated = false
  /** 恢复到的行数。0 表示库里本来就是空的（首次运行），日志里不该说「比对」 */
  private hydrateCount = 0
  private persistQueue = new Map<string, FileUpsertInput>()
  private persistTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: FilesIndexDeps) {
    this.watcher = this.newWatcher(deps.settings())
  }

  private newWatcher(s: IndexSettings): DirWatcher {
    return new DirWatcher({
      recursive: s.recursive,
      debounceMs: s.debounceMs,
      onBatch: (kind, paths) => this.onWatchBatch(kind, paths),
      onError: (err) => this.deps.log.warn('files', `监听出错：${String(err)}`)
    })
  }

  // ---------------------------------------------------------------- 生命周期

  /**
   * 从数据库把索引灌回内存。同步读 5000 行约 40~80ms，放在窗口创建之前，
   * 渲染端第一次 `files:list` 就能拿到完整列表 —— 这就是「秒开」的全部秘密。
   */
  hydrate(): number {
    const store = this.deps.store
    if (!store || this.hydrated) return 0
    const started = Date.now()
    let rows: StoredFile[] = []
    try {
      rows = store.listAll()
    } catch (err) {
      this.deps.log.error('files', `从数据库恢复索引失败，将退回全量扫描：${String(err)}`)
      return 0
    }

    const version = this.deps.settings().thumbVersion
    for (const row of rows) {
      const key = thumbKey(row.path, row.size, row.mtime, version, identOf(row.dev, row.ino))
      const file: ProjectFile = {
        path: row.path,
        name: row.name,
        ext: row.ext,
        dir: row.dir,
        size: row.size,
        mtimeMs: row.mtime,
        dev: row.dev ?? undefined,
        ino: row.ino ?? undefined,
        fileId: row.id,
        tags: row.tags,
        projectId: row.projectId,
        project: row.project,
        thumbKey: key,
        thumb: { state: 'pending' }
      }
      if (row.width && row.height) file.canvas = { width: row.width, height: row.height }
      this.files.set(file.path, file)
      this.byThumb.set(key, file)
    }

    this.sorted = null
    this.hydrated = true
    this.hydrateCount = rows.length
    if (rows.length > 0) this.deps.onChange({ reset: true, adds: [...this.files.values()] })
    this.deps.log.info('files', `索引已从数据库恢复：${rows.length} 条，用时 ${Date.now() - started}ms`)
    return rows.length
  }

  /** 按当前配置对齐索引：规则变化走全量，目录增删走增量，扫描方式变化只启停监听器 */
  async apply(force = false): Promise<void> {
    const s = this.deps.settings()
    const dirs = uniqueDirs(s.dirs).filter((d) => {
      const ok = existsSync(d)
      if (!ok) this.deps.log.warn('files', `监听目录不存在，已跳过：${d}`)
      return ok
    })

    const rules = `${s.extensions.join(',')}|${s.recursive}|${s.debounceMs}`
    const prevRules = this.appliedRules
    const firstApply = this.appliedRealtime === null
    const rulesChanged = force || rules !== this.appliedRules
    const versionChanged = s.thumbVersion !== this.appliedVersion
    const dirsChanged = !sameDirs(dirs, this.watchedDirs)
    const modeChanged = !firstApply && s.realtime !== this.appliedRealtime
    if (!firstApply && !rulesChanged && !versionChanged && !dirsChanged && !modeChanged) return

    this.appliedRules = rules
    this.appliedVersion = s.thumbVersion

    if (firstApply) {
      // 首次必然接着走全量扫描，那里会按模式决定开不开监听，这里只记状态
      this.appliedRealtime = s.realtime
    } else if (modeChanged) {
      this.appliedRealtime = s.realtime
      await this.setRealtime(s.realtime)
    }

    if (rulesChanged) {
      // 规则真变了才换 watcher；单纯点「刷新」不必重启监听器（会漏事件）
      await this.fullScan(dirs, s, !firstApply && !force && prevRules !== rules)
      return
    }

    if (dirsChanged) {
      const added = dirs.filter((d) => !containsDir(this.watchedDirs, d))
      const removed = this.watchedDirs.filter((d) => !containsDir(dirs, d))
      this.watchedDirs = dirs
      if (removed.length > 0) {
        this.watcher.unwatch(removed)
        const dead: string[] = []
        for (const [p] of this.files) {
          if (removed.some((d) => isInside(p, d))) dead.push(p)
        }
        this.dropPaths(dead)
      }
      if (added.length > 0) {
        // startup 模式下新增目录只做一次增量扫描，不因此挂上常驻监听
        if (s.realtime) this.watcher.watch(added)
        await this.scanInto(added, s)
      }
    }

    // 解码逻辑换了版本：键全变，但不用碰磁盘
    if (versionChanged) this.rebuildKeys(s.thumbVersion)
  }

  private async fullScan(dirs: string[], s: IndexSettings, rebuildWatcher: boolean): Promise<void> {
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort

    if (rebuildWatcher) {
      // 规则可能变了（是否递归 / 去抖时长），旧 watcher 要整体换掉
      await this.watcher.close()
      this.watcher = this.newWatcher(s)
    }

    this.pendingUpserts.clear()
    this.pendingRemoves.clear()
    this.watchedDirs = dirs

    if (!this.hydrated) {
      // 还没接数据库（或从没恢复过）：彻底重来
      this.files.clear()
      this.byThumb.clear()
      this.sorted = null
      this.deps.onChange({ reset: true })
    }

    await this.scanInto(dirs, s, abort.signal)
  }

  /**
   * 切换扫描方式，不动索引内容。
   * 关监听用 close() 而不是 unwatch()：chokidar 即使 unwatch 掉所有路径，
   * 内部 FSWatcher 仍留着句柄，startup 模式要的是「零常驻」。
   */
  private async setRealtime(on: boolean): Promise<void> {
    if (on) {
      if (this.watchedDirs.length > 0) this.watcher.watch(this.watchedDirs)
      this.deps.log.info('files', '已开启实时监听：丢文件约 2 秒内自动出卡片')
    } else {
      await this.watcher.close()
      this.deps.log.info('files', '已关闭实时监听：之后请在文件页点「刷新」更新')
    }
  }

  /**
   * 扫描指定目录并把结果并入索引。
   * 实时模式下先开监听再扫，否则"扫完到开监听"之间的新增文件会永远看不到；
   * startup 模式是一次性快照，不挂监听器，扫完就彻底空闲。
   */
  private async scanInto(dirs: string[], s: IndexSettings, signal?: AbortSignal): Promise<void> {
    if (dirs.length === 0) {
      this.scanning = false
      this.progress = { ...EMPTY_PROGRESS }
      this.deps.onProgress(this.progress)
      return
    }
    if (s.realtime) this.watcher.watch(dirs)
    this.scanning = true
    this.setProgress({ scanning: true, scanned: 0, dirs: 0, current: dirs[0] ?? '' }, true)

    const started = Date.now()
    const compare = this.hydrated
    let scanned = 0
    let dirCount = 0
    let changed = 0
    /** 本轮实际扫到的路径。收尾时拿它跟库里的活行做差集，不需要给每行刷 last_seen */
    const seenPaths: string[] = []
    const extensions = new Set(s.extensions)

    const tasks = dirs.map(async (dir) => {
      for await (const batch of scanDir(dir, {
        recursive: s.recursive,
        extensions,
        signal,
        onDir: (d) => {
          dirCount += 1
          this.setProgress({
            scanning: true,
            scanned,
            dirs: dirCount,
            current: d.length > 78 ? `…${d.slice(-76)}` : d
          })
        }
      })) {
        const adds: ProjectFile[] = []
        for (const file of batch) {
          seenPaths.push(file.path)
          if (compare) {
            const prev = this.files.get(file.path)
            if (prev && this.sameContent(prev, file)) {
              // 内容与身份都没变：不推 upsert、不写库，只在这里记一个"本轮见过"
              continue
            }
          }
          this.upsert(file, s.thumbVersion)
          adds.push(file)
        }
        scanned += batch.length
        if (adds.length > 0) {
          changed += adds.length
          this.deps.onChange({ adds })
        }
      }
    })

    const run = Promise.all(tasks).then(() => {
      if (signal?.aborted) return
      this.flushPersist()

      if (compare) {
        // 这次没扫到的活行 → 标为历史（不删：7 天内移回来标签还在）
        try {
          const gone = this.deps.store?.sweepMissing(seenPaths, Date.now()) ?? []
          if (gone.length > 0) {
            const inMemory = gone.filter((p) => this.files.has(p))
            if (inMemory.length > 0) this.forget(inMemory)
            this.deps.log.info('files', `${gone.length} 个文件已不在目录里，标记为历史（标签保留）`)
          }
        } catch (err) {
          this.deps.log.warn('files', `清理缺失文件失败：${String(err)}`)
        }
      }

      this.scanning = false
      this.setProgress({ ...this.progress, scanning: false }, true)
      this.deps.log.info(
        'files',
        compare && this.hydrateCount > 0
          ? `比对完成：${this.files.size} 条，变更 ${changed} 条，用时 ${Date.now() - started}ms`
          : `扫描完成：${this.files.size} 个文件 / ${dirCount} 个目录，用时 ${Date.now() - started}ms`
      )
      void this.replayPending()
    })

    this.scanPromise = run
    await run
  }

  /** 内容是否完全没变。身份也要比：从"无 ino"变成"有 ino"时缩略图键会变，必须重算 */
  private sameContent(a: ProjectFile, b: ProjectFile): boolean {
    return (
      a.size === b.size &&
      Math.round(a.mtimeMs) === Math.round(b.mtimeMs) &&
      a.dev === b.dev &&
      a.ino === b.ino
    )
  }

  private setProgress(p: IndexProgress, force = false): void {
    this.progress = p
    // 每 120ms 推一次就够：进度条不需要 60fps，广播太频繁反而拖慢扫描本身
    const now = Date.now()
    if (!force && now - this.lastProgressAt < 120) return
    this.lastProgressAt = now
    this.deps.onProgress(p)
  }

  // ---------------------------------------------------------------- 落库

  /**
   * 入库不进同步路径：扫描时每 200 条一个批次，如果每条都写一次库，
   * 5000 行就是 5000 次事务提交 —— 磁盘 fsync 会把扫描从 200ms 拖到十几秒。
   * 攒够 300 行或 120ms 到了再刷一次。
   */
  private enqueuePersist(file: ProjectFile): void {
    if (!this.deps.store) return
    this.persistQueue.set(file.path, {
      path: file.path,
      dir: file.dir,
      name: file.name,
      ext: file.ext,
      size: file.size,
      mtime: Math.round(file.mtimeMs),
      dev: file.dev ?? null,
      ino: file.ino ?? null,
      thumbKey: file.thumbKey ?? null
    })
    if (this.persistQueue.size >= PERSIST_BATCH) this.flushPersist()
    else if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DELAY)
    }
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const store = this.deps.store
    if (!store || this.persistQueue.size === 0) return
    const inputs = [...this.persistQueue.values()]
    this.persistQueue.clear()

    let results: ReturnType<FileStore['upsertBatch']>
    try {
      results = store.upsertBatch(inputs, Date.now())
    } catch (err) {
      this.deps.log.error('files', `索引入库失败（本批 ${inputs.length} 行）：${String(err)}`)
      return
    }

    const touched: ProjectFile[] = []
    const vanished: string[] = []
    for (const r of results) {
      const file = this.files.get(r.path)
      if (!file) continue
      file.fileId = r.id
      file.tags = r.tags
      if (r.projectId !== null) {
        file.projectId = r.projectId
        file.project = r.project
      }
      if (r.renamedFrom && r.renamedFrom !== r.path) {
        // 改名/移动：旧路径在内存里还挂着同一个文件的一条影子，必须清掉，
        // 否则列表里会同时出现「旧名（打不开）」和「新名」两张卡
        const ghost = this.files.get(r.renamedFrom)
        if (ghost) {
          this.files.delete(r.renamedFrom)
          if (ghost.thumbKey) this.byThumb.delete(ghost.thumbKey)
          vanished.push(r.renamedFrom)
        }
        this.deps.log.info('files', `按文件身份认出改名：${basename(r.renamedFrom)} → ${basename(r.path)}`)
      }
      // 自动标签 / 抢救回来的标签是入库那一步才有的，补推一次让卡片立刻显示
      if (r.created && r.tags.length > 0) touched.push(file)
    }
    if (vanished.length > 0) this.sorted = null
    if (touched.length > 0 || vanished.length > 0) {
      this.deps.onChange({ adds: touched.length > 0 ? touched : undefined, removes: vanished.length > 0 ? vanished : undefined })
    }
  }

  // ---------------------------------------------------------------- 事件

  private onWatchBatch(kind: 'upsert' | 'remove' | 'remove-dir', paths: string[]): void {
    if (this.disposed) return
    if (this.scanning) {
      // 扫描期间只记路径，扫完回放（见类注释不变量 1）
      for (const p of paths) {
        if (kind === 'upsert') {
          this.pendingRemoves.delete(p)
          this.pendingUpserts.add(p)
        } else if (kind === 'remove') {
          this.pendingUpserts.delete(p)
          this.pendingRemoves.add(p)
        } else {
          this.pendingRemoves.add(p)
        }
      }
      return
    }
    if (kind === 'upsert') void this.applyUpserts(paths)
    else if (kind === 'remove') this.dropPaths(paths)
    else for (const dir of paths) this.dropDir(dir)
  }

  private async replayPending(): Promise<void> {
    const upserts = [...this.pendingUpserts]
    const removes = [...this.pendingRemoves]
    this.pendingUpserts.clear()
    this.pendingRemoves.clear()

    if (removes.length > 0) {
      // 只要索引里还有它、而磁盘上确实没了，就该推 remove
      const alive = removes.filter((p) => this.files.has(p) && !existsSync(p))
      if (alive.length > 0) this.dropPaths(alive)
    }
    if (upserts.length > 0) {
      const s = this.deps.settings()
      const additions: ProjectFile[] = []
      for (const p of upserts) {
        const file = await statOne(p, new Set(s.extensions))
        if (!file) continue
        const prev = this.files.get(p)
        if (prev && this.sameContent(prev, file)) {
          continue // 扫描已经收进去了，不必重复推
        }
        this.upsert(file, s.thumbVersion)
        additions.push(file)
      }
      if (additions.length > 0) this.deps.onChange({ adds: additions })
    }
  }

  async applyUpserts(paths: string[]): Promise<void> {
    const s = this.deps.settings()
    const ext = new Set(s.extensions)
    const additions: ProjectFile[] = []
    for (const p of paths) {
      const file = await statOne(p, ext)
      if (!file) {
        // 刚被删掉 / 被改成白名单外类型：当作移除，别留一条幽灵条目
        if (this.files.has(p)) this.dropPaths([p])
        continue
      }
      this.upsert(file, s.thumbVersion)
      additions.push(file)
    }
    if (additions.length > 0) this.deps.onChange({ adds: additions })
  }

  private upsert(file: ProjectFile, version: number): void {
    const prev = this.files.get(file.path)
    const sameContent = prev !== undefined && this.sameContent(prev, file)

    if (prev?.thumbKey) this.byThumb.delete(prev.thumbKey)

    file.thumbKey = thumbKey(file.path, file.size, file.mtimeMs, version, identOf(file.dev, file.ino))
    if (prev) {
      // 同一条库记录：身份、标签、项目全部沿用，别让一次保存把卡片上的标签抹掉
      file.fileId = prev.fileId
      file.tags = prev.tags
      file.projectId = prev.projectId
      file.project = prev.project
    }
    if (sameContent && prev) {
      // 内容没变：保留已知画布尺寸与缩略图状态，别让一次无关的属性更新把已生成的图重置
      file.canvas = prev.canvas
      file.thumb = prev.thumb
    } else {
      file.thumb = { state: 'pending' }
    }

    this.files.set(file.path, file)
    this.byThumb.set(file.thumbKey, file)
    this.sorted = null

    this.enqueuePersist(file)
  }

  /** 只从内存里摘掉，不碰数据库（调用方已经处理过库） */
  private forget(paths: string[]): void {
    const removes: string[] = []
    for (const p of paths) {
      const prev = this.files.get(p)
      if (!prev) continue
      this.files.delete(p)
      if (prev.thumbKey) this.byThumb.delete(prev.thumbKey)
      removes.push(p)
    }
    if (removes.length > 0) {
      this.sorted = null
      this.deps.onChange({ removes })
    }
  }

  private dropPaths(paths: string[]): void {
    const hit = paths.filter((p) => this.files.has(p))
    if (hit.length === 0) return
    // 软删除：先落库标 missing_at，再从内存摘掉。7 天内文件回来还能捡回标签
    try {
      this.deps.store?.markMissing(hit, Date.now())
    } catch (err) {
      this.deps.log.warn('files', `标记缺失文件失败：${String(err)}`)
    }
    this.forget(hit)
  }

  private dropDir(dir: string): void {
    const hits: string[] = []
    for (const [p] of this.files) {
      if (isInside(p, dir)) hits.push(p)
    }
    this.dropPaths(hits)
  }

  private rebuildKeys(version: number): void {
    this.byThumb.clear()
    for (const file of this.files.values()) {
      file.thumbKey = thumbKey(file.path, file.size, file.mtimeMs, version, identOf(file.dev, file.ino))
      file.thumb = { state: 'pending' }
      this.byThumb.set(file.thumbKey, file)
    }
    this.sorted = null
    this.deps.onChange({ reset: true, adds: [...this.files.values()] })
  }

  // ---------------------------------------------------------------- 查询

  list(q: ListQuery = {}): { total: number; items: ProjectFile[] } {
    if (!this.sorted) {
      this.sorted = [...this.files.values()].sort((a, b) => {
        if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
        return a.name.localeCompare(b.name)
      })
    }
    let items = this.sorted
    if (q.dir) items = items.filter((f) => isInside(f.path, q.dir!))
    if (q.keyword) {
      const kw = q.keyword.toLowerCase()
      items = items.filter((f) => f.name.toLowerCase().includes(kw))
    }
    const total = items.length
    const offset = Math.max(0, Math.floor(q.offset ?? 0))
    const rawLimit = Math.floor(q.limit ?? total)
    const limit = Math.min(20000, Math.max(1, rawLimit || total || 1))
    return { total, items: items.slice(offset, offset + limit) }
  }

  find(path: string): ProjectFile | undefined {
    return this.files.get(path)
  }

  findByThumbKey(key: string): ProjectFile | undefined {
    return this.byThumb.get(key)
  }

  /** 缩略图生成后回填状态，并把画布尺寸补进索引与数据库（信息卡与详情面板都要用） */
  patchThumb(path: string, thumb: ProjectFile['thumb'], canvas?: { width: number; height: number }): void {
    const file = this.files.get(path)
    if (!file) return
    file.thumb = thumb
    if (canvas) {
      file.canvas = canvas
      // 画布尺寸进库，下次启动信息卡不用等解码就知道比例
      if (file.fileId && canvas.width > 0 && canvas.height > 0) {
        try {
          this.deps.store?.patchGeometry(file.fileId, canvas.width, canvas.height, file.thumbKey)
        } catch {
          /* 写库失败不影响本次显示 */
        }
      }
    }
    this.sorted = null
  }

  /** 标签 / 项目变更后同步内存里的那一份（渲染端从 IPC 返回值拿同一份数据） */
  patchMeta(
    path: string,
    patch: { tags?: Tag[]; projectId?: number | null; project?: Project | null }
  ): ProjectFile | undefined {
    const file = this.files.get(path)
    if (!file) return undefined
    if (patch.tags !== undefined) file.tags = patch.tags
    if (patch.projectId !== undefined) file.projectId = patch.projectId
    if (patch.project !== undefined) file.project = patch.project
    this.sorted = null
    return file
  }

  /** 清缓存后让所有卡片重新请求 */
  refreshAll(): void {
    for (const file of this.files.values()) file.thumb = { state: 'pending' }
    this.deps.onChange({ reset: true, adds: [...this.files.values()] })
  }

  count(): number {
    return this.files.size
  }

  progressInfo(): IndexProgress {
    return this.progress
  }

  async stop(): Promise<void> {
    this.disposed = true
    this.abort?.abort()
    this.flushPersist()
    await this.watcher.close()
    try {
      await this.scanPromise
    } catch {
      /* 扫描被中止 */
    }
  }
}

function uniqueDirs(dirs: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of dirs) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    const abs = resolve(raw)
    const key = abs.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(abs)
  }
  return out
}

function sameDirs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d) => containsDir(b, d))
}

/** Windows 路径大小写不敏感，比较一律走小写 */
function containsDir(list: string[], dir: string): boolean {
  const d = dir.toLowerCase()
  return list.some((x) => x.toLowerCase() === d)
}

function isInside(file: string, dir: string): boolean {
  const f = file.toLowerCase()
  const d = dir.toLowerCase()
  return f === d || f.startsWith(d.endsWith(sep) ? d : d + sep)
}
