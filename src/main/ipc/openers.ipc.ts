/**
 * 打开器与文件选择 IPC。
 * 启动外部程序统一走 OpenersService：插件只声明规则，内核负责 spawn 与事件。
 */
import { spawn } from 'node:child_process'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { OpenerKey } from '@shared/types'
import type { ConfigStore } from '../config'
import type { Logger } from '../logger'
import { candidateRoots, findInstallCandidates } from '../openers/detect'
import type { OpenersService } from '../openers/service'

const EXE_FILTERS = [{ name: '可执行程序', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }]

function isOpenerKey(value: unknown): value is OpenerKey {
  return value === 'sai2' || value === 'ps' || value === 'csp'
}

export interface OpenersIpcDeps {
  openers: OpenersService
  config: ConfigStore
  log: Logger
}

export function registerOpenersIpc(deps: OpenersIpcDeps): void {
  const { openers, log } = deps

  ipcMain.handle(CH.appOpeners, () => openers.list())

  ipcMain.handle(CH.appLaunch, (_event, payload: unknown) => {
    const p = (payload ?? {}) as { file?: unknown }
    const file = typeof p.file === 'string' && p.file.trim() ? p.file : undefined
    return openers.launch(file)
  })

  ipcMain.handle(CH.appOpenWith, (_event, payload: unknown) => {
    const p = (payload ?? {}) as { path?: unknown; openerId?: unknown }
    if (typeof p.path !== 'string' || !p.path.trim()) return { ok: false, error: '文件路径无效' }
    return openers.launch(p.path, typeof p.openerId === 'string' ? p.openerId : undefined)
  })

  /**
   * 系统选择框。filter=exe 时选程序，dir 选目录，file 选任意文件。
   * 支持一次选多个 exe（联动插件的场景），返回路径数组。
   */
  ipcMain.handle(CH.appPickFile, async (event, payload: unknown) => {
    const p = (payload ?? {}) as { filter?: unknown; multi?: unknown }
    const filter = p.filter === 'dir' ? 'dir' : p.filter === 'file' ? 'file' : 'exe'
    const multi = p.multi === true
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: filter === 'dir' ? '选择文件夹' : '选择程序',
      properties: [filter === 'dir' ? 'openDirectory' : 'openFile'],
      filters: filter === 'exe' ? EXE_FILTERS : []
    }
    if (multi && filter !== 'dir') options.properties!.push('multiSelections')
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled) return { ok: false, canceled: true, paths: [] }
    return { ok: true, paths: picked.filePaths }
  })

  /**
   * 自动查找安装路径：从环境变量派生的常见根目录里按 exe 名找。
   * 查找本身不抛异常，这里再兜一层，保证渲染端永远拿到 {ok, paths}。
   */
  ipcMain.handle(CH.openersDetect, (_event, payload: unknown) => {
    const key: unknown = typeof payload === 'string' ? payload : (payload as { key?: unknown } | null)?.key
    if (!isOpenerKey(key)) return { ok: false, paths: [], error: '未知的打开器' }
    try {
      const paths = findInstallCandidates(key, candidateRoots())
      log.info('openers', `自动查找 ${key}：命中 ${paths.length} 个`)
      return { ok: true, paths }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log.warn('openers', `自动查找 ${key} 失败：${reason}`)
      return { ok: false, paths: [], error: '自动查找失败' }
    }
  })

  // 让插件也能拿到 spawn 能力：ctx.shell.launch 走这里，统一 detached + unref。
  // 不开 shell:true —— 参数数组直接交给 spawn，不经过命令行解释器，避免注入。
}

/** 真实 runner：detached + unref，关掉工作台不会连带关掉画图程序 */
export function spawnDetached(req: { exe: string; args: string[] }): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(req.exe, req.args, { detached: true, windowsHide: false, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    } catch (err) {
      reject(err)
    }
  })
}
