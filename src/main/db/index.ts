import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { StatementSync } from 'node:sqlite'
import type { Logger } from '../logger'
import { DDL, SCHEMA_VERSION } from './schema'

/**
 * 索引库生命周期（M2b T3.1）。
 *
 * 用 Node 24 内置的 `node:sqlite`，不引 better-sqlite3 —— 免原生编译、免 electron-rebuild，
 * 安装包体积也不涨。接口收敛在这个文件里，万一将来打包后发现 asar 内不可用，
 * 换实现只改这一处。
 *
 * 三件必须做对的事：
 *  1. **损坏自愈**：用户不会去修数据库。启动 quick_check 不过就把文件改名留证、重建，
 *     并尽量把标签从坏库里抢救出来（`salvageTags`）—— 标签是这个程序里唯一"重建会丢、
 *     丢了无法恢复"的数据，其他都能重扫出来。
 *  2. **语句缓存**：5000 行插入如果每行都 prepare，光编译 SQL 就要几百毫秒。
 *  3. **WAL + 退出 checkpoint**：不然 `data/` 里会常驻 `-wal` / `-shm`，用户以为是垃圾文件。
 */

/** 从坏库里抢救出来的标签：按旧路径找回归属 */
export interface SalvagedTags {
  /** 标签名 → 颜色 */
  names: Array<{ name: string; color: string | null }>
  /** 小写路径 → 标签名列表 */
  byPath: Map<string, string[]>
  /** 小写路径 → 项目名。库整表读不出来时靠它把项目归属也捡回来 */
  projectsByPath?: Map<string, string>
  /** 从元数据快照恢复的项目（库整表读不出来时用） */
  projects?: Array<{ name: string; client: string; color: string | null }>
  /** 从元数据快照恢复的自动规则 */
  rules?: Array<{ prefix: string; tagName: string }>
}

/** 元数据快照。只有标签 / 项目 / 规则 / 归属这些"重扫不出来"的数据，没有文件行 */
interface MetaBackup {
  v: number
  tags: Array<{ name: string; color: string | null }>
  projects: Array<{ name: string; client: string; color: string | null }>
  rules: Array<{ prefix: string; tagName: string }>
  links: Array<{ path: string; tags: string[]; project: string | null }>
}

/** 这些表/列发生变化才需要刷新快照；纯文件 upsert 不碰它 */
const META_SQL = /\b(tags|projects|file_tags|auto_tag_rules|project_id)\b/i

export interface DbStats {
  files: number
  missing: number
  tags: number
  projects: number
}

function asNum(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0)
}

function asStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

export class AppDb {
  private db: DatabaseSync
  private stmts = new Map<string, StatementSync>()
  private depth = 0
  /** 损坏重建时抢救到的标签，交给 FileStore 在重新入库时按路径套用 */
  readonly salvaged: SalvagedTags | null
  readonly file: string
  readonly metaBackupFile: string
  private backupTimer: NodeJS.Timeout | null = null
  private closed = false

  constructor(file: string, private readonly log: Logger) {
    this.file = file
    this.metaBackupFile = `${file}.meta.json`
    mkdirSync(dirname(file), { recursive: true })

    let salvaged: SalvagedTags | null = null
    // 顺序很关键：坏库连 `PRAGMA journal_mode=WAL` 都会抛 "database disk image is malformed"。
    // 必须先自检、必要时隔离重建，再对新库设 pragma —— 反了就永远走不到自愈分支。
    let db = this.rawOpen()
    if (!this.integrity(db)) {
      // 先关掉再改名：Windows 上文件被占用时 rename 会失败
      try {
        db.close()
      } catch {
        /* 已经坏了，关不掉也无所谓 */
      }
      const broken = this.quarantine()
      if (broken) salvaged = this.salvage(broken)
      // 整库被截断时连 tags 表都读不出来，只能靠旁边那份轻量快照。
      const backup = this.readMetaBackup()
      if (backup) {
        if (!salvaged) salvaged = backup
        else {
          const known = new Set(salvaged.names.map((t) => t.name.toLowerCase()))
          for (const t of backup.names) if (!known.has(t.name.toLowerCase())) salvaged.names.push(t)
          for (const [p, tags] of backup.byPath) {
            const current = salvaged.byPath.get(p)
            if (!current) salvaged.byPath.set(p, [...tags])
            else for (const t of tags) if (!current.includes(t)) current.push(t)
          }
          salvaged.projects = backup.projects
          salvaged.rules = backup.rules
          salvaged.projectsByPath = backup.projectsByPath
        }
        this.log.warn('db', `元数据快照已载入：${backup.names.length} 个标签、${backup.byPath.size} 个文件的归属`)
      }
      db = this.rawOpen()
    }
    this.configure(db)
    this.db = db
    this.salvaged = salvaged
    this.migrate()
    const st = this.stats()
    this.log.info(
      'db',
      `索引库就绪：${file}（${st.files} 个文件 / ${st.missing} 条历史 / ${st.tags} 个标签${
        salvaged ? `；已从损坏库抢救 ${salvaged.names.length} 个标签` : ''
      }）`
    )
  }

