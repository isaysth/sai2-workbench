/**
 * 插件系统的跨进程类型。主进程加载器与渲染端插件中心共用这一份。
 */

/** 插件 API 版本。manifest 上的 apiVersion 必须严格等于它 */
export const PLUGIN_API_VERSION = 1

export type PluginStatus = 'waiting' | 'running' | 'failed' | 'disabled'

export type ConfigFieldType = 'string' | 'bool' | 'int' | 'float' | 'enum' | 'path' | 'list'

/** 声明式配置字段：插件页据此自动生成表单，插件作者不写 UI */
export interface ConfigField {
  type: ConfigFieldType
  label: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: string[] | Array<{ value: string; label: string }>
  /** path 字段的文件选择器类型 */
  filter?: 'exe' | 'dir' | 'file'
  /** list 字段的单行结构 */
  item?: Record<string, ConfigField>
  hint?: string
}

export type ConfigSchema = Record<string, ConfigField>

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  author: string
  description: string
  entry: string
  /** 系统插件不允许在正常模式禁用 */
  system: boolean
  /** 依赖的服务名；缺失时状态为 waiting */
  inject: string[]
  /** 权限声明，插件页原样展示给用户 */
  permissions: string[]
  /** 需要独立 worker 的插件可声明自己的入口（如大 PSD 解码） */
  workerEntry?: string
  /**
   * 插件申请的内核能力。当前支持 'window'（独立浮窗）。
   * 未声明的插件拿不到对应 ctx 能力，内核会在调用时拒绝。
   */
  capabilities?: string[]
}

/** 渲染端插件卡片拿到的全部信息 */
export interface PluginInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  system: boolean
  /** 内置还是用户安装；内置插件不允许卸载 */
  source: 'builtin' | 'user'
  status: PluginStatus
  error?: string
  inject: string[]
  permissions: string[]
  configSchema: ConfigSchema
  /** 插件目录，详情页展示 */
  dir: string
}

/**
 * 插件新增的侧栏页。
 * 插件跑在主进程，React 组件无法跨 IPC 传递，所以 v1 用一段 HTML
 * 交给渲染端 iframe srcDoc 渲染。
 */
export interface PluginPageContribution {
  id: string
  pluginId: string
  title: string
  html?: string
}

/** 跨进程下发的可执行动作（run / when 是函数，不能序列化，留在主进程按 id 查） */
export interface ActionView {
  id: string
  label: string
  pluginId: string
  /** 该动作适用的扩展名白名单；插件不声明则不限制 */
  exts?: string[]
}

/** 插件上报的运行状态，显示在侧栏 / 启动页 */
export interface PluginStatusView {
  pluginId: string
  text: string
  level: 'ok' | 'warn' | 'error'
}

/** plugin:list / plugin:changed 的统一载荷 */
export interface PluginSnapshotPayload {
  plugins: PluginInfo[]
  pages: PluginPageContribution[]
  actions: { fileActions: ActionView[]; toolbarActions: ActionView[] }
  statuses: PluginStatusView[]
}

export interface PluginResult {
  ok: boolean
  error?: string
  canceled?: boolean
}

/** 插件配置表单里一个 list 字段的行数据（值均为字段 id → 用户输入） */
export type ConfigRow = Record<string, unknown>
