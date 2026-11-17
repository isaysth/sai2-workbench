import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import type { AppConfig, OpenerView, RuntimeInfo } from '@shared/types'
import type { PluginPageContribution } from '@shared/plugins'
import { DetailsPanel } from './components/DetailsPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { FilesPage } from './pages/FilesPage'
import { LaunchPage } from './pages/LaunchPage'
import { LogPage } from './pages/LogPage'
import { PluginPage } from './pages/PluginPage'
import { SettingsPage } from './pages/SettingsPage'
import { useFiles } from './store/files'
import { useMeta } from './store/meta'
import { usePlugins } from './store/plugins'
import { useUi } from './store/ui'
import type { PageKey } from './store/ui'

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 页面注册表：内置页与插件页走同一套渲染入口，Sidebar 也从这里取项目 */
interface PageRenderCtx {
  runtime: RuntimeInfo
  config: AppConfig
  goto: (page: PageKey) => void
  toast: (message: string) => void
  updateConfig: (key: string, value: unknown) => Promise<void>
  openers: OpenerView[]
  doLaunch: (file?: string) => void
  refreshOpeners: () => void
}

const BUILTIN_PAGES: Record<string, (ctx: PageRenderCtx) => ReactElement> = {
  launch: ({ runtime, config, goto, toast, openers, doLaunch }) => (
    <LaunchPage runtime={runtime} config={config} goto={goto} toast={toast} openers={openers} onLaunch={doLaunch} />
  ),
  files: ({ config, goto, toast }) => <FilesPage goto={goto} config={config} toast={toast} />,
  logs: ({ toast }) => <LogPage onToast={toast} />,
  plugins: ({ toast }) => <PluginPage onToast={toast} />,
  settings: ({ runtime, config, updateConfig, toast, openers, refreshOpeners }) => (
    <SettingsPage
      runtime={runtime}
      config={config}
      updateConfig={updateConfig}
      toast={toast}
      openers={openers}
      refreshOpeners={refreshOpeners}
    />
  )
}

function pluginPageKey(page: PluginPageContribution): string {
  return `plugin:${page.pluginId}:${page.id}`
}

/** 内置页优先；找不到就按插件贡献的页面渲染一个隔离的 iframe */
function renderPage(
  page: PageKey,
  ctx: PageRenderCtx,
  pluginPages: PluginPageContribution[]
): ReactElement {
  const builtin = BUILTIN_PAGES[page]
  if (builtin) return builtin(ctx)

  const contributed = pluginPages.find((p) => pluginPageKey(p) === page)
  if (contributed) {
    return (
      <div className="page">
        <div className="page-head">
          <h1 className="page-title">{contributed.title}</h1>
        </div>
        <iframe
          className="plugin-page-frame"
          title={contributed.title}
          sandbox="allow-scripts"
          srcDoc={contributed.html ?? ''}
        />
      </div>
    )
  }
  return (
    <div className="empty">
      <div className="empty-title">页面不存在</div>
      <div className="empty-desc">提供这个页面的插件可能已被禁用或卸载。</div>
    </div>
  )
}