  private rawOpen(): DatabaseSync {
    return new DatabaseSync(this.file)
  }

  /** 只对自检通过的库设置。坏库上任何 pragma 都可能直接抛错 */
  private configure(db: DatabaseSync): void {
    // WAL：读写不互斥，退出时不留 -wal 才算收干净（close 里有 checkpoint）
    db.exec('PRAGMA journal_mode = WAL')
    // NORMAL 而不是 FULL：断电最多丢最后几次写入，但不会损坏库；FULL 每次 fsync 太慢
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 3000')
  }

  /** quick_check 比 integrity_check 快一个数量级，5000 行 20ms 以内 */
  private integrity(db: DatabaseSync): boolean {
    try {
      const row = db.prepare('PRAGMA quick_check').get()
      const verdict = asStr(row?.['quick_check'] ?? Object.values(row ?? {})[0])
      if (verdict.toLowerCase() !== 'ok') {
        this.log.warn('db', `索引库自检未通过：${verdict.slice(0, 120)}`)
        return false
      }
      return true
    } catch (err) {
      this.log.warn('db', `索引库自检抛错：${String(err)}`)
      return false
    }
  }

  /** 把坏库改名留证（不删，用户可能想自己捞数据），顺带清掉残留的 -wal / -shm */
  private quarantine(): string | null {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const broken = `${this.file}.broken-${stamp}`
    try {
      if (existsSync(this.file)) renameSync(this.file, broken)
      rmSync(`${this.file}-wal`, { force: true })
      rmSync(`${this.file}-shm`, { force: true })
      this.log.warn('db', `索引库已损坏，原文件备份为 ${broken}，正在重建`)
      return broken
    } catch (err) {
      this.log.error('db', `索引库损坏且无法备份：${String(err)}`)
      rmSync(this.file, { force: true })
      return null
    }
  }

