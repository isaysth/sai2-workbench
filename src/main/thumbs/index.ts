import { existsSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ProjectFile, ThumbCacheStats } from '@shared/types'
import type { Logger } from '../logger'
import { PSD_WORKER_THRESHOLD, THUMB_CONCURRENCY, THUMB_TIMEOUT_MS } from './consts'
import { findCover, imageProvider, type ThumbOutput, type ThumbProvider } from './providers'

/**
 * 缩略图调度与缓存。
 *
 * 三层缓存，命中从快到慢：
 *   1. 内存 Map（key → 结果），同一个键在本进程内只解一次
 *   2. 磁盘 `data/cache/thumbs/<key>.jpg|png`，重启不重解
 *   3. 失败标记 `<key>.fail`，坏文件不会被反复重试（滚动时最容易踩这个坑）
 *
 * 缓存键里带 size + mtime，所以"用户在 SAI2 里覆盖保存"会自动失效 ——
 * 这点比"只在文件名变化时刷新"重要得多。
 */

export type ThumbResult =
  | { kind: 'file'; name: string; format: 'jpg' | 'png' }
  | { kind: 'original'; path: string }
  | { kind: 'fail'; reason: string }

export interface ThumbServiceDeps {
  log: Logger
  cacheDir: string
  maxBytes: () => number
  /**
   * 生成完成后回填索引（画布尺寸 / 状态），让信息卡与列表拿到最新信息。
   * `cover=true` 表示这张预览是用同名图片兜的 —— 卡片上要挂「封面」角标。
   */
  onPatch: (
    path: string,
    thumb: ProjectFile['thumb'],
    canvas?: { width: number; height: number },
    cover?: boolean
  ) => void
}

