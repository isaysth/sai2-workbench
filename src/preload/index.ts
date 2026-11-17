import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/channels'
import type {
  AppConfig,
  AutoTagRule,
  FileChangeEvent,
  FileMetaEvent,
  FloatModeState,
  IndexProgress,
  LogEntry,
  OpenerView,
  Project,
  ProjectFile,
  RuntimeInfo,
  Tag,
  ThumbCacheStats,
  WindowAction
} from '@shared/types'
import type { PluginResult, PluginSnapshotPayload } from '@shared/plugins'

/**
 * 唯一的跨进程桥。渲染端只能看到下面这些方法，拿不到 Node。
 * 约定：所有调用失败都返回 {ok:false,error}，不向渲染端抛异常（开发文档 §4.2）。
 */
const api = {
  runtime: (): Promise<RuntimeInfo> => ipcRenderer.invoke(CH.appRuntime),

  windowAction: (action: WindowAction): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.appWindow, action),

  /** 当前悬浮窗状态（页面加载时补一次，之后靠事件推送） */
  floatState: (): Promise<FloatModeState> => ipcRenderer.invoke(CH.appFloatState),

  /** 悬浮窗状态推送（主进程 → 渲染端） */
  onFloatChanged: (cb: (state: FloatModeState) => void): (() => void) => {
    const handler = (_e: unknown, state: FloatModeState): void => cb(state)
    ipcRenderer.on(CH.windowFloatChanged, handler)
    return () => ipcRenderer.off(CH.windowFloatChanged, handler)
  },

  /**
   * 选一张本地图片当背景。返回落在 data/backgrounds 里的**临时**文件名，
   * 渲染端拿着它开取景框，确认后调 applyBackground 才真正落地。
   */
  pickBackground: (
    oldName: string
  ): Promise<{ ok: boolean; pending?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.appPickBackground, oldName),

  /**
   * 取景确认：渲染端已裁好并编码成 PNG，主进程只校验 + 落盘。
   * 传字节而不是传矩形，是因为 `nativeImage` 解不开 WebP。
   */
  applyBackground: (payload: {
    pending: string
    png: Uint8Array
    oldName: string
  }): Promise<{ ok: boolean; file?: string; error?: string }> =>
    ipcRenderer.invoke(CH.appApplyBackground, payload),

  /** 读临时图字节：取景框用 blob: 加载，避免 canvas 被自定义协议污染 */
  readBackground: (pending: string): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }> =>
    ipcRenderer.invoke(CH.appReadBackground, pending),

  /** 取景取消：删掉临时文件，现有背景保持不变 */
  cancelBackground: (pending: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(CH.appCancelBackground, pending),

  /** 删除当前背景图文件（配置清空由渲染端负责） */
  clearBackground: (name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(CH.appClearBackground, name),

  /** 启动默认打开器；带 file 时按扩展名选，openerId 指定时用指定打开器 */
  launch: (file?: string, openerId?: string): Promise<{ ok: boolean; error?: string; openerId?: string }> =>
    ipcRenderer.invoke(CH.appLaunch, { file, openerId }),
  openers: (): Promise<OpenerView[]> => ipcRenderer.invoke(CH.appOpeners),
  openWith: (path: string, openerId?: string): Promise<{ ok: boolean; error?: string; openerId?: string }> =>
    ipcRenderer.invoke(CH.appOpenWith, { path, openerId }),
  /** 系统选择框：exe / dir / file；multi 只对公司生效 */
  pickFile: (filter: 'exe' | 'dir' | 'file', multi = false): Promise<{ ok: boolean; canceled?: boolean; paths: string[] }> =>
    ipcRenderer.invoke(CH.appPickFile, { filter, multi }),

  /** 当前主题变量表（插件贡献） */
  theme: {
    get: (): Promise<Record<string, string>> => ipcRenderer.invoke(CH.themeGet),
    onChanged: (cb: (vars: Record<string, string>) => void): (() => void) => {
      const handler = (_e: unknown, vars: Record<string, string>): void => cb(vars)
      ipcRenderer.on(CH.themeChanged, handler)
      return () => ipcRenderer.off(CH.themeChanged, handler)
    }
  },

  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(CH.configGet),
    set: (key: string, value: unknown): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.configSet, { key, value }),
    onChanged: (cb: (payload: { key: string; value: unknown }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { key: string; value: unknown }): void => cb(payload)
      ipcRenderer.on(CH.configChanged, handler)
      return () => ipcRenderer.off(CH.configChanged, handler)
    }
  },

  log: {
    history: (limit?: number): Promise<LogEntry[]> => ipcRenderer.invoke(CH.logHistory, limit),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(CH.logClear),
    openFile: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(CH.logOpenFile),
    onAppend: (cb: (entry: LogEntry) => void): (() => void) => {
      const handler = (_e: unknown, entry: LogEntry): void => cb(entry)
      ipcRenderer.on(CH.logAppend, handler)
      return () => ipcRenderer.off(CH.logAppend, handler)
    }
  },

  /** 文件索引：列表查询 + 监听目录管理 + 变更/进度订阅 */
  files: {
    list: (query?: {
      dir?: string
      keyword?: string
      limit?: number
      offset?: number
    }): Promise<{ total: number; items: ProjectFile[] }> => ipcRenderer.invoke(CH.filesList, query),

    addDir: (): Promise<{ ok: boolean; added?: number; dirs?: string[]; canceled?: boolean; message?: string }> =>
      ipcRenderer.invoke(CH.filesAddDir),

    removeDir: (dir: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.filesRemoveDir, dir),

    rescan: (): Promise<{ ok: boolean; total?: number; already?: boolean }> =>
      ipcRenderer.invoke(CH.filesRescan),

    reveal: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.filesReveal, path),

    /** 整体替换某个文件的标签（按名字传，主进程负责建不存在的标签） */
    setTags: (path: string, tags: string[]): Promise<{ ok: boolean; tags?: Tag[]; error?: string }> =>
      ipcRenderer.invoke(CH.filesSetTags, { path, tags }),

    /** 设置归属项目；null = 未归类 */
    setProject: (
      path: string,
      projectId: number | null
    ): Promise<{ ok: boolean; projectId?: number | null; project?: Project | null; error?: string }> =>
      ipcRenderer.invoke(CH.filesSetProject, { path, projectId }),

    onChanged: (cb: (ev: FileChangeEvent) => void): (() => void) => {
      const handler = (_e: unknown, ev: FileChangeEvent): void => cb(ev)
      ipcRenderer.on(CH.filesChanged, handler)
      return () => ipcRenderer.off(CH.filesChanged, handler)
    },

    onMetaChanged: (cb: (ev: FileMetaEvent) => void): (() => void) => {
      const handler = (_e: unknown, ev: FileMetaEvent): void => cb(ev)
      ipcRenderer.on(CH.filesMetaChanged, handler)
      return () => ipcRenderer.off(CH.filesMetaChanged, handler)
    },

    onProgress: (cb: (p: IndexProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: IndexProgress): void => cb(p)
      ipcRenderer.on(CH.filesProgress, handler)
      return () => ipcRenderer.off(CH.filesProgress, handler)
    }
  },

  /** 标签池 / 项目池 / 自动标签规则（M2b） */
  meta: {
    tags: (): Promise<Tag[]> => ipcRenderer.invoke(CH.tagsList),
    createTag: (name: string): Promise<{ ok: boolean; tag?: Tag; error?: string }> =>
      ipcRenderer.invoke(CH.tagsCreate, name),
    renameTag: (id: number, name: string): Promise<{ ok: boolean; tag?: Tag; error?: string }> =>
      ipcRenderer.invoke(CH.tagsRename, { id, name }),
    deleteTag: (id: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.tagsDelete, id),

    projects: (): Promise<Project[]> => ipcRenderer.invoke(CH.projectsList),
    createProject: (
      name: string,
      client: string
    ): Promise<{ ok: boolean; project?: Project; error?: string }> =>
      ipcRenderer.invoke(CH.projectsCreate, { name, client }),
    updateProject: (
      id: number,
      patch: { name?: string; client?: string }
    ): Promise<{ ok: boolean; project?: Project; error?: string }> =>
      ipcRenderer.invoke(CH.projectsUpdate, { id, ...patch }),
    deleteProject: (id: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.projectsDelete, id),

    rules: (action: 'list' | 'add' | 'remove', payload?: { prefix?: string; tagId?: number }) =>
      ipcRenderer.invoke(CH.metaRules, { action, ...payload }) as Promise<{
        ok: boolean
        rules: AutoTagRule[]
        error?: string
      }>
  },

  thumbs: {
    stats: (): Promise<ThumbCacheStats> => ipcRenderer.invoke(CH.thumbsStats),
    clear: (): Promise<{ ok: boolean; removed?: number; freed?: number }> =>
      ipcRenderer.invoke(CH.thumbsClear)
  },

  /** 插件中心：列表 / 装卸 / 配置（M3a） */
  plugins: {
    list: (): Promise<PluginSnapshotPayload> =>
      ipcRenderer.invoke(CH.pluginList),
    install: (mode: 'folder' | 'zip'): Promise<PluginResult & { id?: string }> =>
      ipcRenderer.invoke(CH.pluginInstall, mode),
    uninstall: (id: string): Promise<PluginResult> => ipcRenderer.invoke(CH.pluginUninstall, id),
    setEnabled: (id: string, enabled: boolean): Promise<PluginResult> =>
      ipcRenderer.invoke(CH.pluginSetEnabled, { id, enabled }),
    reload: (id: string): Promise<PluginResult> => ipcRenderer.invoke(CH.pluginReload, id),
    getConfig: (id: string): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke(CH.pluginGetConfig, id),
    setConfig: (id: string, value: Record<string, unknown>): Promise<PluginResult> =>
      ipcRenderer.invoke(CH.pluginSetConfig, { id, value }),
    runAction: (kind: 'file' | 'toolbar', id: string, path?: string): Promise<PluginResult> =>
      ipcRenderer.invoke(CH.pluginRunAction, { kind, id, path }),
    onChanged: (cb: (payload: PluginSnapshotPayload) => void): (() => void) => {
      const handler = (_e: unknown, payload: PluginSnapshotPayload): void => cb(payload)
      ipcRenderer.on(CH.pluginChanged, handler)
      return () => ipcRenderer.off(CH.pluginChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
