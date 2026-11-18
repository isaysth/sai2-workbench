/**
 * 渲染端可见的 window.api 类型。
 * 与 src/preload/index.ts 的实现保持一一对应（改一处记得改另一处）。
 */
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
import type { PluginInfo, PluginPageContribution, PluginResult, PluginSnapshotPayload } from '@shared/plugins'

declare global {
  interface Window {
    api: {
      runtime(): Promise<RuntimeInfo>
      windowAction(action: WindowAction): Promise<{ ok: boolean; error?: string }>
      onFloatChanged(cb: (state: FloatModeState) => void): () => void
      floatState(): Promise<FloatModeState>
      pickBackground(
        oldName: string
      ): Promise<{ ok: boolean; pending?: string; canceled?: boolean; error?: string }>
      applyBackground(payload: {
        pending: string
        png: Uint8Array
        oldName: string
      }): Promise<{ ok: boolean; file?: string; error?: string }>
      readBackground(
        pending: string
      ): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }>
      cancelBackground(pending: string): Promise<{ ok: boolean }>
      clearBackground(name: string): Promise<{ ok: boolean }>
      launch(file?: string, openerId?: string): Promise<{ ok: boolean; error?: string; openerId?: string }>
      openers(): Promise<OpenerView[]>
      openWith(path: string, openerId?: string): Promise<{ ok: boolean; error?: string; openerId?: string }>
      pickFile(filter: 'exe' | 'dir' | 'file', multi?: boolean): Promise<{ ok: boolean; canceled?: boolean; paths: string[] }>
      theme: {
        get(): Promise<Record<string, string>>
        onChanged(cb: (vars: Record<string, string>) => void): () => void
      }
      config: {
        get(): Promise<AppConfig>
        set(key: string, value: unknown): Promise<{ ok: boolean; error?: string }>
        onChanged(cb: (payload: { key: string; value: unknown }) => void): () => void
      }
      log: {
        history(limit?: number): Promise<LogEntry[]>
        clear(): Promise<{ ok: boolean }>
        openFile(): Promise<{ ok: boolean; error?: string }>
        onAppend(cb: (entry: LogEntry) => void): () => void
      }
      files: {
        list(query?: {
          dir?: string
          keyword?: string
          limit?: number
          offset?: number
        }): Promise<{ total: number; items: ProjectFile[] }>
        addDir(): Promise<{
          ok: boolean
          added?: number
          dirs?: string[]
          canceled?: boolean
          message?: string
        }>
        removeDir(dir: string): Promise<{ ok: boolean; error?: string }>
        rescan(): Promise<{ ok: boolean; total?: number; already?: boolean }>
        reveal(path: string): Promise<{ ok: boolean; error?: string }>
        setTags(path: string, tags: string[]): Promise<{ ok: boolean; tags?: Tag[]; error?: string }>
        setProject(
          path: string,
          projectId: number | null
        ): Promise<{ ok: boolean; projectId?: number | null; project?: Project | null; error?: string }>
        onChanged(cb: (ev: FileChangeEvent) => void): () => void
        onMetaChanged(cb: (ev: FileMetaEvent) => void): () => void
        onProgress(cb: (p: IndexProgress) => void): () => void
      }
      meta: {
        tags(): Promise<Tag[]>
        createTag(name: string): Promise<{ ok: boolean; tag?: Tag; error?: string }>
        renameTag(id: number, name: string): Promise<{ ok: boolean; tag?: Tag; error?: string }>
        deleteTag(id: number): Promise<{ ok: boolean; error?: string }>
        projects(): Promise<Project[]>
        createProject(name: string, client: string): Promise<{ ok: boolean; project?: Project; error?: string }>
        updateProject(
          id: number,
          patch: { name?: string; client?: string }
        ): Promise<{ ok: boolean; project?: Project; error?: string }>
        deleteProject(id: number): Promise<{ ok: boolean; error?: string }>
        rules(
          action: 'list' | 'add' | 'remove',
          payload?: { prefix?: string; tagId?: number }
        ): Promise<{ ok: boolean; rules: AutoTagRule[]; error?: string }>
      }
      thumbs: {
        stats(): Promise<ThumbCacheStats>
        clear(): Promise<{ ok: boolean; removed?: number; freed?: number }>
      }
      plugins: {
        list(): Promise<PluginSnapshotPayload>
        install(mode: 'folder' | 'zip'): Promise<PluginResult & { id?: string }>
        openDir(): Promise<{ ok: boolean; error?: string }>
        installZipPath(zipPath: string): Promise<PluginResult & { id?: string }>
        uninstall(id: string): Promise<PluginResult>
        setEnabled(id: string, enabled: boolean): Promise<PluginResult>
        reload(id: string): Promise<PluginResult>
        getConfig(id: string): Promise<Record<string, unknown>>
        setConfig(id: string, value: Record<string, unknown>): Promise<PluginResult>
        runAction(kind: 'file' | 'toolbar', id: string, path?: string): Promise<PluginResult>
        onChanged(cb: (payload: PluginSnapshotPayload) => void): () => void
        onZipFound(cb: (paths: string[]) => void): () => void
      }
    }
  }
}

export {}
