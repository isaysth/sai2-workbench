import type { Project, Tag } from '@shared/types'
import type { AppDb } from './index'

/**
 * 文件行的存取（M2b T3.2）。
 *
 * 核心是 §3.3 的三步匹配 —— 它决定了「改名 / 移动后标签还在不在」：
 *
 *   ① 按 (dev, ino) 命中 → 同一个文件被改名或同盘移动：**沿用旧行的 id**，
 *      只把 path / dir / name 换掉。标签是挂在 id 上的，于是自动跟过来。
 *   ② 按 path 命中 → 跨盘复制、重装、或曾经软删过的行回到原位：更新 ino，id 不变。
 *   ③ 都没有 → 新行，此时才套用自动标签规则。
 *
 * 绝对不能写成「先删旧行再插新行」：`file_tags` 是 `on delete cascade`，
 * 那样每改一次名，标签就被静默清空一次。
 */

export interface FileUpsertInput {
  path: string
  dir: string
  name: string
  ext: string
  size: number
  /** 取整后的毫秒时间戳 */
  mtime: number
  dev?: string | null
  ino?: string | null
  thumbKey?: string | null
}

export interface FileUpsertResult {
  path: string
  id: number
  /** true = 库里新建了这一行（会套自动标签） */
  created: boolean
  /** 改名 / 移动前的路径，用于日志与调试 */
  renamedFrom?: string
  tags: Tag[]
  projectId: number | null
  project: Project | null
}

export interface StoredFile {
  id: number
  path: string
  dir: string
  name: string
  ext: string
  size: number
  mtime: number
  dev: string | null
  ino: string | null
  width: number | null
  height: number | null
  thumbKey: string | null
  projectId: number | null
  project: Project | null
  tags: Tag[]
}

function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0)
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v)
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v)
}

/** 身份键。0 或者缺失一律视为「没有可信身份」，退回 path 匹配 */
function identityOf(dev?: string | null, ino?: string | null): string | null {
  if (!dev || !ino || dev === '0' || ino === '0') return null
  return `${dev}:${ino}`
}

export class FileStore {
  /** 自动标签规则，规则变更时置空重读 */
  private rulesCache: Array<{ prefix: string; tagId: number }> | null = null
  private projectCache = new Map<number, Project>()

  constructor(private readonly db: AppDb) {
    // 启动时把坏库抢救出来的标签灌进 tags 表，之后按路径回填归属
    const salvaged = db.salvaged
    if (salvaged && salvaged.names.length > 0) {
      db.transaction(() => {
        for (const t of salvaged.names) {
          const exists = db.get('select id from tags where name = ? collate nocase', t.name)
          if (exists) continue
          if (t.color) db.run('insert into tags(name, color) values(?, ?)', t.name, t.color)
          else db.run('insert into tags(name) values(?)', t.name)
        }
      })
      this.fileTagRestore = new Map()
      for (const [p, names] of salvaged.byPath) {
        this.fileTagRestore.set(p, { tags: names, project: salvaged.projectsByPath?.get(p) ?? null })
      }
    }
  }

  /** 小写路径 → 从坏库/快照抢救出来的归属。新行入库时按路径回填一次 */
  private fileTagRestore: Map<string, { tags: string[]; project: string | null }> | null = null

  private invalidate(): void {
    this.rulesCache = null
  }

  // ---------------------------------------------------------------- 读

  listAll(): StoredFile[] {
    const rows = this.db.all(
      `select id, path, dir, name, ext, size, mtime, dev, ino, width, height, thumb_key, project_id
         from files where missing_at is null order by mtime desc`
    )
    if (rows.length === 0) return []

    const tagsByFile = this.allTags()
    this.loadProjects()
    return rows.map((r) => {
      const id = num(r['id'])
      const pid = numOrNull(r['project_id'])
      return {
        id,
        path: str(r['path']),
        dir: str(r['dir']),
        name: str(r['name']),
        ext: str(r['ext']),
        size: num(r['size']),
        mtime: num(r['mtime']),
        dev: strOrNull(r['dev']),
        ino: strOrNull(r['ino']),
        width: numOrNull(r['width']),
        height: numOrNull(r['height']),
        thumbKey: strOrNull(r['thumb_key']),
        projectId: pid,
        project: pid ? (this.projectCache.get(pid) ?? null) : null,
        tags: tagsByFile.get(id) ?? []
      }
    })
  }

  /** 一次 join 出所有标签归属，避免 5000 行各查一次 */
  private allTags(): Map<number, Tag[]> {
    const out = new Map<number, Tag[]>()
    const rows = this.db.all(
      'select ft.file_id as fid, t.id as id, t.name as name, t.color as color from file_tags ft join tags t on t.id = ft.tag_id'
    )
    for (const r of rows) {
      const fid = num(r['fid'])
      const tag: Tag = { id: num(r['id']), name: str(r['name']) }
      const color = strOrNull(r['color'])
      if (color) tag.color = color
      const list = out.get(fid)
      if (list) list.push(tag)
      else out.set(fid, [tag])
    }
    return out
  }

