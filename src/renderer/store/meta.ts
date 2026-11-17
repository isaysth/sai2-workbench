import { create } from 'zustand'
import type { AutoTagRule, Project, Tag } from '@shared/types'

/**
 * 标签池 / 项目池 / 自动规则的前端缓存（M2b T3.4）。
 *
 * 一次拉全量、变更后自己 patch：这三个列表都很小（几十条），
 * 每打一个标签就重新拉一遍全部标签，会让详情面板闪一下。
 *
 * 数据真源在主进程数据库里，这里只是"显示用的一份"，
 * 所以任何写操作都以主进程返回的结果为准（失败就回滚并 toast）。
 */

interface MetaStore {
  tags: Tag[]
  projects: Project[]
  rules: AutoTagRule[]
  loaded: boolean

  load: () => Promise<void>
  refreshTags: () => Promise<void>

  createTag: (name: string) => Promise<Tag | null>
  renameTag: (id: number, name: string) => Promise<boolean>
  deleteTag: (id: number) => Promise<boolean>

  createProject: (name: string, client: string) => Promise<Project | null>
  updateProject: (id: number, patch: { name?: string; client?: string }) => Promise<boolean>
  deleteProject: (id: number) => Promise<boolean>

  refreshRules: () => Promise<void>
  addRule: (prefix: string, tagId: number) => Promise<boolean>
  removeRule: (prefix: string) => Promise<boolean>
}

let loading: Promise<void> | null = null

export const useMeta = create<MetaStore>((set, get) => ({
  tags: [],
  projects: [],
  rules: [],
  loaded: false,

  load: async () => {
    if (loading) return loading
    loading = (async () => {
      const [tags, projects, ruleRes] = await Promise.all([
        window.api.meta.tags(),
        window.api.meta.projects(),
        window.api.meta.rules('list')
      ])
      set({ tags, projects, rules: ruleRes.rules ?? [], loaded: true })
    })()
    await loading
    loading = null
  },

  refreshTags: async () => {
    set({ tags: await window.api.meta.tags() })
  },

  createTag: async (name) => {
    const res = await window.api.meta.createTag(name)
    if (!res.ok || !res.tag) return null
    const tags = [...get().tags, res.tag].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    set({ tags })
    return res.tag
  },

  renameTag: async (id, name) => {
    const res = await window.api.meta.renameTag(id, name)
    if (!res.ok || !res.tag) return false
    set({ tags: get().tags.map((t) => (t.id === id ? res.tag! : t)) })
    return true
  },

  deleteTag: async (id) => {
    const res = await window.api.meta.deleteTag(id)
    if (!res.ok) return false
    set({
      tags: get().tags.filter((t) => t.id !== id),
      rules: get().rules.filter((r) => r.tagId !== id)
    })
    return true
  },

  createProject: async (name, client) => {
    const res = await window.api.meta.createProject(name, client)
    if (!res.ok || !res.project) return null
    const projects = [...get().projects, res.project].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    )
    set({ projects })
    return res.project
  },

  updateProject: async (id, patch) => {
    const res = await window.api.meta.updateProject(id, patch)
    if (!res.ok || !res.project) return false
    set({ projects: get().projects.map((p) => (p.id === id ? res.project! : p)) })
    return true
  },

  deleteProject: async (id) => {
    const res = await window.api.meta.deleteProject(id)
    if (!res.ok) return false
    set({ projects: get().projects.filter((p) => p.id !== id) })
    return true
  },

  refreshRules: async () => {
    const res = await window.api.meta.rules('list')
    set({ rules: res.rules ?? [] })
  },

  addRule: async (prefix, tagId) => {
    const res = await window.api.meta.rules('add', { prefix, tagId })
    if (!res.ok) return false
    set({ rules: res.rules })
    return true
  },

  removeRule: async (prefix) => {
    const res = await window.api.meta.rules('remove', { prefix })
    if (!res.ok) return false
    set({ rules: res.rules })
    return true
  }
}))