export default function App(): ReactElement {
  const runtime = useUi((s) => s.runtime)
  const config = useUi((s) => s.config)
  const page = useUi((s) => s.page)
  const leftWidth = useUi((s) => s.leftWidth)
  const rightWidth = useUi((s) => s.rightWidth)
  const toastText = useUi((s) => s.toast)
  const start = useUi((s) => s.start)
  const setPage = useUi((s) => s.setPage)
  const setLeftWidth = useUi((s) => s.setLeftWidth)
  const setRightWidth = useUi((s) => s.setRightWidth)
  const persistWidth = useUi((s) => s.persistWidth)
  const updateConfig = useUi((s) => s.updateConfig)
  const showToast = useUi((s) => s.showToast)
  const fileTotal = useFiles((s) => s.total)
  const selectedPath = useFiles((s) => s.selected)
  const pluginPages = usePlugins((s) => s.pages)
  const pluginStatuses = usePlugins((s) => s.statuses)
  const [openers, setOpeners] = useState<OpenerView[]>([])
  const [themeVars, setThemeVars] = useState<Record<string, string>>({})
  const appliedThemeVars = useRef<Set<string>>(new Set())
  // 详情面板要的那一份：优先从筛选结果里找，找不到再回全量（选中项恰好被筛掉的瞬间）
  const selectedFile = useFiles(
    (s) => s.visible.find((f) => f.path === s.selected) ?? s.items.find((f) => f.path === s.selected) ?? null
  )

  useEffect(() => {
    void start()
    // 文件索引在 App 级别订阅：切页面时不该断（否则回来要重扫一遍列表）
    void useFiles.getState().init()
    // 标签池 / 项目池一次拉全量，后面都靠增量 patch
    void useMeta.getState().load()
    // 插件状态与动态页面由主进程推送
    usePlugins.getState().init()
    // 打开器列表：侧栏文案与「是否已配置」都从注册表取，不再硬编码
    void window.api.openers().then(setOpeners)
    // 主题变量：一次性拉当前值，之后插件改动走事件
    void window.api.theme.get().then(setThemeVars)
    const offTheme = window.api.theme.onChanged(setThemeVars)
    return offTheme
  }, [start])

  // 外观落地：三个 dataset + 两个变量，其余全靠 CSS 变量切换（零重排、零闪烁）
  const theme = config?.general.theme
  const scheme = config?.general.scheme
  const background = config?.general.background
  const bgImage = config?.general.backgroundImage ?? ''
  const alpha = config?.general.glassOpacity ?? 0.32
  const blur = config?.general.glassBlur ?? 24
  const clarity = config?.general.bgClarity ?? 0.4

  useEffect(() => {
    if (!theme || !scheme || !background) return
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.scheme = scheme
    root.dataset.bg = background
    root.style.setProperty('--glass-alpha', String(alpha))
    root.style.setProperty('--glass-blur', `${blur}px`)
    root.style.setProperty('--bg-clarity', String(clarity))
    root.style.setProperty(
      '--bg-image-url',
      bgImage ? `url("sai2img://bg/${encodeURIComponent(bgImage)}")` : 'none'
    )

    // 模糊层只在「玻璃 + 图片背景 + 参数有效」时挂：
    // 纯色背景是一层平面渐变，没有可模糊的细节；桌面模式摸不到窗口外的壁纸，
    // 挂上去反而会触发 Chromium 的白色兜底（详见 开发文档 §3.1）。
    const glassOn = theme === 'glass' && background === 'image' && blur > 0 && alpha >= 0.02
    root.dataset.glass = glassOn ? 'on' : 'off'

    // 插件主题变量：先撤掉上次应用、这次不再提供的，再设新的（禁用插件后要能恢复）
    const nextKeys = new Set(Object.keys(themeVars))
    for (const key of appliedThemeVars.current) {
      if (!nextKeys.has(key)) root.style.removeProperty(key)
    }
    for (const [key, value] of Object.entries(themeVars)) root.style.setProperty(key, value)
    appliedThemeVars.current = nextKeys
  }, [theme, scheme, background, bgImage, alpha, blur, clarity, themeVars])


  const beginDrag = useCallback(
    (side: 'left' | 'right') => (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      document.body.classList.add('is-dragging')
      const startX = e.clientX
      const startW = side === 'left' ? useUi.getState().leftWidth : useUi.getState().rightWidth

      const onMove = (ev: globalThis.MouseEvent): void => {
        const delta = ev.clientX - startX
        if (side === 'left') setLeftWidth(clamp(startW + delta, 150, 380))
        else setRightWidth(clamp(startW - delta, 220, 500))
      }
      const onUp = (): void => {
        document.body.classList.remove('is-dragging')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        void persistWidth(side)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setLeftWidth, setRightWidth, persistWidth]
  )

  if (!runtime || !config) {
    return (
      <div className="app">
        <div className="boot">
          <div className="boot-mark">S2</div>
          <div className="boot-text">正在启动…</div>
        </div>
      </div>
    )
  }

  const goto = (p: PageKey): void => setPage(p)

  // 当前默认打开器：优先取注册表里标 current 的项，拿不到再按 config 里的 id 兜底
  const currentOpener = openers.find((o) => o.current) ?? openers.find((o) => o.id === config.openers.default)
  const launchLabel = currentOpener ? `启动 ${currentOpener.label}` : '启动画图程序'
  const sai2Ready = openers.length > 0 ? openers.some((o) => o.ready) : config.openers.sai2.path.trim().length > 0

  const doLaunch = (file?: string): void => {
    void window.api.launch(file).then((res) => {
      if (!res.ok) {
        showToast(res.error ?? '启动失败')
        goto('settings')
        return
      }
      showToast(`已启动${res.openerId ? ` ${res.openerId.replace('opener-', '').toUpperCase()}` : '画图程序'}`)
      void window.api.openers().then(setOpeners)
    })
  }

  const onLaunch = (): void => doLaunch()

  // 侧栏提示：插件上报的状态优先（如联动路径失效标红），否则显示打开器就绪情况
  const warnStatus = pluginStatuses.find((s) => s.level === 'warn' || s.level === 'error')
  const companionHint = warnStatus
    ? warnStatus.text
    : openers.some((o) => o.ready)
      ? `就绪 · ${openers.filter((o) => o.ready).map((o) => o.label).join(' / ')}`
      : '画图程序路径未配置'

  return (
    <div className="app">
      <TitleBar />

      <div className="app-body">
        <div style={{ width: leftWidth, display: 'flex', flex: '0 0 auto' }}>
          <Sidebar
            page={page}
            onPage={goto}
            extraPages={pluginPages}
            launchLabel={launchLabel}
            onLaunch={onLaunch}
            ready={sai2Ready}
            companionHint={companionHint}
          />
        </div>

        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={beginDrag('left')}
        />

        <main className="content">
          {renderPage(page, { runtime, config, goto, toast: showToast, updateConfig, openers, doLaunch, refreshOpeners: () => void window.api.openers().then(setOpeners) }, pluginPages)}
        </main>

        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={beginDrag('right')}
        />

        <div style={{ width: rightWidth, display: 'flex', flex: '0 0 auto' }}>
          <DetailsPanel
            runtime={runtime}
            watchCount={config.watch.dirs.length}
            file={selectedPath ? selectedFile : null}
            toast={showToast}
          />
        </div>
      </div>

      <StatusBar
        runtime={runtime}
        theme={config.general.theme}
        scheme={config.general.scheme}
        watchMode={config.watch.mode}
        watchCount={config.watch.dirs.length}
        fileCount={fileTotal}
      />

      {toastText ? <div className="toast">{toastText}</div> : null}
    </div>
  )
}
