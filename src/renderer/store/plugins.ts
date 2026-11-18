import { create } from 'zustand'
import type { ActionView, PluginInfo, PluginPageContribution, PluginResult, PluginSnapshotPayload, PluginStatusView } from '@shared/plugins'

/**
 * 插件中心的前端状态。
 * 主进程是插件状态的唯一真相，这里缓存列表、贡献的页面与菜单动作，变更走 plugin:changed 推送。
 */
interface PluginsStore {
  items: PluginInfo[]
  pages: PluginPageContribution[]
  fileActions: ActionView[]
  toolbarActions: ActionView[]
  statuses: PluginStatusView[]
  selectedId: string | null
  loading: boolean
  /** 外部改了某个插件配置时 +1，详情表单据此重拉 */
  configRevision: number

  init: () => void
  load: () => Promise<void>
  select: (id: string | null) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  reload: (id: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  install: (mode: 'folder' | 'zip') => Promise<void>
  openDir: () => Promise<boolean>
  installZipPath: (zipPath: string) => Promise<PluginResult & { id?: string }>
  bumpConfig: () => void
}

type PluginSnapshot = PluginSnapshotPayload

let started = false

export const usePlugins = create<PluginsStore>((set, get) => ({
  items: [],
  pages: [],
  fileActions: [],
  toolbarActions: [],
  statuses: [],
  selectedId: null,
  loading: false,
  configRevision: 0,

  init: () => {
    if (started) return
    started = true
    window.api.plugins.onChanged((payload: PluginSnapshot) => {
      const current = get().selectedId
      set({
        items: payload.plugins,
        pages: payload.pages,
        fileActions: payload.actions?.fileActions ?? [],
        toolbarActions: payload.actions?.toolbarActions ?? [],
        statuses: payload.statuses ?? [],
        selectedId: current && payload.plugins.some((p) => p.id === current) ? current : (payload.plugins[0]?.id ?? null)
      })
    })
    void get().load()
  },

  load: async () => {
    set({ loading: true })
    try {
      const { plugins, pages, actions, statuses } = await window.api.plugins.list()
      set({
        items: plugins,
        pages,
        fileActions: actions?.fileActions ?? [],
        toolbarActions: actions?.toolbarActions ?? [],
        statuses: statuses ?? [],
        selectedId: plugins.some((p) => p.id === get().selectedId)
          ? get().selectedId
          : (plugins[0]?.id ?? null)
      })
    } finally {
      set({ loading: false })
    }
  },

  select: (selectedId) => set({ selectedId }),

  setEnabled: async (id, enabled) => {
    const res = await window.api.plugins.setEnabled(id, enabled)
    if (!res.ok) set({ items: get().items.map((p) => (p.id === id ? { ...p, error: res.error } : p)) })
  },

  reload: async (id) => {
    await window.api.plugins.reload(id)
  },

  uninstall: async (id) => {
    const res = await window.api.plugins.uninstall(id)
    if (!res.ok) set({ items: get().items.map((p) => (p.id === id ? { ...p, error: res.error } : p)) })
  },

  install: async (mode) => {
    const res = await window.api.plugins.install(mode)
    if (!res.ok && !res.canceled) {
      set({ items: get().items.map((p) => (p.id === res.id ? { ...p, error: res.error } : p)) })
    }
  },

  openDir: async () => {
    const res = await window.api.plugins.openDir()
    return res.ok
  },

  installZipPath: (zipPath) => window.api.plugins.installZipPath(zipPath),

  bumpConfig: () => set((s) => ({ configRevision: s.configRevision + 1 }))
}))
