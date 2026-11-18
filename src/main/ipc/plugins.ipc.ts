/**
 * 插件中心的 IPC：列表、装卸、启停、重载、配置读写。
 * zip 解压只允许相对路径，拒绝 ../ 与绝对路径穿越。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import yauzl from 'yauzl'
import { CH } from '@shared/channels'
import type { PluginResult } from '@shared/plugins'
import type { Logger } from '../logger'
import { readManifest } from '../plugins/manifest'
import { pickPromptableZips, scanZipDir, validateZipPath } from '../plugins/zip-discovery'
import { broadcast } from './broadcast'
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

/** 把一个已解压好的插件目录校验后复制到插件目录；返回新插件 id */
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

/** 解压一个 zip 到临时目录并安装；两条安装路径共用的核心，避免重复造轮子 */
async function installZipCore(zipPath: string, pluginDir: string): Promise<PluginResult & { id?: string }> {
  const temp = mkdtempSync(join(tmpdir(), 'sai2-plugin-zip-'))
  try {
    await extractZip(zipPath, temp)
    const pluginRoot = findManifestDir(temp)
    if (!pluginRoot) return { ok: false, error: 'zip 里找不到 plugin.json' }
    return installChecked(pluginRoot, pluginDir)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/**
 * 插件目录 zip 发现服务：启动扫一次 + 显式刷新扫一次 + fs.watch 新增时扫一次。
 * 只看一层 *.zip，200ms 防抖；本次会话已提示 / 已忽略的不再提示。
 * 与 dev 热重载 watcher 完全独立，不改它的语义。
 */
function createZipFinder(pluginDir: string, plugins: PluginSystem, log: Logger): () => void {
  // 本次会话已提示过的 zip（含用户点「暂不安装」的），防止重复弹窗
  const seen = new Set<string>()
  let debounce: ReturnType<typeof setTimeout> | null = null

  const scan = (): void => {
    // 没有可接收的窗口时不标记、不广播，留到页面加载后的显式扫描再提示
    if (BrowserWindow.getAllWindows().every((w) => w.isDestroyed())) return
    const candidates = scanZipDir(pluginDir)
    const installedIds = new Set(plugins.list().map((p) => p.id))
    const promptable = pickPromptableZips(candidates, installedIds, seen)
    if (promptable.length === 0) return
    for (const c of promptable) seen.add(c.path)
    const paths = promptable.map((c) => c.path)
    log.info('plugin', `发现 ${paths.length} 个插件安装包：${promptable.map((c) => c.name).join('、')}`)
    broadcast(CH.pluginZipFound, paths)
  }

  const refresh = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(scan, 200)
  }

  // 目录不存在时先建好，否则 fs.watch 会抛错（首次启动 / 用户删了目录的场景）
  try {
    if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true })
    watch(pluginDir, () => refresh())
  } catch (err) {
    log.warn('plugin', `监听插件目录失败，zip 自动发现不可用：${messageOf(err)}`)
  }
  refresh() // 启动扫一次

  // 返回显式刷新入口（供「刷新」按钮 / 页面加载调用），watcher 随应用生命周期存活
  return refresh
}

export function registerPluginsIpc({ plugins, log, pluginDir }: PluginsIpcDeps): void {
  const refreshZipFinder = createZipFinder(pluginDir, plugins, log)

  ipcMain.handle(CH.pluginList, () => {
    refreshZipFinder() // 页面加载 / 刷新时扫一次插件目录里的新 zip
    return {
      plugins: plugins.list(),
      pages: plugins.host.contributions.pages,
      actions: plugins.actions(),
      statuses: plugins.statuses()
    }
  })

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
        // 从系统选择框选的 zip 可能在任意目录，这里不做「必须在 pluginDir 内」限制
        const result = await installZipCore(source, pluginDir)
        if (!result.ok) return result
        id = result.id
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

  /** 打开固定插件目录：无入参，路径锁死为 pluginDir，不接受渲染端任意路径 */
  ipcMain.handle(CH.pluginOpenDir, async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true })
      const result = await shell.openPath(pluginDir)
      // openPath 返回空串表示成功，非空是系统错误文案
      return result ? { ok: false, error: `打开插件目录失败：${result}` } : { ok: true }
    } catch (err) {
      log.error('plugin', `打开插件目录失败：${messageOf(err)}`)
      return { ok: false, error: `打开插件目录失败：${messageOf(err)}` }
    }
  })

  /** 按给定 zip 路径安装：路径必须在 pluginDir 内，复用 zip 安装核心 */
  ipcMain.handle(CH.pluginInstallZipPath, async (_e, zipPath: unknown): Promise<PluginResult & { id?: string }> => {
    if (typeof zipPath !== 'string') return { ok: false, error: 'zip 路径非法' }
    const problem = validateZipPath(zipPath, pluginDir)
    if (problem) return { ok: false, error: problem }
    try {
      const result = await installZipCore(zipPath, pluginDir)
      if (!result.ok) return result
      await plugins.rescan()
      refreshZipFinder()
      log.info('plugin', `已安装插件 ${result.id}（来自 ${zipPath}）`)
      return result
    } catch (err) {
      log.error('plugin', `按路径安装 zip 失败：${messageOf(err)}`)
      return { ok: false, error: `安装失败：${messageOf(err)}` }
    }
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
