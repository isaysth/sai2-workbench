import { app, BrowserWindow, screen } from 'electron'
import { basename } from 'node:path'
import { CH } from '@shared/channels'
import type { FileChangeEvent, RuntimeInfo } from '@shared/types'
import { ConfigStore } from './config'
import { AppDb } from './db'
import { FileStore } from './db/files'
import { MetaStore } from './db/meta'
import { FilesIndex } from './files'
import { registerAppIpc } from './ipc/app.ipc'
import { registerConfigIpc } from './ipc/config.ipc'
import { broadcastProgress, registerFilesIpc } from './ipc/files.ipc'
import { registerLogIpc } from './ipc/log.ipc'
import { registerOpenersIpc, spawnDetached } from './ipc/openers.ipc'
import { registerPluginsIpc } from './ipc/plugins.ipc'
import { registerTagsIpc } from './ipc/tags.ipc'
import { registerThemeIpc } from './ipc/theme.ipc'
import { broadcast } from './ipc/broadcast'
import { OpenersService } from './openers/service'
import { PluginSystem } from './plugins'
import { createElectronWindowFactory, registerPluginWindowIpc } from './plugins/window-factory'
import { PluginWatcher } from './plugins/watch'
import { Logger } from './logger'
import { resolvePaths } from './paths'
import { registerImageScheme, serveImageProtocol } from './protocol'
import { detectCapability, applyNativeTheme } from './theme'
import { ThemeService } from './theme/service'
import { ThumbService } from './thumbs'
import { imageProvider, psdProvider, sai2Provider } from './thumbs/providers'
import { createNativeTray } from './tray'
import { WindowManager } from './window-manager'
import { createMainWindow } from './window'

