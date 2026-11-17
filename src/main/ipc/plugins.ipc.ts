/**
 * 插件中心的 IPC：列表、装卸、启停、重载、配置读写。
 * zip 解压只允许相对路径，拒绝 ../ 与绝对路径穿越。
 */
import { dialog, ipcMain } from 'electron'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import yauzl from 'yauzl'
import { CH } from '@shared/channels'
import type { PluginResult } from '@shared/plugins'
import type { Logger } from '../logger'
import { readManifest } from '../plugins/manifest'
import type { PluginSystem } from '../plugins'

export interface PluginsIpcDeps {
  plugins: PluginSystem
  log: Logger
  pluginDir: string
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function safeZipName(name: string): boolean {
  if (!name || name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(name)) return false
  return !name.split(/[\\/]/).includes('..')
}

function extractZip(zipPath: string, targetDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('无法打开 zip 文件'))
        return
      }
      let done = false
      const finish = (failure?: Error): void => {
        if (done) return
        done = true
        zipFile.close()
        if (failure) reject(failure)
        else resolve()
      }
      zipFile.on('error', (e) => finish(e))
      zipFile.on('end', () => finish())
      zipFile.readEntry()
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (!safeZipName(entry.fileName)) {
          finish(new Error(`zip 内存在非法路径：${entry.fileName}`))
          return
        }
        const full = join(targetDir, entry.fileName)
        if (entry.fileName.endsWith('/')) {
          try {
            mkdirSync(full, { recursive: true })
            zipFile.readEntry()
          } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)))
          }
          return
        }
        zipFile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(streamErr ?? new Error(`读取 zip 条目失败：${entry.fileName}`))
            return
          }
          try {
            mkdirSync(dirname(full), { recursive: true })
          } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)))
            return
          }
          const out = createWriteStream(full)
          stream.on('error', (e) => finish(e))
          out.on('error', (e) => finish(e))
          out.on('finish', () => zipFile.readEntry())
          stream.pipe(out)
        })
      })
    })
  })
}

/** 找 zip 内的插件根目录（允许外面套一层文件夹） */
function findManifestDir(root: string, depth = 0): string | null {
  if (existsSync(join(root, 'plugin.json'))) return root
  if (depth >= 2) return null
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const found = findManifestDir(join(root, entry.name), depth + 1)
      if (found) return found
    }
  } catch {
    /* 目录读不了就当没找到 */
  }
  return null
}

/** 校验后复制到插件目录；返回新插件 id */
function installChecked(source: string, pluginDir: string): PluginResult & { id?: string } {
  const result = readManifest(source)
  if (!result.ok) return { ok: false, error: result.error }
  const id = result.value.manifest.id
  const dest = join(pluginDir, id)
  if (existsSync(dest)) return { ok: false, error: `插件 ${id} 已安装，请先卸载` }
  try {
    cpSync(source, dest, { recursive: true })
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: `安装失败：${messageOf(err)}` }
  }
}

export function registerPluginsIpc({ plugins, log, pluginDir }: PluginsIpcDeps): void {
  ipcMain.handle(CH.pluginList, () => ({
    plugins: plugins.list(),
    pages: plugins.host.contributions.pages,
    actions: plugins.actions(),
    statuses: plugins.statuses()
  }))

  ipcMain.handle(CH.pluginRunAction, async (_e, payload: { kind?: unknown; id?: unknown; path?: unknown }) => {
    const kind = payload?.kind === 'toolbar' ? 'toolbar' : 'file'
    if (typeof payload?.id !== 'string') return { ok: false, error: '动作 id 非法' }
    return plugins.runAction(kind, payload.id, typeof payload.path === 'string' ? payload.path : undefined)
  })

  ipcMain.handle(CH.pluginInstall, async (_e, mode: unknown): Promise<PluginResult & { id?: string }> => {
    const isZip = mode === 'zip'
    try {
      const opened = await dialog.showOpenDialog({
        title: isZip ? '选择插件 zip 包' : '选择插件目录（含 plugin.json）',
        properties: isZip ? ['openFile'] : ['openDirectory'],
        filters: isZip ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }] : []
      })
      if (opened.canceled || opened.filePaths.length === 0) return { ok: false, canceled: true }

      const source = opened.filePaths[0]!
      let id: string | undefined
      if (isZip) {
        const temp = mkdtempSync(join(tmpdir(), 'sai2-plugin-zip-'))
        try {
          await extractZip(source, temp)
          const pluginRoot = findManifestDir(temp)
          if (!pluginRoot) return { ok: false, error: 'zip 里找不到 plugin.json' }
          const result = installChecked(pluginRoot, pluginDir)
          if (!result.ok) return result
          id = result.id
        } finally {
          rmSync(temp, { recursive: true, force: true })
        }
      } else {
        const result = installChecked(source, pluginDir)
        if (!result.ok) return result
        id = result.id
      }

      await plugins.rescan()
      log.info('plugin', `已安装插件 ${id}`)
      return { ok: true, id }
    } catch (err) {
      log.error('plugin', `安装插件失败：${messageOf(err)}`)
      return { ok: false, error: `安装失败：${messageOf(err)}` }
    }
  })

  ipcMain.handle(CH.pluginUninstall, async (_e, id: unknown): Promise<PluginResult> => {
    if (typeof id !== 'string') return { ok: false, error: '插件 id 非法' }
    const result = await plugins.uninstall(id)
    if (result.ok) await plugins.rescan()
    return result
  })

  ipcMain.handle(CH.pluginSetEnabled, (_e, payload: { id?: unknown; enabled?: unknown }): PluginResult => {
    if (typeof payload?.id !== 'string' || typeof payload.enabled !== 'boolean') {
      return { ok: false, error: '参数非法' }
    }
    return plugins.setEnabled(payload.id, payload.enabled)
  })

  ipcMain.handle(CH.pluginReload, async (_e, id: unknown): Promise<PluginResult> => {
    if (typeof id !== 'string') return { ok: false, error: '插件 id 非法' }
    return plugins.reload(id)
  })

  ipcMain.handle(CH.pluginGetConfig, (_e, id: unknown): Record<string, unknown> => {
    return typeof id === 'string' ? plugins.getConfig(id) : {}
  })

  ipcMain.handle(CH.pluginSetConfig, async (_e, payload: { id?: unknown; value?: unknown }): Promise<PluginResult> => {
    if (typeof payload?.id !== 'string') return { ok: false, error: '插件 id 非法' }
    if (typeof payload.value !== 'object' || payload.value === null || Array.isArray(payload.value)) {
      return { ok: false, error: '配置必须是对象' }
    }
    const result = plugins.setConfig(payload.id, payload.value as Record<string, unknown>)
    // 插件 apply 时拿到的是配置对象的快照；保存后自动 reload 才能让新配置立即生效
    // （否则联动这类插件要用户手动点一次「重载」才读到新值）。
    if (result.ok) await plugins.reload(payload.id)
    return result
  })
}
