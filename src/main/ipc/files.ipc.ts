import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { CH } from '@shared/channels'
import type { FileChangeEvent, IndexProgress, ProjectFile } from '@shared/types'
import type { ConfigStore } from '../config'
import type { FilesIndex } from '../files'
import type { Logger } from '../logger'
import type { ThumbService } from '../thumbs'
import { broadcast } from './broadcast'

/**
 * 文件域 IPC。
 *
 * 这里唯一有技术含量的东西是**变更合并**：一次复制 500 个文件进来，watcher 会吐
 * 几百个事件，每个都推一次的话渲染端要重排几百次（React 每次 commit 都在算瀑布流
 * 位置），界面直接卡死。所以攒 120ms 再推一批。
 *
 * 120ms 是手感与延迟的折中：低于 100ms 基本等于没合并，高于 200ms 用户会觉得
 * "丢进去半天才出来"。
 */

const COALESCE_MS = 120

class ChangePump {
  private adds = new Map<string, ProjectFile>()
  private removes = new Set<string>()
  private reset = false
  private timer: NodeJS.Timeout | null = null

  push(ev: FileChangeEvent): void {
    if (ev.reset) {
      // reset 的语义是"清空重排"，之前攒的增删都作废
      this.reset = true
      this.adds.clear()
      this.removes.clear()
    }
    for (const item of ev.adds ?? []) {
      this.removes.delete(item.path)
      this.adds.set(item.path, item)
    }
    for (const path of ev.removes ?? []) {
      this.adds.delete(path)
      this.removes.add(path)
    }
    if (!this.timer) this.timer = setTimeout(() => this.flush(), COALESCE_MS)
  }

  private flush(): void {
    this.timer = null
    if (!this.reset && this.adds.size === 0 && this.removes.size === 0) return
    const payload: FileChangeEvent = {}
    if (this.reset) payload.reset = true
    if (this.adds.size > 0) payload.adds = [...this.adds.values()]
    if (this.removes.size > 0) payload.removes = [...this.removes]
    this.reset = false
    this.adds.clear()
    this.removes.clear()
    broadcast(CH.filesChanged, payload)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export interface FilesIpcDeps {
  index: FilesIndex
  config: ConfigStore
  thumbs: ThumbService
  log: Logger
}

export function registerFilesIpc(deps: FilesIpcDeps): { onChange: (ev: FileChangeEvent) => void; dispose: () => void } {
  const { index, config, thumbs, log } = deps
  const pump = new ChangePump()

  // ---------------- 列表 ----------------

  ipcMain.handle(CH.filesList, (_event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
    const num = (v: unknown): number | undefined => (Number.isFinite(Number(v)) ? Number(v) : undefined)
    return index.list({
      dir: str(p['dir']),
      keyword: str(p['keyword']),
      limit: num(p['limit']),
      offset: num(p['offset'])
    })
  })

  // ---------------- 监听目录 ----------------

  ipcMain.handle(CH.filesAddDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '选择要监听的文件夹',
      buttonLabel: '添加监听',
      properties: ['openDirectory' as const, 'multiSelections' as const]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }

    const current = config.get<string[]>('watch.dirs') ?? []
    const lower = new Set(current.map((d) => d.toLowerCase()))
    const added = picked.filePaths.filter((d) => !lower.has(d.toLowerCase()))
    if (added.length === 0) return { ok: true, added: 0, message: '这些目录已经在监听列表里了' }

    config.set('watch.dirs', [...current, ...added])
    log.info('files', `新增监听目录：${added.join(' | ')}`)
    return { ok: true, added: added.length, dirs: added }
  })

  ipcMain.handle(CH.filesRemoveDir, (_event, dir: unknown) => {
    if (typeof dir !== 'string' || dir.length === 0) return { ok: false, error: '目录无效' }
    const current = config.get<string[]>('watch.dirs') ?? []
    const next = current.filter((d) => d.toLowerCase() !== dir.toLowerCase())
    if (next.length === current.length) return { ok: false, error: '该目录不在监听列表里' }
    config.set('watch.dirs', next)
    log.info('files', `移除监听目录：${dir}`)
    return { ok: true }
  })

  // 刷新按钮可能被连点，或者设置页与文件页同时触发。两次 fullScan 并发写同一张
  // Map 会互相覆盖，所以这里串行化：第二次直接复用第一次的结果。
  let rescanning = false
  ipcMain.handle(CH.filesRescan, async () => {
    if (rescanning) return { ok: true, total: index.count(), already: true }
    rescanning = true
    try {
      log.info('files', '手动刷新：全量重扫')
      await index.apply(true)
      return { ok: true, total: index.count() }
    } finally {
      rescanning = false
    }
  })

  ipcMain.handle(CH.filesReveal, (_event, path: unknown) => {
    if (typeof path !== 'string') return { ok: false }
    const file = index.find(path)
    if (!file) return { ok: false, error: '文件已不在索引里' }
    if (!existsSync(file.path)) return { ok: false, error: '文件已被删除' }
    shell.showItemInFolder(file.path)
    return { ok: true }
  })

  // ---------------- 缓存 ----------------

  ipcMain.handle(CH.thumbsStats, async () => thumbs.stats())

  ipcMain.handle(CH.thumbsClear, async () => {
    const res = await thumbs.clear()
    // 版本号 +1 让所有旧键失效：否则内存里残留的"已生成"判断会让卡片继续请求空文件
    const version = Number(config.get('cache.thumbVersion')) || 1
    config.set('cache.thumbVersion', version + 1)
    await index.apply()
    return { ok: true, ...res }
  })

  return {
    onChange: (ev: FileChangeEvent) => pump.push(ev),
    dispose: () => pump.dispose()
  }
}

/** 进度直接透传（索引层已按 120ms 节流） */
export function broadcastProgress(p: IndexProgress): void {
  broadcast(CH.filesProgress, p)
}