  private loadProjects(): void {
    if (this.projectCache.size > 0) return
    const rows = this.db.all('select id, name, client, color from projects')
    for (const r of rows) {
      const p: Project = { id: num(r['id']), name: str(r['name']), client: str(r['client']) }
      const color = strOrNull(r['color'])
      if (color) p.color = color
      this.projectCache.set(p.id, p)
    }
  }

  tagsOf(fileId: number): Tag[] {
    const rows = this.db.all(
      'select t.id, t.name, t.color from file_tags ft join tags t on t.id = ft.tag_id where ft.file_id = ?',
      fileId
    )
    return rows.map((r) => {
      const tag: Tag = { id: num(r['id']), name: str(r['name']) }
      const color = strOrNull(r['color'])
      if (color) tag.color = color
      return tag
    })
  }

  private rules(): Array<{ prefix: string; tagId: number }> {
    if (this.rulesCache) return this.rulesCache
    const rows = this.db.all('select prefix, tag_id from auto_tag_rules')
    const list = rows.map((r) => ({ prefix: str(r['prefix']).toLowerCase(), tagId: num(r['tag_id']) }))
    // 最长前缀优先：`D:\稿件\客户A\2026` 比 `D:\稿件` 更精确
    list.sort((a, b) => b.prefix.length - a.prefix.length)
    this.rulesCache = list
    return list
  }

  // ---------------------------------------------------------------- 写

  /**
   * 批量入库。整批一个事务：5000 行分 25 次提交（每次 200 行），
   * 单行提交会让 SQLite 每行 fsync 一次，慢到不可用。
   */
  upsertBatch(items: FileUpsertInput[], now: number): FileUpsertResult[] {
    if (items.length === 0) return []
    const rules = this.rules()
    this.loadProjects()

    return this.db.transaction(() => {
      const out: FileUpsertResult[] = []
      for (const it of items) out.push(this.upsertOne(it, now, rules))
      return out
    })
  }