/** produce/persist 的共用返回形状 */
type ProduceResult =
  | { kind: 'ok'; result: ThumbResult; canvas?: { width: number; height: number }; viaCover: boolean }
  | { kind: 'fail'; reason: string }

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`解码超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

export class ThumbService {
  private memory = new Map<string, ThumbResult>()
  private inflight = new Map<string, Promise<ThumbResult>>()
  private active = 0
  private waiters: Array<() => void> = []

  /** -1 = 还没扫过目录，第一次用到时统计 */
  private cacheBytes = -1
  private cacheFiles = 0
  private failureFiles = 0
  private writesSinceCheck = 0
  private readonly workerPath = join(__dirname, 'thumb.worker.js')

  /** 提供者注册表：内置插件在 apply 时注册，禁用插件就少一个提供者 */
  private readonly providers: ThumbProvider[] = []

  constructor(private readonly deps: ThumbServiceDeps) {}

  /** 插件注册缩略图提供者；同 id 覆盖，保证重载不会重复 */
  registerProvider(provider: ThumbProvider): void {
    if (typeof provider?.id !== 'string' || typeof provider.match !== 'function' || typeof provider.resolve !== 'function') {
      this.deps.log.warn('thumbs', '插件注册了无效的缩略图提供者，已忽略')
      return
    }
    const index = this.providers.findIndex((p) => p.id === provider.id)
    if (index >= 0) this.providers[index] = provider
    else this.providers.push(provider)
    this.deps.log.info('thumbs', `已注册缩略图提供者：${provider.id}`)
  }

  private providerFor(ext: string): ThumbProvider | undefined {
    return this.providers.find((p) => p.match(ext))
  }

  // ---------------------------------------------------------------- 查询入口

  async get(file: ProjectFile): Promise<ThumbResult> {
    const key = file.thumbKey
    if (!key) return { kind: 'fail', reason: '缺少缓存键' }

    const hit = this.memory.get(key)
    if (hit) return hit

    const onDisk = this.findCached(key)
    if (onDisk) {
      const result: ThumbResult = { kind: 'file', name: onDisk.name, format: onDisk.format }
      this.memory.set(key, result)
      this.deps.onPatch(file.path, { state: 'ready' })
      return result
    }

    const failPath = join(this.deps.cacheDir, `${key}.fail`)
    if (existsSync(failPath)) {
      const reason = await this.readFail(failPath)
      const result: ThumbResult = { kind: 'fail', reason }
      this.memory.set(key, result)
      this.deps.onPatch(file.path, { state: 'fail', reason })
      return result
    }

    const running = this.inflight.get(key)
    if (running) return running

    const task = this.generate(file, key).finally(() => this.inflight.delete(key))
    this.inflight.set(key, task)
    return task
  }

  private findCached(key: string): { name: string; format: 'jpg' | 'png' } | null {
    for (const format of ['jpg', 'png'] as const) {
      const name = `${key}.${format}`
      if (existsSync(join(this.deps.cacheDir, name))) return { name, format }
    }
    return null
  }

  private async readFail(path: string): Promise<string> {
    try {
      const text = await fsp.readFile(path, 'utf8')
      return text.trim() || '无法生成缩略图'
    } catch {
      return '无法生成缩略图'
    }
  }

  // ---------------------------------------------------------------- 生成

  private async generate(file: ProjectFile, key: string): Promise<ThumbResult> {
    await this.acquire()
    try {
      const produced = await withTimeout(this.produce(file), THUMB_TIMEOUT_MS)
      if (produced.kind === 'fail') {
        await this.recordFailure(key, produced.reason)
        this.deps.onPatch(file.path, { state: 'fail', reason: produced.reason })
        this.deps.log.debug('thumbs', `${basename(file.path)}：${produced.reason}`)
        return produced
      }
      this.deps.onPatch(file.path, { state: 'ready' }, produced.canvas, produced.viaCover)
      return produced.result
    } catch (err) {
      const reason = err instanceof TimeoutError ? '解码超时' : `解码失败：${String(err)}`
      await this.recordFailure(key, reason)
      this.deps.onPatch(file.path, { state: 'fail', reason })
      this.deps.log.warn('thumbs', `${basename(file.path)}：${reason}`)
      return { kind: 'fail', reason }
    } finally {
      this.release()
    }
  }

  private async produce(file: ProjectFile): Promise<ProduceResult> {
    const provider = this.providerFor(file.ext)

    // 1. 原生解码
    if (provider) {
      try {
        // 大 PSD 走 worker：按扩展名判断，不再依赖插件给 provider 起的 id
        const bigPsd = (file.ext === '.psd' || file.ext === '.psb') && file.size > PSD_WORKER_THRESHOLD
        const out = bigPsd ? await this.resolveInWorker(file) : await provider.resolve(file)
        if (out === 'passthrough') {
          return { kind: 'ok', result: { kind: 'original', path: file.path }, viaCover: false }
        }
        if (out) return await this.persist(file, out, false)
      } catch (err) {
        // 单个提供者失败只记 debug，接着试封面（不允许冒泡到 UI）
        this.deps.log.debug('thumbs', `${basename(file.path)} 解码失败：${String(err)}`)
      }
    }

    // 2. 同名图片当封面
    const cover = await findCover(file)
    if (cover) {
      try {
        const out = await imageProvider.resolve({
          ...file,
          path: cover,
          name: basename(cover),
          ext: extname(cover).toLowerCase()
        })
        if (out && out !== 'passthrough') {
          const saved = await this.persist(file, out, true)
          return saved.kind === 'ok' ? { ...saved, viaCover: true } : saved
        }
      } catch {
        /* 封面也读不了就继续降级 */
      }
    }

    // 3. 信息卡
    return { kind: 'fail', reason: provider ? '没有可用的预览图' : `暂不支持 .${file.ext.replace('.', '')} 的预览` }
  }

  private async persist(file: ProjectFile, out: ThumbOutput, cover: boolean): Promise<ProduceResult> {
    const key = file.thumbKey!
    const name = `${key}.${out.format}`
    const full = join(this.deps.cacheDir, name)
    try {
      await fsp.writeFile(full, out.bytes)
      this.cacheBytes = Math.max(0, this.cacheBytes) + out.bytes.length
      this.cacheFiles += 1
      this.memory.set(key, { kind: 'file', name, format: out.format })
      this.writesSinceCheck += 1
      if (this.writesSinceCheck >= 40) {
        this.writesSinceCheck = 0
        void this.enforceLimit()
      }
      return {
        kind: 'ok',
        result: { kind: 'file', name, format: out.format },
        canvas: out.canvas,
        viaCover: cover
      }
    } catch (err) {
      return { kind: 'fail', reason: `缓存写入失败：${String(err)}` }
    }
  }

  /** 大 PSD：丢 worker，主进程只等结果 */
  private async resolveInWorker(file: ProjectFile): Promise<ThumbOutput> {
    if (!existsSync(this.workerPath)) {
      // 构建产物里没有 worker（例如打包漏了），退回进程内解码 —— 慢但不至于没图
      this.deps.log.warn('thumbs', 'thumb.worker.js 不存在，PSD 退回主进程解码')
      const { decodePsdBuffer } = await import('./psd')
      const buf = await fsp.readFile(file.path)
      const thumb = decodePsdBuffer(buf)
      return { bytes: thumb.png, format: 'png', canvas: { width: thumb.width, height: thumb.height } }
    }

    return new Promise<ThumbOutput>((resolve, reject) => {
      const worker = new Worker(this.workerPath, { workerData: { path: file.path } })
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
        void worker.terminate()
      }
      worker.once('message', (msg: { ok: boolean; png?: Uint8Array; width?: number; height?: number; error?: string }) => {
        if (msg.ok && msg.png) {
          finish(() =>
            resolve({
              bytes: msg.png!,
              format: 'png',
              canvas: { width: msg.width ?? 0, height: msg.height ?? 0 }
            })
          )
        } else {
          finish(() => reject(new Error(msg.error ?? 'worker 解码失败')))
        }
      })
      worker.once('error', (err) => finish(() => reject(err)))
      worker.once('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error(`worker 退出码 ${code}`)))
      })
    })
  }

  private async recordFailure(key: string, reason: string): Promise<void> {
    const path = join(this.deps.cacheDir, `${key}.fail`)
    try {
      await fsp.writeFile(path, reason, 'utf8')
      this.failureFiles += 1
      this.cacheBytes = Math.max(0, this.cacheBytes) + Buffer.byteLength(reason)
      this.memory.set(key, { kind: 'fail', reason })
    } catch {
      /* 写不进失败标记也不影响本次返回 */
    }
  }

  // ---------------------------------------------------------------- 并发池

  private acquire(): Promise<void> {
    if (this.active < THUMB_CONCURRENCY) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    const next = this.waiters.shift()
    if (next) next()
  }

  // ---------------------------------------------------------------- 缓存管理

  private async ensureScanned(): Promise<void> {
    if (this.cacheBytes >= 0) return
    let bytes = 0
    let files = 0
    let failures = 0
    try {
      const entries = await fsp.readdir(this.deps.cacheDir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        try {
          const st = await fsp.stat(join(this.deps.cacheDir, e.name))
          bytes += st.size
          if (e.name.endsWith('.fail')) failures += 1
          else files += 1
        } catch {
          /* 正在被删 */
        }
      }
    } catch {
      /* 目录不存在：按空处理 */
    }
    this.cacheBytes = bytes
    this.cacheFiles = files
    this.failureFiles = failures
  }

  async stats(): Promise<ThumbCacheStats> {
    await this.ensureScanned()
    return {
      bytes: this.cacheBytes,
      files: this.cacheFiles,
      failures: this.failureFiles,
      maxBytes: this.deps.maxBytes()
    }
  }

  /**
   * 超上限就按 mtime 淘汰最旧的，删到 90% 为止。
   * 不做 index.json 记账：几万个文件的目录重扫一次也就几百毫秒，
   * 而维护一份索引会引入"索引与磁盘不一致"这种更难查的问题。
   */
  async enforceLimit(): Promise<void> {
    await this.ensureScanned()
    const max = this.deps.maxBytes()
    if (this.cacheBytes <= max) return

    const target = Math.floor(max * 0.9)
    let removed = 0
    let freed = 0
    try {
      const entries = await fsp.readdir(this.deps.cacheDir, { withFileTypes: true })
      const list: Array<{ name: string; size: number; mtimeMs: number }> = []
      for (const e of entries) {
        if (!e.isFile()) continue
        try {
          const st = await fsp.stat(join(this.deps.cacheDir, e.name))
          list.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs })
        } catch {
          /* 忽略 */
        }
      }
      list.sort((a, b) => a.mtimeMs - b.mtimeMs)
      let bytes = this.cacheBytes
      for (const item of list) {
        if (bytes <= target) break
        try {
          await fsp.rm(join(this.deps.cacheDir, item.name), { force: true })
          bytes -= item.size
          freed += item.size
          removed += 1
          if (item.name.endsWith('.fail')) this.failureFiles -= 1
          else this.cacheFiles -= 1
        } catch {
          /* 文件正被读取，跳过 */
        }
      }
      this.cacheBytes = Math.max(0, bytes)
      if (removed > 0) {
        this.deps.log.info(
          'thumbs',
          `缩略图缓存超限，已清理 ${removed} 个文件（释放 ${(freed / 1024 / 1024).toFixed(1)}MB）`
        )
      }
    } catch (err) {
      this.deps.log.warn('thumbs', `清理缓存失败：${String(err)}`)
    }
  }

  /** 清空缓存。调用方负责递增 thumbVersion 并让列表重新请求。 */
  async clear(): Promise<{ removed: number; freed: number }> {
    let removed = 0
    let freed = 0
    try {
      const entries = await fsp.readdir(this.deps.cacheDir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        const full = join(this.deps.cacheDir, e.name)
        try {
          const st = await fsp.stat(full)
          await fsp.rm(full, { force: true })
          removed += 1
          freed += st.size
        } catch {
          /* 忽略单个失败 */
        }
      }
    } catch {
      /* 目录不存在 */
    }
    this.memory.clear()
    this.cacheBytes = 0
    this.cacheFiles = 0
    this.failureFiles = 0
    this.deps.log.info('thumbs', `缩略图缓存已清空：${removed} 个文件，${(freed / 1024 / 1024).toFixed(1)}MB`)
    return { removed, freed }
  }
}
