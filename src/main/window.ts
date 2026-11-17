import { app, BrowserWindow, screen } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WindowBounds } from '@shared/types'
import type { ConfigStore } from './config'
import type { Logger } from './logger'

/**
 * 窗口图标（任务栏 / Alt+Tab / 标题栏左上角）。
 * 开发态读仓库里的 build/icon.png；打包后读 resources/icon.png（M4 会配 extraResources）。
 * 找不到就返回 undefined，让 Electron 用默认图标，不报错。
 */
function resolveIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.png')]
    : [join(__dirname, '../../build/icon.png')]
  return candidates.find((p) => existsSync(p))
}

const DEFAULT_WIDTH = 1360
const DEFAULT_HEIGHT = 860
const MIN_WIDTH = 1040
const MIN_HEIGHT = 640

/** 校验上次的窗口位置是否还落在某块屏幕内，避免拔掉外接显示器后窗口飞到看不见的地方 */
function restoreBounds(saved: WindowBounds | null): WindowBounds {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false }
  }
  const width = Math.max(MIN_WIDTH, Math.round(saved.width))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height))
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return saved.x! < a.x + a.width && saved.x! + width > a.x && saved.y! < a.y + a.height && saved.y! + height > a.y
    })
    if (visible) return { x: saved.x, y: saved.y, width, height, maximized: saved.maximized }
  }
  return { width, height, maximized: saved.maximized }
}

export interface CreateWindowOptions {
  config: ConfigStore
  log: Logger
  /** 渲染进程入口（开发时为 dev server 地址） */
  rendererUrl?: string
}

/**
 * 创建主窗口。
 * 无边框 + 自定义标题栏。窗口**始终**是透明的，因为「桌面」背景模式需要看穿到壁纸；
 * 纯色与图片背景由页面自己画底色盖住，两者互不冲突。
 */
export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const { config, log, rendererUrl } = opts
  const bounds = restoreBounds(config.get<WindowBounds | null>('ui.windowBounds'))
  const icon = resolveIcon()
  // 不启用 backgroundMaterial：Windows 上它和 transparent 窗口互斥，
  // 同时开会让材质退化成一块不透明白底（实测纯蓝底图被画成 #FFFFFF）。
  // 玻璃的透明与质感全部由 CSS 变量控制，这样"完全透明"才真的透得干净。

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    ...(icon ? { icon } : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (bounds.maximized) win.maximize()

  win.once('ready-to-show', () => {
    win.show()
    log.info('window', `主窗口已显示（${bounds.width}×${bounds.height}，透明窗口=开）`)
  })

  // ---- 窗口几何持久化（防抖 600ms，避免拖拽过程中疯狂写盘）----
  let timer: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = win.getNormalBounds()
    config.set('ui.windowBounds', { x: b.x, y: b.y, width: b.width, height: b.height, maximized })
  }
  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveBounds()
    }, 600)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    saveBounds()
  })

  // ---- 页面加载 ----
  // SAIGUI_PAGE 供截图验收时直接落到指定页面（logs / settings 等）
  // SAIGUI_CROP 配合它用：直接把取景框打开到某个临时背景文件上，纯截图验收用
  const page = process.env['SAIGUI_PAGE']
  const cropProbe = process.env['SAIGUI_CROP']
  const query: Record<string, string> = {}
  if (page) query['page'] = page
  if (cropProbe) query['crop'] = cropProbe
  const hasQuery = Object.keys(query).length > 0
  if (rendererUrl) {
    const qs = new URLSearchParams(query).toString()
    void win.loadURL(hasQuery ? `${rendererUrl}?${qs}` : rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hasQuery ? { query } : undefined)
  }

  // 渲染进程崩溃要留痕，不能白屏了什么都不说
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('window', `渲染进程异常退出：${details.reason}（exitCode=${details.exitCode}）`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error('window', `页面加载失败：${code} ${desc} ${url}`)
  })

  // 调试用：SAIGUI_SHOT=<png 路径> 时，页面加载完自动截图并退出。
  // 用于在不盯着屏幕的情况下核对界面观感（M1 验收靠它出图）。
  // 配合 SAIGUI_SCROLL=<像素> 可先滚动内容区，便于核对折叠在下方的内容。
  const shotPath = process.env['SAIGUI_SHOT']
  if (shotPath) {
    const rawScroll = process.env['SAIGUI_SCROLL'] ?? '0'
    const scrollTop = rawScroll === 'bottom' ? Number.MAX_SAFE_INTEGER : Number(rawScroll) || 0
    // SAIGUI_CLICK=<css 选择器>：截图前先点一下（例如选中一张卡看详情面板）
    const clickSelector = process.env['SAIGUI_CLICK']
    // SAIGUI_PREP=<js>：截图前执行任意脚本，可返回 Promise（用于先筛出带标签的稿子）
    const prepScript = process.env['SAIGUI_PREP']
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        const scrolled =
          scrollTop > 0
            ? win.webContents.executeJavaScript(
                `(() => { const el = document.querySelector('.content'); if (el) el.scrollTop = ${scrollTop}; return true })()`
              )
            : Promise.resolve(true)
        void scrolled
          .then(async () => {
            if (prepScript) await win.webContents.executeJavaScript(prepScript)
            if (!clickSelector) return true
            await win.webContents.executeJavaScript(
              `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)}); if (el) el.click(); return !!el })()`
            )
            // 等详情面板的缩略图与标签渲染完
            await new Promise((r) => setTimeout(r, 350))
            return true
          })
          .then(() => win.webContents.capturePage())
          .then((img) => {
            writeFileSync(shotPath, img.toPNG())
            log.info('window', `已截图：${shotPath}`)
          })
          .catch((err: unknown) => log.warn('window', `截图失败：${String(err)}`))
          .finally(() => app.quit())
      }, 1400)
    })
  }

  // 调试用：SAIGUI_EVAL=<js 表达式> 时在页面里执行并打印结果后退出。
  // 用于核对 computed style 这类"肉眼看不出来"的问题（例如某个变量到底有没有生效）。
  const evalScript = process.env['SAIGUI_EVAL']
  if (evalScript) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        win.webContents
          .executeJavaScript(evalScript)
          .then((result: unknown) => log.info('window', `EVAL: ${JSON.stringify(result)}`))
          .catch((err: unknown) => log.warn('window', `EVAL 失败：${String(err)}`))
          .finally(() => app.quit())
      }, 1200)
    })
  }

  // 只滚动不截图：配合系统级截屏（capturePage 拍不到透明窗口的合成层）。
  // SAIGUI_SCROLL=bottom 滚到底，数字则按像素滚。
  const scrollOnly = process.env['SAIGUI_SCROLL']
  if (scrollOnly && !shotPath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        const js =
          scrollOnly === 'bottom'
            ? "(() => { const el = document.querySelector('.content'); if (el) el.scrollTop = 99999; return 'bottom' })()"
            : `(() => { const el = document.querySelector('.content'); if (el) el.scrollTop = ${Number(scrollOnly) || 0}; return 'ok' })()`
        void win.webContents.executeJavaScript(js).catch(() => undefined)
      }, 1400)
    })
  }

  return win
}