  private upsertOne(
    it: FileUpsertInput,
    now: number,
    rules: Array<{ prefix: string; tagId: number }>
  ): FileUpsertResult {
    const identDev = it.dev && it.dev !== '0' ? it.dev : null
    const identIno = it.ino && it.ino !== '0' ? it.ino : null
    const ident = identityOf(identDev, identIno)

    let row = ident
      ? this.db.get(
          'select id, path, project_id from files where dev = ? and ino = ? order by (missing_at is null) desc, last_seen desc limit 1',
          identDev,
          identIno
        )
      : undefined

    if (!row) {
      // 活行优先；没有活行时把最近一条软删行捡回来（移出目录又移回来，标签还在）
      row = this.db.get(
        'select id, path, project_id from files where path = ? order by (missing_at is null) desc, last_seen desc limit 1',
        it.path
      )
    }

    let id: number
    let created = false
    let renamedFrom: string | undefined
    let projectId: number | null

    if (row) {
      id = num(row['id'])
      projectId = numOrNull(row['project_id'])
      const oldPath = str(row['path'])
      if (oldPath !== it.path) {
        renamedFrom = oldPath
        // 新路径上如果还挂着另一条活行，说明那个文件已经不在那儿了 —— 标成历史，不删（标签可能还有用）
        const conflict = this.db.get(
          'select id from files where path = ? and missing_at is null and id <> ?',
          it.path,
          id
        )
        if (conflict) this.db.run('update files set missing_at = ? where id = ?', now, num(conflict['id']))
      }
      this.db.run(
        `update files set path = ?, dir = ?, name = ?, ext = ?, size = ?, mtime = ?, dev = ?, ino = ?,
                thumb_key = coalesce(?, thumb_key), last_seen = ?, missing_at = null
           where id = ?`,
        it.path,
        it.dir,
        it.name,
        it.ext,
        it.size,
        it.mtime,
        identDev,
        identIno,
        it.thumbKey ?? null,
        now,
        id
      )
    } else {
      const res = this.db.run(
        `insert into files(path, dir, name, ext, size, mtime, dev, ino, thumb_key, first_seen, last_seen)
         values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        it.path,
        it.dir,
        it.name,
        it.ext,
        it.size,
        it.mtime,
        identDev,
        identIno,
        it.thumbKey ?? null,
        now,
        now
      )
      id = res.id
      created = true
      projectId = null
      this.applyInitialTags(id, it.path, it.dir, rules)
    }

    return {
      path: it.path,
      id,
      created,
      renamedFrom,
      tags: this.tagsOf(id),
      projectId,
      project: projectId ? (this.projectCache.get(projectId) ?? null) : null
    }
  }

  /**
   * 新行入库时打标签：先套自动规则（最长前缀），再把损坏库里抢救出来的归属补上。
   * 只在新行时执行 —— 之后用户手动改过就以手动为准，不再回弹。
   */
  private applyInitialTags(id: number, path: string, dir: string, rules: Array<{ prefix: string; tagId: number }>): void {
    const dirLower = dir.toLowerCase().replaceAll('/', '\\')

    const restored = this.fileTagRestore?.get(path.toLowerCase())
    if (restored) {
      for (const name of restored.tags) {
        const tagId = this.ensureTag(name).id
        this.db.run('insert or ignore into file_tags(file_id, tag_id, source) values(?, ?, ?)', id, tagId, 'manual')
      }
      if (restored.project) {
        const project = this.db.get('select id from projects where name = ? collate nocase', restored.project)
        if (project) this.db.run('update files set project_id = ? where id = ?', num(project['id']), id)
      }
      this.fileTagRestore?.delete(path.toLowerCase())
    }

    for (const rule of rules) {
      if (!dirLower.startsWith(rule.prefix)) continue
      if (!dirLower.endsWith('\\') && dirLower.length > rule.prefix.length) {
        // 前缀必须停在目录边界上：`D:\稿件\客户AB` 不该命中 `D:\稿件\客户A`
        const next = dirLower.charAt(rule.prefix.length)
        if (next !== '\\') continue
      }
      this.db.run('insert or ignore into file_tags(file_id, tag_id, source) values(?, ?, ?)', id, rule.tagId, 'auto')
      break // 只套最精确的那一条
    }
  }

  /** 名字查 id，没有就建。大小写不敏感：用户打「线稿」和「线稿 」不该是两条 */
  ensureTag(name: string): Tag {
    const clean = name.trim().slice(0, 40)
    const found = this.db.get('select id, name, color from tags where name = ? collate nocase', clean)
    if (found) {
      const tag: Tag = { id: num(found['id']), name: str(found['name']) }
      const color = strOrNull(found['color'])
      if (color) tag.color = color
      return tag
    }
    const res = this.db.run('insert into tags(name) values(?)', clean)
    return { id: res.id, name: clean }
  }

  markMissing(paths: string[], now: number): void {
    if (paths.length === 0) return
    this.db.transaction(() => {
      for (const p of paths) {
        this.db.run('update files set missing_at = ? where path = ? and missing_at is null', now, p)
      }
    })
  }

  /**
   * 全量扫描结束后调用：库里那些「本轮没扫到」的活行 → 标为历史，返回它们的路径。
   *
   * 判据是**路径集合**而不是 `last_seen` 时间戳：后者每轮都要给全部 5000 行写一次，
   * 二次启动就变成 5000 次 UPDATE，跟"零变更零写库"的验收口径冲突。
   * 扫到的路径这里是现成的，用它做差集，只有真正消失的行才落库。
   */
  sweepMissing(seenPaths: string[], now: number): string[] {
    const live = this.db.all('select id, path from files where missing_at is null')
    if (live.length === 0) return []
    const seen = new Set(seenPaths.map((p) => p.toLowerCase()))
    const gone = live.filter((r) => !seen.has(str(r['path']).toLowerCase()))
    if (gone.length === 0) return []
    this.db.transaction(() => {
      for (const r of gone) this.db.run('update files set missing_at = ? where id = ?', now, num(r['id']))
    })
    return gone.map((r) => str(r['path']))
  }

  /** 30 天前就消失的行真删掉（级联清 file_tags）。每次启动最多跑一次 */
  purgeExpired(cutoff: number): number {
    const row = this.db.get('select count(*) as c from files where missing_at is not null and missing_at < ?', cutoff)
    const count = num(row?.['c'])
    if (count === 0) return 0
    this.db.run('delete from files where missing_at is not null and missing_at < ?', cutoff)
    return count
  }

  patchGeometry(id: number, width: number, height: number, thumbKey?: string): void {
    if (thumbKey) this.db.run('update files set width = ?, height = ?, thumb_key = ? where id = ?', width, height, thumbKey, id)
    else this.db.run('update files set width = ?, height = ? where id = ?', width, height, id)
  }

  // ---------------------------------------------------------------- 元数据

  setTags(fileId: number, names: string[], source: 'manual' | 'auto' = 'manual'): Tag[] {
    const unique: string[] = []
    const seen = new Set<string>()
    for (const raw of names) {
      const clean = raw.trim().slice(0, 40)
      if (!clean) continue
      const key = clean.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(clean)
    }
    this.db.transaction(() => {
      this.db.run('delete from file_tags where file_id = ?', fileId)
      for (const name of unique) {
        const tag = this.ensureTag(name)
        this.db.run(
          'insert or ignore into file_tags(file_id, tag_id, source) values(?, ?, ?)',
          fileId,
          tag.id,
          source
        )
      }
    })
    return this.tagsOf(fileId)
  }

  setProject(fileId: number, projectId: number | null): Project | null {
    this.db.run('update files set project_id = ? where id = ?', projectId, fileId)
    if (!projectId) return null
    this.loadProjects()
    return this.projectCache.get(projectId) ?? null
  }

  /** 项目改名 / 删除后让缓存失效 */
  invalidateProjects(): void {
    this.projectCache.clear()
  }

  invalidateRules(): void {
    this.invalidate()
  }

  pathOf(fileId: number): string | null {
    const row = this.db.get('select path from files where id = ?', fileId)
    return row ? str(row['path']) : null
  }
}
