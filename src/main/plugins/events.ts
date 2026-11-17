/**
 * 插件事件总线。事件名用固定清单，插件拼错名字会当场报错而不是静默失效。
 * 派发是「发射后不管」：插件监听器抛错只记日志，绝不反过来弄坏主程序。
 */
import type { Logger } from '../logger'

export const PLUGIN_EVENTS = [
  'app_ready',
  'app_quit',
  'opener_before_launch',
  'opener_after_launch',
  'file_added',
  'file_removed',
  'file_modified',
  'file_renamed',
  'file_moved',
  'file_open',
  'theme_changed'
] as const

export type PluginEventName = (typeof PLUGIN_EVENTS)[number]
export type PluginEventHandler = (payload?: unknown) => void | Promise<void>

interface HandlerEntry {
  scope: string
  fn: PluginEventHandler
}

export class PluginEvents {
  private readonly handlers = new Map<PluginEventName, HandlerEntry[]>()

  constructor(private readonly log: Logger) {}

  isKnown(name: string): name is PluginEventName {
    return (PLUGIN_EVENTS as readonly string[]).includes(name)
  }

  on(scope: string, event: PluginEventName, fn: PluginEventHandler): () => void {
    const list = this.handlers.get(event) ?? []
    const entry: HandlerEntry = { scope, fn }
    list.push(entry)
    this.handlers.set(event, list)
    return () => this.off(entry, event)
  }

  private off(entry: HandlerEntry, event: PluginEventName): void {
    const list = this.handlers.get(event)
    if (!list) return
    const index = list.indexOf(entry)
    if (index >= 0) list.splice(index, 1)
    if (list.length === 0) this.handlers.delete(event)
  }

  /** 同步派发；异步监听器的拒绝单独接住，不影响其它监听器 */
  emit(event: PluginEventName, payload?: unknown): void {
    for (const entry of [...(this.handlers.get(event) ?? [])]) {
      try {
        const result = entry.fn(payload)
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((err: unknown) => {
            this.log.error('plugin', `事件 ${event} 的监听器（${entry.scope}）失败：${String(err)}`)
          })
        }
      } catch (err) {
        this.log.error('plugin', `事件 ${event} 的监听器（${entry.scope}）失败：${String(err)}`)
      }
    }
  }

  /** 插件卸载时清掉它订阅过的所有事件 */
  clearScope(scope: string): void {
    for (const [event, list] of this.handlers) {
      const kept = list.filter((entry) => entry.scope !== scope)
      if (kept.length === 0) this.handlers.delete(event)
      else this.handlers.set(event, kept)
    }
  }
}
