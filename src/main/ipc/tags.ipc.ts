import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { FileMetaEvent } from '@shared/types'
import type { FileStore } from '../db/files'
import type { MetaStore } from '../db/meta'
import type { FilesIndex } from '../files'
import type { Logger } from '../logger'
import { broadcast } from './broadcast'

/**
 * 标签 / 项目 / 自动规则的 IPC（M2b T3.4）。
 *
 * 两个约定：
 *  - 所有失败都返回 `{ok:false, error}` 而不是抛异常（开发文档 §4.2）。
 *  - 改完某个文件的标签后广播 `files:meta-changed`，渲染端只更新那一张卡片，
 *    不重新拉列表 —— 否则每打一个标签，瀑布流就会重排、滚动位置跳一下。
 */

export interface TagsIpcDeps {
  meta: MetaStore
  store: FileStore
  index: FilesIndex
  log: Logger
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerTagsIpc(deps: TagsIpcDeps): void {
  const { meta, store, index, log } = deps

  // ---------------- 标签 ----------------

  ipcMain.handle(CH.tagsList, () => meta.listTags())

  ipcMain.handle(CH.tagsCreate, (_e, name: unknown) => {
    try {
      const tag = meta.createTag(name)
      log.info('meta', `新建标签：${tag.name}`)
      return { ok: true, tag }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(CH.tagsRename, (_e, payload: { id?: unknown; name?: unknown }) => {
    const id = Number(payload?.id)
    if (!Number.isFinite(id)) return { ok: false, error: '标签 id 非法' }
    try {
      const tag = meta.renameTag(id, payload?.name)
      log.info('meta', `标签改名：${tag.name}`)
      return { ok: true, tag }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(CH.tagsDelete, (_e, id: unknown) => {
    const tagId = Number(id)
    if (!Number.isFinite(tagId)) return { ok: false, error: '标签 id 非法' }
    try {
      // 级联：file_tags 里对应的行由外键自动清掉，卡片上的标签随之消失
      meta.deleteTag(tagId)
      store.invalidateRules()
      log.info('meta', `删除标签 #${tagId}`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  // ---------------- 项目 ----------------

  ipcMain.handle(CH.projectsList, () => meta.listProjects())

  ipcMain.handle(CH.projectsCreate, (_e, payload: { name?: unknown; client?: unknown }) => {
    try {
      const project = meta.createProject(payload?.name, payload?.client)
      store.invalidateProjects()
      log.info('meta', `新建项目：${project.name}${project.client ? `（${project.client}）` : ''}`)
      return { ok: true, project }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(CH.projectsUpdate, (_e, payload: { id?: unknown; name?: unknown; client?: unknown }) => {
    const id = Number(payload?.id)
    if (!Number.isFinite(id)) return { ok: false, error: '项目 id 非法' }
    try {
      const project = meta.updateProject(id, { name: payload?.name, client: payload?.client })
      store.invalidateProjects()
      return { ok: true, project }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(CH.projectsDelete, (_e, id: unknown) => {
    const projectId = Number(id)
    if (!Number.isFinite(projectId)) return { ok: false, error: '项目 id 非法' }
    try {
      meta.deleteProject(projectId)
      store.invalidateProjects()
      // project_id 是 on delete set null，文件本身不动，只是变回「未归类」
      for (const file of index.list({ limit: 20000 }).items) {
        if (file.projectId === projectId) index.patchMeta(file.path, { projectId: null, project: null })
      }
      log.info('meta', `删除项目 #${projectId}，归属文件已变回「未归类」`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  // ---------------- 自动标签规则 ----------------

  ipcMain.handle(CH.metaRules, (_e, payload: { action?: unknown; prefix?: unknown; tagId?: unknown }) => {
    const action = payload?.action
    try {
      if (action === 'add') {
        const rule = meta.addRule(payload?.prefix, payload?.tagId)
        store.invalidateRules()
        log.info('meta', `自动标签规则：${rule.prefix} → ${rule.tagName}`)
        return { ok: true, rules: meta.listRules() }
      }
      if (action === 'remove') {
        meta.removeRule(payload?.prefix)
        store.invalidateRules()
        return { ok: true, rules: meta.listRules() }
      }
      return { ok: true, rules: meta.listRules() }
    } catch (err) {
      return { ok: false, error: message(err), rules: meta.listRules() }
    }
  })

  // ---------------- 单个文件的归属 ----------------

  ipcMain.handle(CH.filesSetTags, (_e, payload: { path?: unknown; tags?: unknown }) => {
    const path = typeof payload?.path === 'string' ? payload.path : ''
    const names = Array.isArray(payload?.tags)
      ? payload.tags.filter((t): t is string => typeof t === 'string')
      : []
    const file = index.find(path)
    if (!file) return { ok: false, error: '文件已不在索引里' }
    if (!file.fileId) return { ok: false, error: '这个文件还没入库，稍等一下再试' }
    try {
      const tags = store.setTags(file.fileId, names, 'manual')
      index.patchMeta(path, { tags })
      const event: FileMetaEvent = {
        path,
        tags,
        projectId: file.projectId ?? null,
        project: file.project ?? null
      }
      broadcast(CH.filesMetaChanged, event)
      return { ok: true, tags }
    } catch (err) {
      log.warn('meta', `写标签失败：${message(err)}`)
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(CH.filesSetProject, (_e, payload: { path?: unknown; projectId?: unknown }) => {
    const path = typeof payload?.path === 'string' ? payload.path : ''
    const raw = payload?.projectId
    const projectId = raw === null || raw === undefined ? null : Number(raw)
    if (projectId !== null && !Number.isFinite(projectId)) {
      return { ok: false, error: '项目 id 非法' }
    }
    const file = index.find(path)
    if (!file) return { ok: false, error: '文件已不在索引里' }
    if (!file.fileId) return { ok: false, error: '这个文件还没入库，稍等一下再试' }
    try {
      const project = store.setProject(file.fileId, projectId && projectId > 0 ? projectId : null)
      index.patchMeta(path, { projectId: project ? project.id : null, project })
      const event: FileMetaEvent = {
        path,
        tags: file.tags ?? [],
        projectId: project ? project.id : null,
        project
      }
      broadcast(CH.filesMetaChanged, event)
      return { ok: true, projectId: project ? project.id : null, project }
    } catch (err) {
      log.warn('meta', `写项目归属失败：${message(err)}`)
      return { ok: false, error: message(err) }
    }
  })
}
