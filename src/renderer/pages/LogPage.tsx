import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { LogEntry, LogLevel } from '@shared/types'
import { IconExternal, IconPause, IconSearch, IconTerminal, IconTrash } from '../components/Icons'

type LevelFilter = 'all' | LogLevel

const FILTERS: Array<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: '全部级别' },
  { value: 'error', label: '只看错误' },
  { value: 'warn', label: '警告及以上' },
  { value: 'info', label: '信息及以上' }
]

function matchLevel(entry: LogEntry, filter: LevelFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'error':
      return entry.level === 'error'
    case 'warn':
      return entry.level === 'warn' || entry.level === 'error'
    case 'info':
      return entry.level !== 'debug'
    case 'debug':
      return true
    default:
      return true
  }
}

function hhmmss(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 运行日志页。
 * 实时流来自主进程推送；暂停时主进程继续写文件，只是界面不再追加（恢复时重新拉历史）。
 */
export function LogPage({ onToast }: { onToast: (msg: string) => void }): ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<LevelFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const loadHistory = useCallback(async () => {
    const list = await window.api.log.history(600)
    setEntries(list)
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const off = window.api.log.onAppend((entry) => {
      if (pausedRef.current) return
      setEntries((prev) => {
        const next = prev.length >= 800 ? prev.slice(prev.length - 700) : prev.slice()
        next.push(entry)
        return next
      })
    })
    return off
  }, [])

  // 自动滚到底：只有用户本来就贴着底部时才跟随，避免打断向上翻看
  useEffect(() => {
    const el = listRef.current
    if (!el || paused) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [entries, paused])

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return entries.filter((e) => {
      if (!matchLevel(e, level)) return false
      if (!kw) return true
      return (
        e.message.toLowerCase().includes(kw) ||
        e.scope.toLowerCase().includes(kw) ||
        e.level.includes(kw)
      )
    })
  }, [entries, level, keyword])

  const togglePause = (): void => {
    const next = !paused
    setPaused(next)
    if (!next) void loadHistory()
  }

  const clear = async (): Promise<void> => {
    await window.api.log.clear()
    setEntries([])
    onToast('已清空界面日志（磁盘日志文件保留）')
  }

  const openFile = async (): Promise<void> => {
    const res = await window.api.log.openFile()
    if (!res.ok) onToast(res.error ?? '打不开日志文件')
  }

  return (
    <div className={`page log-page${expanded ? ' is-fullscreen' : ''}`} style={{ gap: 0, padding: 0 }}>
      <div className="log-toolbar">
        <select
          className="select"
          value={level}
          onChange={(e) => setLevel(e.target.value as LevelFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-3)',
              display: 'flex'
            }}
          >
            <IconSearch />
          </span>
          <input
            className="input"
            style={{ width: '100%', paddingLeft: 30 }}
            placeholder="搜索关键字 / 模块"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <button className={`btn${paused ? ' is-primary' : ''}`} onClick={togglePause}>
          <IconPause size={13} />
          {paused ? '继续' : '暂停'}
        </button>
        <button className="btn" onClick={() => void clear()}>
          <IconTrash />
          清空
        </button>
        <button className="btn" onClick={() => void openFile()}>
          <IconExternal />
          日志文件
        </button>
        <button className="btn is-ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '退出全屏' : '全屏'}
        </button>

        <span className="tag" style={{ marginLeft: 'auto' }}>
          {visible.length} / {entries.length} 条
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="empty" style={{ margin: 16, borderStyle: 'solid' }}>
          <div className="empty-mark">
            <IconTerminal size={22} />
          </div>
          <div className="empty-title">没有匹配的日志</div>
          <div className="empty-desc">
            换个关键字或把级别调回「全部级别」。程序运行中的每一步都会记在这里，日志文件按天存在 data/logs。
          </div>
        </div>
      ) : (
        <div className="log-list" ref={listRef}>
          {visible.map((e, i) => (
            <div className="log-row" data-level={e.level} key={`${e.time}-${i}`}>
              <span className="log-time">{hhmmss(e.time)}</span>
              <span className="log-level">{e.level.toUpperCase()}</span>
              <span className="log-scope" title={e.scope}>
                {e.scope}
              </span>
              <span className="log-msg">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
