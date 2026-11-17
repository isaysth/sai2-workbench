import { create } from 'zustand'
import type { AppConfig, RuntimeInfo } from '@shared/types'
import { usePlugins } from './plugins'

/** 内置页 + 插件动态注册的页（plugin:<id>:<pageId>） */
export type PageKey = 'launch' | 'files' | 'logs' | 'plugins' | 'settings' | (string & {})

/** 按点分键写入一份新配置对象（不可变更新，React 才能感知变化） */
function patchConfig(base: AppConfig, key: string, value: unknown): AppConfig {
  const next = structuredClone(base)
  const parts = key.split('.')
  const last = parts.pop()
  if (!last) return next
  let cur: Record<string, unknown> = next as unknown as Record<string, unknown>
  for (const part of parts) {
    const child = cur[part]
    if (typeof child !== 'object' || child === null) cur[part] = {}
    cur = cur[part] as Record<string, unknown>
  }
  cur[last] = value
  return next
}

interface UiStore {
  runtime: RuntimeInfo | null
  config: AppConfig | null
  page: PageKey
  leftWidth: number
  rightWidth: number
  toast: string | null

  start: () => Promise<void>
  reloadConfig: () => Promise<void>
  setPage: (page: PageKey) => void
  setLeftWidth: (w: number) => void
  setRightWidth: (w: number) => void
  persistWidth: (side: 'left' | 'right') => Promise<void>
  updateConfig: (key: string, value: unknown) => Promise<void>
  showToast: (message: string, ms?: number) => void
}

const PAGES: PageKey[] = ['launch', 'files', 'logs', 'plugins', 'settings']

/** 支持 ?page=logs 直达某页，用于截图验收与调试 */
function initialPage(): PageKey {
  const raw = new URLSearchParams(window.location.search).get('page')
  return raw && (PAGES as string[]).includes(raw) ? (raw as PageKey) : 'launch'
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let configWatchStarted = false

export const useUi = create<UiStore>((set, get) => ({
  runtime: null,
  config: null,
  page: initialPage(),
  leftWidth: 208,
  rightWidth: 264,
  toast: null,

  start: async () => {
    const [runtime, config] = await Promise.all([window.api.runtime(), window.api.config.get()])
    set({
      runtime,
      config,
      leftWidth: config.ui.splitterLeft,
      rightWidth: config.ui.splitterRight
    })
    // 插件配置可能被主进程或其他地方改掉，表单要跟着刷新；
    // 其余配置项沿用本地乐观更新，不做全量回拉以免和用户的滑块操作打架。
    if (!configWatchStarted) {
      configWatchStarted = true
      window.api.config.onChanged(({ key }) => {
        if (key.startsWith('plugins.config.')) usePlugins.getState().bumpConfig()
      })
    }
  },

  reloadConfig: async () => {
    const config = await window.api.config.get()
    set({ config })
  },

  setPage: (page) => set({ page }),

  setLeftWidth: (leftWidth) => set({ leftWidth }),
  setRightWidth: (rightWidth) => set({ rightWidth }),

  persistWidth: async (side) => {
    const { leftWidth, rightWidth, config } = get()
    if (!config) return
    const key = side === 'left' ? 'ui.splitterLeft' : 'ui.splitterRight'
    const value = side === 'left' ? leftWidth : rightWidth
    set({ config: patchConfig(config, key, value) })
    await window.api.config.set(key, value)
  },

  updateConfig: async (key, value) => {
    const { config } = get()
    // 先本地生效（主题切换要立刻可见），再落盘；落盘失败以主进程为准重新拉一次
    if (config) set({ config: patchConfig(config, key, value) })
    const res = await window.api.config.set(key, value)
    if (!res.ok) {
      await get().reloadConfig()
      get().showToast(res.error ?? '设置保存失败')
    }
  },

  showToast: (message, ms = 2600) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toast: null })
    }, ms)
  }
}))