/** 启动序列（开发文档 §4.3）：路径 → 配置 → 日志 → 平台能力 → IPC → 窗口 */
async function bootstrap(): Promise<void> {
  const paths = resolvePaths()
  const isDev = !app.isPackaged
  const log = new Logger(paths.logDir, isDev)

  log.info('app', `sai2工作台启动 v${app.getVersion()}（${isDev ? '开发模式' : '正式版'}）`)
  log.info('app', `程序目录：${paths.rootDir}`)
  log.info('app', `数据目录：${paths.dataDir}（${paths.portable ? '便携模式' : '回退到用户目录'}）`)

  const config = new ConfigStore(paths.dataDir, log)

  // 调试用：SAIGUI_THEME=glass|minimal、SAIGUI_SCHEME=light|dark 时临时切外观，
  // 方便一次跑完整矩阵截图。只影响本次进程的观感，不改用户对"我选了什么"的语义。
  const shotTheme = process.env['SAIGUI_THEME']
  if (shotTheme === 'glass' || shotTheme === 'minimal') {
    config.set('general.theme', shotTheme)
    log.info('app', `按环境变量临时切换风格：${shotTheme}`)
  }
  const shotScheme = process.env['SAIGUI_SCHEME']
  if (shotScheme === 'light' || shotScheme === 'dark') {
    config.set('general.scheme', shotScheme)
    log.info('app', `按环境变量临时切换明暗：${shotScheme}`)
  }

  const cap = detectCapability()
  log.info('app', `系统版本 build=${cap.windowsBuild}（玻璃效果自绘，不依赖系统材质）`)

  const runtime: RuntimeInfo = {
    dataDir: paths.dataDir,
    pluginDir: paths.pluginDir,
    builtinPluginDir: paths.builtinPluginDir,
    portable: paths.portable,
    version: app.getVersion(),
    platform: process.platform,
    windowsBuild: cap.windowsBuild,
    acrylicSupported: cap.acrylicSupported,
    isDev
  }

  // 原生主题只影响系统对话框与窗口装饰的明暗，跟「玻璃 / 简约」无关
  applyNativeTheme(config.get<string>('general.scheme') ?? 'light')

  // 窗口管理器独立于插件存在：即使插件没激活，标题栏的窗口按钮也要能用。
  // 托盘、悬浮、最小化行为由 launcher-float 插件通过 configure 注入配置。
  const wm = new WindowManager({
    log,
    createTray: createNativeTray,
    workArea: () => screen.getPrimaryDisplay().workArea,
    broadcast: (channel, payload) => broadcast(channel, payload),
    quit: () => app.quit()
  })

  registerAppIpc(runtime, log, paths.backgroundDir, wm)
  registerConfigIpc(config, log)
  registerLogIpc(log)

  // 插件底座：基础 IPC 就绪后装配，索引 / 缩略图构造完再 provide，最后 initialize
  // 主题服务先建好，浮窗工厂注入时需要读它的变量表（延迟读取）
  const themeService = new ThemeService({
    log,
    onChange: () => broadcast(CH.themeChanged, themeService.getVars())
  })

  const plugins = new PluginSystem({
    log,
    config,
    paths,
    windowFactory: createElectronWindowFactory({
      log,
      isDev,
      themeVars: () => themeService.getVars()
    }),
    onChanged: () =>
      broadcast(CH.pluginChanged, {
        plugins: plugins.list(),
        pages: plugins.host.contributions.pages,
        actions: plugins.actions(),
        statuses: plugins.statuses()
      })
  })
  registerPluginsIpc({ plugins, log, pluginDir: paths.pluginDir })
  registerPluginWindowIpc(plugins.windows, log)

  // ---- 索引库 + 文件索引 + 缩略图 ----
  // 三者互相需要（索引要推事件、缩略图要回填索引、IPC 要两者），
  // 用一个可后置赋值的 sink 打断循环，比让它们彼此 import 干净。
  let changeSink: ((ev: FileChangeEvent) => void) | null = null

  // 索引库（M2b）：文件身份、标签、项目。损坏时自己备份重建，标签尽量抢救
  const db = new AppDb(paths.dbFile, log)
  const store = new FileStore(db)
  const meta = new MetaStore(db)

  // 30 天前就消失的行真删掉（级联清标签）。每次启动最多跑一次，几十毫秒
  try {
    const purged = store.purgeExpired(Date.now() - 30 * 86_400_000)
    if (purged > 0) log.info('db', `清理了 ${purged} 条 30 天前消失的文件记录`)
  } catch (err) {
    log.warn('db', `清理过期记录失败：${String(err)}`)
  }

  const index = new FilesIndex({
    log,
    store,
    onChange: (ev) => changeSink?.(ev),
    onProgress: (p) => broadcastProgress(p),
    settings: () => {
      const cfg = config.all()
      return {
        dirs: cfg.watch.dirs,
        extensions: cfg.watch.extensions,
        recursive: cfg.watch.recursive,
        debounceMs: cfg.watch.debounceMs,
        realtime: cfg.watch.mode === 'realtime',
        thumbVersion: cfg.cache.thumbVersion
      }
    }
  })

  const thumbs = new ThumbService({
    log,
    cacheDir: paths.thumbCacheDir,
    // SAIGUI_THUMB_MAX 只用于验收淘汰逻辑（把上限压到几 MB，几百张图就能触发）
    maxBytes: () => Number(process.env['SAIGUI_THUMB_MAX']) || config.all().cache.maxThumbBytes,
    onPatch: (path, thumb, canvas, cover) => {
      index.patchThumb(path, { state: thumb?.state ?? 'pending', reason: thumb?.reason, cover }, canvas)
      // 「封面」标记要送回渲染端才有角标可挂；这种情况很少，不必担心事件量
      if (cover) {
        const file = index.find(path)
        if (file) changeSink?.({ adds: [file] })
      }
    }
  })

  // 打开器注册表：插件声明规则，内核 spawn；事件转发给插件做联动
  const openers = new OpenersService({
    config,
    log,
    runner: spawnDetached,
    emit: (event, payload) => plugins.events.emit(event, payload)
  })
  plugins.provide('openers', openers)
  registerOpenersIpc({ openers, config, log })

  // 主题变量：插件贡献 CSS 变量，变化时推给渲染端即时生效（实例在插件底座前已建好）
  plugins.provide('theme', themeService)
  registerThemeIpc(themeService)

  // 把内核能力交给插件；provide 会唤醒所有 waiting 的插件
  plugins.provide('index', index)
  plugins.provide('thumbs', thumbs)
  // 解码算法留在内核；插件只负责 match 与注册，避免把 TS 产物路径写进 JS 插件
  plugins.provide('thumb-kernel', { imageProvider, psdProvider, sai2Provider })
  plugins.provide('meta', meta)
  plugins.provide('window-manager', wm)
  // 托盘菜单里的「启动 SAI2」走同一条打开器链路，路径校验与联动事件都不重复实现
  wm.setLaunchHandler(() => {
    void openers.launch().then((res) => {
      if (!res.ok) log.warn('window-manager', `托盘启动失败：${res.error ?? '未知原因'}`)
    })
  })

  const filesIpc = registerFilesIpc({ index, config, thumbs, log })
  changeSink = filesIpc.onChange
  registerTagsIpc({ meta, store, index, log })

  serveImageProtocol({
    backgroundDir: paths.backgroundDir,
    thumbCacheDir: paths.thumbCacheDir,
    log,
    thumbs,
    findByThumbKey: (key) => index.findByThumbKey(key)
  })

  // 监听规则 / 目录变了就重新对齐索引（增删目录走增量，规则变化走重扫）
  config.onDidChange((key) => {
    if (key.startsWith('watch.') || key === 'cache.thumbVersion') void index.apply()
    if (key === 'plugins.disabled') plugins.refresh()
  })

  // 秒开的关键：窗口建起来之前先把库里的行灌回内存（5000 条约 60ms），
  // 渲染端第一次拉列表就是完整结果，不用等 readdir + stat 扫完。
  index.hydrate()

  // 插件必须在窗口创建前激活完：它们可能注册页面、菜单或状态栏贡献点
  await plugins.initialize()

  // 开发模式热重载：改插件代码不用重启。正式版不挂监听，零开销。
  const pluginWatcher = isDev
    ? new PluginWatcher({
        log,
        dirs: [paths.builtinPluginDir, paths.pluginDir],
        reloadByDir: async (dirName) => {
          const hit = plugins.list().find((p) => basename(p.dir) === dirName)
          if (hit) await plugins.reload(hit.id)
        },
        rescan: () => plugins.rescan()
      })
    : null
  pluginWatcher?.start()

  // 后台再全量 stat 一遍，只把差异推给界面：文件在外面被改了、删了都能跟上
  void index.apply().then(() => {
    if (index.count() === 0 && config.all().watch.dirs.length === 0) {
      log.info('app', '还没有监听目录，等用户在设置里添加')
    }
  })

  // 退出前把待写队列刷干净、关掉索引库。will-quit 里必须 preventDefault 一次，
  // 否则 Electron 不会等异步收尾 —— 会留下 -wal 文件，甚至丢掉最后几条标签。
  let cleaned = false
  app.on('will-quit', (e) => {
    if (cleaned) return
    e.preventDefault()
    void index
      .stop()
      .catch(() => undefined)
      .then(async () => {
        pluginWatcher?.stop()
        await plugins.disposeAll().catch(() => undefined)
        log.info('app', '退出：插件已全部停用')
        wm.dispose()
        log.info('app', '退出：窗口管理器已释放')
        db.close()
        cleaned = true
        // 此时 will-quit 已被 preventDefault 过一次，再调 app.quit() 会被 Electron 忽略
        // （托盘存在时尤其明显）。清理已全部完成，直接 exit 保证进程真的退出。
        app.exit()
      })
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) log.info('app', `渲染进程开发服务器：${rendererUrl}`)

  const win = createMainWindow({ config, log, rendererUrl })
  wm.attach(win)

  // 任何来源的退出（托盘菜单、系统关机、EVAL 调试）都要先打标，
  // 否则 window-all-closed 会误以为这是「关窗口」而继续保活托盘进程。
  app.on('before-quit', () => wm.beginQuit())

  // 托盘存在时，关掉最后一个窗口不应退出进程（异常路径兜底）
  app.on('window-all-closed', () => {
    if (wm.shouldKeepAlive()) {
      log.info('app', '最后一个窗口已关闭，保留托盘进程')
      return
    }
    app.quit()
  })

  // 窗口始终透明，不再有"切主题要开关系统材质"这套逻辑；
  // 只剩一件事：明暗变化时把原生主题同步过去，系统右键菜单之类才不会反色。
  config.onDidChange((key, value) => {
    if (key !== 'general.scheme' || win.isDestroyed()) return
    applyNativeTheme(String(value))
  })

  log.info('app', '初始化完成')
}

// 自定义图片协议必须在 app ready 之前声明，之后再注册会被忽略（Electron 的硬性要求）
registerImageScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例在跑，直接把焦点让给它，不重复开第二个窗口
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

  process.on('uncaughtException', (err) => {
    console.error('[sai2工作台] 未捕获异常', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[sai2工作台] 未处理的 Promise 拒绝', reason)
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.sai2.workbench')
    return bootstrap()
  }).catch((err) => {
    console.error('[sai2工作台] 启动失败', err)
    app.quit()
  })
}
