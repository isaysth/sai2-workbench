import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '@shared/types'

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR'
}

const MAX_BUFFER = 2000       // 内存里保留最近 2000 条，供日志页回填
const KEEP_DAYS = 7           // 日志文件按天滚动，保留 7 天

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function fullStamp(d = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

export type LogSink = (entry: LogEntry) => void

/**
 * 日志中心：写文件 + 内存环形缓冲 + 推送给订阅者（日志页）。
 * 写文件用同步追加：日志量很小，换来的是「崩溃前的最后一条也一定落盘」。
 */
export class Logger {
  private dateKey: string
  private filePath: string
  private buffer: LogEntry[] = []
  private sinks = new Set<LogSink>()

  constructor(private readonly logDir: string, private readonly echoToConsole = false) {
    mkdirSync(logDir, { recursive: true })
    this.dateKey = dayKey()
    this.filePath = this.pathFor(this.dateKey)
    this.pruneOld()
  }

  private pathFor(key: string): string {
    return join(this.logDir, `app-${key}.log`)
  }

  /** 启动时清理超过保留期的日志 */
  private pruneOld(): void {
    try {
      const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000
      for (const name of readdirSync(this.logDir)) {
        if (!name.startsWith('app-') || !name.endsWith('.log')) continue
        const full = join(this.logDir, name)
        if (statSync(full).mtimeMs < limit) unlinkSync(full)
      }
    } catch {
      /* 清理失败不影响主流程 */
    }
  }

  private rotateIfNeeded(): void {
    const key = dayKey()
    if (key === this.dateKey) return
    this.dateKey = key
    this.filePath = this.pathFor(key)
    this.pruneOld()
  }

  /** 订阅日志流，返回取消订阅函数 */
  subscribe(sink: LogSink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  history(limit = 500): LogEntry[] {
    return limit > 0 ? this.buffer.slice(-limit) : [...this.buffer]
  }

  clearBuffer(): void {
    this.buffer = []
  }

  get file(): string {
    return this.filePath
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const entry: LogEntry = { time: Date.now(), level, scope, message }

    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER)

    for (const sink of this.sinks) {
      try {
        sink(entry)
      } catch {
        /* 订阅者异常绝不能反过来弄坏日志本身 */
      }
    }

    const line = `${fullStamp(new Date(entry.time))} [${LEVEL_TAG[level]}] [${scope}] ${message}\n`
    try {
      this.rotateIfNeeded()
      appendFileSync(this.filePath, line, 'utf8')
    } catch {
      /* 磁盘满/无权限时静默，避免日志把程序拖崩 */
    }

    if (this.echoToConsole) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(line.trimEnd())
    }
  }

  debug(scope: string, message: string): void { this.write('debug', scope, message) }
  info(scope: string, message: string): void { this.write('info', scope, message) }
  warn(scope: string, message: string): void { this.write('warn', scope, message) }
  error(scope: string, message: string): void { this.write('error', scope, message) }
}

/** 把任意异常压成一行可读文本，写日志与提示都用它 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
