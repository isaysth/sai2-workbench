/**
 * 主题变量服务（M3b）：插件贡献 CSS 变量，内核做白名单过滤与聚合。
 *
 * 安全边界：
 *  - 只允许改 --accent / --radius / --font-scale 等「外观变量」白名单；
 *  - 不允许插件覆盖 M1 定版的透明参数（--glass-alpha / --glass-blur / --bg-clarity）；
 *  - 值做基本校验，非法值直接丢弃并告警 —— 主题写坏要回退浅色，不能白屏。
 */
export interface ThemeServiceDeps {
  onChange: () => void
  log: {
    warn: (scope: string, msg: string) => void
    error: (scope: string, msg: string) => void
  }
}

/** 允许插件覆盖的变量前缀。只允许自定义属性，杜绝注入任意 CSS */
export const THEME_VAR_WHITELIST = [
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--radius',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--card-radius',
  '--btn-radius',
  '--font-scale'
] as const

/** M1 定版的交互参数，插件不得覆盖 */
const LOCKED_VARS = ['--glass-alpha', '--glass-blur', '--bg-clarity', '--sheet', '--bg-image-url']

/** 值只允许安全字符：颜色 / 数字 / px / rem / % / 简单关键字。禁止 ; { } 防止 CSS 注入 */
const SAFE_VALUE = /^[\w\s#,.%+/-]+$/u

export class ThemeService {
  /** pluginId → 变量表；同名插件重注册覆盖 */
  private readonly contributions = new Map<string, Record<string, string>>()

  constructor(private readonly deps: ThemeServiceDeps) {}

  /**
   * 插件注册变量。返回注销函数，交给 ctx.effect 在禁用 / 卸载时清理。
   * 非法变量整张表丢弃（而不是部分生效）—— 半套主题比不生效更让人困惑。
   */
  registerVars(pluginId: string, raw: Record<string, unknown>): () => void {
    const clean: Record<string, string> = {}
    const allowed = new Set<string>(THEME_VAR_WHITELIST)

    for (const [key, value] of Object.entries(raw ?? {})) {
      const name = key.trim()
      if (!allowed.has(name)) {
        if (!LOCKED_VARS.includes(name)) this.deps.log.warn('theme', `插件 ${pluginId} 的变量 ${name} 不在白名单，已忽略`)
        continue
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        this.deps.log.warn('theme', `插件 ${pluginId} 的变量 ${name} 值类型非法，已忽略`)
        continue
      }
      const text = String(value).trim()
      if (!text || text.length > 120 || !SAFE_VALUE.test(text)) {
        this.deps.log.warn('theme', `插件 ${pluginId} 的变量 ${name} 值不安全，已忽略：${text}`)
        continue
      }
      clean[name] = text
    }

    this.contributions.set(pluginId, clean)
    this.deps.onChange()
    return () => {
      if (this.contributions.get(pluginId) === clean) this.contributions.delete(pluginId)
      this.deps.onChange()
    }
  }

  /** 聚合后的变量表：后注册者覆盖先注册者 */
  getVars(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const table of this.contributions.values()) {
      for (const [key, value] of Object.entries(table)) out[key] = value
    }
    return out
  }

  clear(): void {
    if (this.contributions.size === 0) return
    this.contributions.clear()
    this.deps.onChange()
  }
}
