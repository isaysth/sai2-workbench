/**
 * 开发模式插件热重载（M3b T5.5）。
 * 监听插件目录：manifest / 新目录变化 → 全量 rescan；entry / config 变化 → 单插件 reload。
 * 200ms debounce 合并编辑器的一连串写盘。正式版完全不挂监听，零开销。
 */
import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import type { Logger } from '../logger'

export interface PluginWatchDeps {
  log: Logger
  dirs: string[]
  /** 插件目录名 → 插件 id（通常一致；不一致时由主进程传入映射） */
  reloadByDir: (dirName: string) => Promise<void>
  rescan: () => Promise<void>
}

export class PluginWatcher {
  private watchers: FSWatcher[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  /** 累积本轮变化：目录层（需要 rescan）与具体插件目录（可单 reload） */
  private needRescan = false
  private changedDirs = new Set<string>()

  constructor(private readonly deps: PluginWatchDeps) {}

  start(): void {
    for (const dir of this.deps.dirs) {
      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return
          this.onChange(filename)
        })
        w.on('error', (err) => this.deps.log.warn('plugin', `热重载监听失败 ${dir}：${String(err)}`))
        this.watchers.push(w)
        this.deps.log.info('plugin', `热重载已启动：${dir}`)
      } catch (err) {
        this.deps.log.warn('plugin', `无法监听插件目录 ${dir}：${String(err)}`)
      }
    }
  }

  private onChange(filename: string): void {
    const parts = filename.split(/[\\/]/)
    const changedDir = parts[0] ?? ''
    // plugin.json 变化或新插件目录出现 → 全量重扫（可能 id / manifest 都变了）
    if (parts.length === 1 || basename(filename).toLowerCase() === 'plugin.json') {
      this.needRescan = true
    } else if (changedDir) {
      this.changedDirs.add(changedDir)
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 200)
  }

  private async flush(): Promise<void> {
    this.timer = null
    const rescan = this.needRescan
    const dirs = [...this.changedDirs]
    this.needRescan = false
    this.changedDirs.clear()
    try {
      if (rescan) {
        await this.deps.rescan()
        this.deps.log.info('plugin', '热重载：已重新发现插件')
      } else {
        for (const dir of dirs) await this.deps.reloadByDir(dir)
        if (dirs.length > 0) this.deps.log.info('plugin', `热重载：${dirs.join('、')}`)
      }
    } catch (err) {
      this.deps.log.warn('plugin', `热重载失败：${String(err)}`)
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* 关不掉也无所谓，进程退出时系统回收 */
      }
    }
    this.watchers = []
  }
}
