import type { AutoTagRule, Project, Tag } from '@shared/types'
import type { AppDb } from './index'

/**
 * 标签 / 项目 / 自动规则的纯 SQL 封装（M2b T3.4）。
 *
 * 这里只做约束与读写，不含业务判断（"这个文件该不该带这个标签"在 FileStore 里）。
 * 约束靠数据库兜底而不是靠调用方自觉：
 *  - 标签名、项目名唯一（大小写敏感由 SQLite 默认处理，代码里额外做 nocase 查重）
 *  - 删标签 → `file_tags` 级联清空，不留孤儿行
 *  - 删项目 → 文件 `project_id` 置 null（on delete set null），文件本身不动
 */

function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0)
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v)
}

function cleanName(raw: unknown, label: string): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length === 0) throw new Error(`${label}名字不能为空`)
  if (name.length > 40) throw new Error(`${label}名字最长 40 个字`)
  return name
}

export class MetaStore {
  constructor(private readonly db: AppDb) {
    // 库损坏重建后，标签由 FileStore 先灌回 tags 表，这里再补项目和自动规则。
    // 顺序不能反：规则引用 tag_id，必须等标签都在。
    const saved = db.salvaged
    if (!saved || ((saved.projects?.length ?? 0) === 0 && (saved.rules?.length ?? 0) === 0)) return
    db.transaction(() => {
      for (const p of saved.projects ?? []) {
        const dup = db.get('select id from projects where name = ? collate nocase', p.name)
        if (dup) continue
        db.run('insert into projects(name, client, color) values(?, ?, ?)', p.name, p.client, p.color)
      }
      for (const r of saved.rules ?? []) {
        const tag = db.get('select id from tags where name = ? collate nocase', r.tagName)
        if (!tag) continue
        db.run(
          'insert or ignore into auto_tag_rules(prefix, tag_id) values(?, ?)',
          r.prefix,
          num(tag['id'])
        )
      }
    })
  }

  // ---------------------------------------------------------------- 标签

  listTags(): Tag[] {
    const rows = this.db.all('select id, name, color from tags order by name collate nocase')
    return rows.map((r) => {
      const tag: Tag = { id: num(r['id']), name: str(r['name']) }
      const color = strOrNull(r['color'])
      if (color) tag.color = color
      return tag
    })
  }

  createTag(rawName: unknown): Tag {
    const name = cleanName(rawName, '标签')
    const exists = this.db.get('select id from tags where name = ? collate nocase', name)
    if (exists) throw new Error('已经有同名标签了')
    const res = this.db.run('insert into tags(name) values(?)', name)
    return { id: res.id, name }
  }

  renameTag(id: number, rawName: unknown): Tag {
    const name = cleanName(rawName, '标签')
    const dup = this.db.get('select id from tags where name = ? collate nocase and id <> ?', name, id)
    if (dup) throw new Error('已经有同名标签了')
    this.db.run('update tags set name = ? where id = ?', name, id)
    return { id, name }
  }

  deleteTag(id: number): void {
    this.db.run('delete from tags where id = ?', id)
  }

  // ---------------------------------------------------------------- 项目

  listProjects(): Project[] {
    const rows = this.db.all(
      'select id, name, client, color from projects where archived = 0 order by name collate nocase'
    )
    return rows.map((r) => {
      const p: Project = { id: num(r['id']), name: str(r['name']), client: str(r['client']) }
      const color = strOrNull(r['color'])
      if (color) p.color = color
      return p
    })
  }

  createProject(rawName: unknown, rawClient: unknown): Project {
    const name = cleanName(rawName, '项目')
    const client = typeof rawClient === 'string' ? rawClient.trim().slice(0, 60) : ''
    const exists = this.db.get('select id from projects where name = ? collate nocase', name)
    if (exists) throw new Error('已经有同名项目了')
    const res = this.db.run('insert into projects(name, client) values(?, ?)', name, client)
    return { id: res.id, name, client }
  }

  updateProject(id: number, patch: { name?: unknown; client?: unknown }): Project {
    const current = this.db.get('select id, name, client from projects where id = ?', id)
    if (!current) throw new Error('项目不存在')
    const name = patch.name === undefined ? str(current['name']) : cleanName(patch.name, '项目')
    if (name !== str(current['name'])) {
      const dup = this.db.get('select id from projects where name = ? collate nocase and id <> ?', name, id)
      if (dup) throw new Error('已经有同名项目了')
    }
    const client = patch.client === undefined ? str(current['client']) : str(patch.client).trim().slice(0, 60)
    this.db.run('update projects set name = ?, client = ? where id = ?', name, client, id)
    return { id, name, client }
  }

  deleteProject(id: number): void {
    // project_id 是 on delete set null，文件本身与标签都不受影响
    this.db.run('delete from projects where id = ?', id)
  }

  // ---------------------------------------------------------------- 自动标签规则

  listRules(): AutoTagRule[] {
    const rows = this.db.all(
      'select r.prefix as prefix, r.tag_id as tag_id, t.name as name from auto_tag_rules r join tags t on t.id = r.tag_id order by length(r.prefix) desc'
    )
    return rows.map((r) => ({ prefix: str(r['prefix']), tagId: num(r['tag_id']), tagName: str(r['name']) }))
  }

  addRule(rawPrefix: unknown, tagId: unknown): AutoTagRule {
    const prefix = typeof rawPrefix === 'string' ? rawPrefix.trim() : ''
    if (prefix.length < 3) throw new Error('目录前缀太短了')
    const id = num(tagId)
    const tag = this.db.get('select name from tags where id = ?', id)
    if (!tag) throw new Error('标签不存在')
    // 只把分隔符统一成反斜杠，**不转小写**：小写存进去后设置页显示的是
    // "c:\users\11421\documents\..."，用户会以为路径被改坏了。
    // 大小写不敏感由匹配那一侧负责（FileStore.rules 里统一小写比较）。
    const normalized = prefix.replaceAll('/', '\\')
    this.db.run(
      'insert into auto_tag_rules(prefix, tag_id) values(?, ?) on conflict(prefix) do update set tag_id = excluded.tag_id',
      normalized,
      id
    )
    return { prefix: normalized, tagId: id, tagName: str(tag['name']) }
  }

  removeRule(rawPrefix: unknown): void {
    const prefix = typeof rawPrefix === 'string' ? rawPrefix.replaceAll('/', '\\') : ''
    // 大小写不敏感地删：老版本存过小写形式，用户现在拿到的是原始大小写
    this.db.run('delete from auto_tag_rules where lower(prefix) = lower(?)', prefix)
  }
}