  /**
   * 从坏库里尽量捞出标签。坏库往往只是 B-tree 某页坏了，标签表通常还在。
   * 捞不到就返回 null —— 调用方不需要区分"没标签"和"抢救失败"。
   */
  private salvage(brokenPath: string): SalvagedTags | null {
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(brokenPath)
      const tagRows = db.prepare('select id, name, color from tags').all()
      const names = tagRows.map((r) => ({
        name: asStr(r['name']),
        color: r['color'] === null || r['color'] === undefined ? null : asStr(r['color'])
      }))
      const idToName = new Map<number, string>()
      for (const r of tagRows) idToName.set(asNum(r['id']), asStr(r['name']))

      const links = db
        .prepare('select lower(f.path) as p, ft.tag_id as tid from file_tags ft join files f on f.id = ft.file_id')
        .all()
      const byPath = new Map<string, string[]>()
      for (const r of links) {
        const name = idToName.get(asNum(r['tid']))
        const p = asStr(r['p'])
        if (!name || !p) continue
        const list = byPath.get(p)
        if (list) list.push(name)
        else byPath.set(p, [name])
      }
      this.log.warn('db', `从损坏库抢救出 ${names.length} 个标签、${byPath.size} 个文件的归属，重建后按路径回填`)
      return { names, byPath }
    } catch (err) {
      this.log.warn('db', `损坏库抢救失败（标签将丢失）：${String(err)}`)
      return null
    } finally {
      try {
        db?.close()
      } catch {
        /* 坏库关不掉 */
      }
    }
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get()
    const version = asNum(row?.['user_version'] ?? 0)
    if (version >= SCHEMA_VERSION) return
    this.db.exec(DDL)
    // 只能拼进 SQL：pragma 不支持参数绑定。SCHEMA_VERSION 是代码里的常量，不存在注入
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    this.log.info('db', `索引库结构升级到 v${SCHEMA_VERSION}（原 v${version}）`)
  }

  // ---------------------------------------------------------------- 语句

  private stmt(sql: string): StatementSync {
    const hit = this.stmts.get(sql)
    if (hit) return hit
    const prepared = this.db.prepare(sql)
    this.stmts.set(sql, prepared)
    return prepared
  }

  all(sql: string, ...params: Array<number | string | null>): Array<Record<string, unknown>> {
    return this.stmt(sql).all(...params)
  }

  get(sql: string, ...params: Array<number | string | null>): Record<string, unknown> | undefined {
    return this.stmt(sql).get(...params)
  }

  run(sql: string, ...params: Array<number | string | null>): { changes: number; id: number } {
    const res = this.stmt(sql).run(...params)
    if (META_SQL.test(sql)) this.scheduleBackup()
    return { changes: asNum(res.changes), id: asNum(res.lastInsertRowid) }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  // ---------------------------------------------------------------- 元数据快照

  /** 元数据变更后 150ms 落盘；连着打 10 个标签只写一次 */
  private scheduleBackup(): void {
    if (this.backupTimer || this.closed) return
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null
      this.saveMetaBackup()
    }, 150)
  }

  /**
   * 把"重扫扫不回来"的数据另存一份 JSON。
   * 库被截断 / 页损坏到连 tags 表都读不出来时，这是唯一能救回标签的东西。
   * 原子替换（先写 .tmp 再 rename）避免半截 JSON 在断电时留下。
   */
  saveMetaBackup(): void {
    if (this.closed) return
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }
    try {
      const tags = this.all('select name, color from tags order by id').map((r) => ({
        name: asStr(r['name']),
        color: r['color'] === null || r['color'] === undefined ? null : asStr(r['color'])
      }))
      const projects = this.all('select name, client, color from projects order by id').map((r) => ({
        name: asStr(r['name']),
        client: asStr(r['client']),
        color: r['color'] === null || r['color'] === undefined ? null : asStr(r['color'])
      }))
      const rules = this.all(
        'select r.prefix as prefix, t.name as tag_name from auto_tag_rules r join tags t on t.id = r.tag_id'
      ).map((r) => ({ prefix: asStr(r['prefix']), tagName: asStr(r['tag_name']) }))

      const grouped = new Map<string, { tags: string[]; project: string | null }>()
      const rows = this.all(
        `select lower(f.path) as p, t.name as tag_name, pr.name as project_name
           from file_tags ft
           join files f on f.id = ft.file_id
           join tags t on t.id = ft.tag_id
           left join projects pr on pr.id = f.project_id`
      )
      for (const r of rows) {
        const p = asStr(r['p'])
        if (!p) continue
        const item = grouped.get(p) ?? { tags: [], project: null }
        const name = asStr(r['tag_name'])
        if (name && !item.tags.includes(name)) item.tags.push(name)
        if (!item.project) item.project = r['project_name'] ? asStr(r['project_name']) : null
        grouped.set(p, item)
      }
      const data: MetaBackup = {
        v: 1,
        tags,
        projects,
        rules,
        links: [...grouped].map(([path, v]) => ({ path, tags: v.tags, project: v.project }))
      }
      const tmp = `${this.metaBackupFile}.tmp`
      writeFileSync(tmp, JSON.stringify(data), 'utf8')
      renameSync(tmp, this.metaBackupFile)
    } catch (err) {
      this.log.warn('db', `元数据快照写入失败：${String(err)}`)
    }
  }

  private readMetaBackup(): SalvagedTags | null {
    try {
      const data = JSON.parse(readFileSync(this.metaBackupFile, 'utf8')) as MetaBackup
      if (data.v !== 1 || !Array.isArray(data.tags)) return null
      const byPath = new Map<string, string[]>()
      const projectsByPath = new Map<string, string>()
      for (const link of data.links ?? []) {
        if (!link.path) continue
        const key = link.path.toLowerCase()
        if (Array.isArray(link.tags) && link.tags.length > 0) byPath.set(key, [...link.tags])
        if (link.project) projectsByPath.set(key, link.project)
      }
      return {
        names: data.tags.map((t) => ({ name: t.name, color: t.color ?? null })),
        byPath,
        projectsByPath,
        projects: data.projects ?? [],
        rules: data.rules ?? []
      }
    } catch {
      return null
    }
  }

  /** 批量写必须走事务：单行各自提交时 5000 行要 fsync 5000 次 */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn() // 嵌套时并入外层事务
    this.db.exec('BEGIN')
    this.depth += 1
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* 事务已经因为错误回滚了 */
      }
      throw err
    } finally {
      this.depth -= 1
    }
  }

  stats(): DbStats {
    const one = (sql: string): number => asNum(this.get(sql)?.['c'] ?? 0)
    return {
      files: one('select count(*) as c from files where missing_at is null'),
      missing: one('select count(*) as c from files where missing_at is not null'),
      tags: one('select count(*) as c from tags'),
      projects: one('select count(*) as c from projects')
    }
  }

  close(): void {
    // 先把还没到 150ms 的快照刷掉，再关库
    this.saveMetaBackup()
    this.closed = true
    this.stmts.clear()
    try {
      // 把 WAL 合回主文件：不然退出后 data/ 里留两个几十 MB 的旁文件
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* 没有 WAL 或已关闭 */
    }
    try {
      this.db.close()
    } catch (err) {
      this.log.warn('db', `关闭索引库失败：${String(err)}`)
    }
  }
}
