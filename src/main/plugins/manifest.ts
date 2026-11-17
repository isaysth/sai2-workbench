/**
 * 插件清单（plugin.json）的读取与校验。
 * 校验失败一律返回中文原因，不抛异常、不阻塞启动。
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  PLUGIN_API_VERSION,
  type ConfigField,
  type ConfigFieldType,
  type ConfigSchema,
  type PluginManifest
} from '@shared/plugins'

/** 小写字母开头，只用小写字母数字和短横线 */
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const FIELD_TYPES: ConfigFieldType[] = ['string', 'bool', 'int', 'float', 'enum', 'path', 'list']

export interface ValidatedManifest {
  manifest: PluginManifest
  /** 绝对路径 */
  entryPath: string
  workerEntryPath?: string
}

export type ManifestResult =
  | { ok: true; value: ValidatedManifest }
  | { ok: false; error: string }

function fail(error: string): ManifestResult {
  return { ok: false, error }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringArray(v: unknown, field: string): string[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return `${field} 必须是字符串数组`
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return `${field} 必须是字符串数组`
    if (item.trim()) out.push(item.trim())
  }
  return out
}

type PathResult = { ok: true; path: string } | { ok: false; error: string }

/** 相对路径 + 禁止 .. 穿越；返回绝对路径 */
function safeEntry(dir: string, value: unknown, label: string): PathResult {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `缺少${label}` }
  const rel = value.trim()
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) {
    return { ok: false, error: `${label} 必须是插件目录内的相对路径` }
  }
  return { ok: true, path: join(dir, rel) }
}

/** 递归校验 configSchema；非法字段直接让插件 failed，避免渲染端表单崩掉 */
function validateSchema(value: unknown): ConfigSchema | string {
  if (value === undefined) return {}
  if (!isPlainObject(value)) return 'configSchema 必须是对象'
  const out: ConfigSchema = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isPlainObject(raw)) return `configSchema.${key} 必须是对象`
    const type = raw.type
    if (typeof type !== 'string' || !FIELD_TYPES.includes(type as ConfigFieldType)) {
      return `configSchema.${key}.type 不支持：${String(type)}`
    }
    const field: ConfigField = { type: type as ConfigFieldType, label: String(raw.label ?? key) }
    if (raw.default !== undefined) field.default = raw.default
    if (typeof raw.min === 'number') field.min = raw.min
    if (typeof raw.max === 'number') field.max = raw.max
    if (typeof raw.step === 'number') field.step = raw.step
    if (typeof raw.hint === 'string') field.hint = raw.hint
    if (raw.filter === 'exe' || raw.filter === 'dir' || raw.filter === 'file') field.filter = raw.filter
    if (Array.isArray(raw.options)) {
      field.options = raw.options.filter(
        (o): o is string | { value: string; label: string } =>
          typeof o === 'string' || isPlainObject(o)
      ) as string[] | Array<{ value: string; label: string }>
    }
    if (field.type === 'list') {
      const item = validateSchema(raw.item ?? {})
      if (typeof item === 'string') return `configSchema.${key}.item ${item}`
      field.item = item
    }
    out[key] = field
  }
  return out
}

/** 把任意 JSON 值校验成 PluginManifest */
export function parseManifest(raw: unknown, dir: string): ManifestResult {
  if (!isPlainObject(raw)) return fail('plugin.json 不是有效对象')

  const id = raw.id
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return fail('id 缺失或格式错误（只能用小写字母、数字和短横线）')
  }
  const entryResult = safeEntry(dir, raw.entry, '入口文件 entry')
  if (!entryResult.ok) return fail(entryResult.error)
  const entryPath = entryResult.path
  if (!existsSync(entryPath)) return fail(`入口文件不存在：${String(raw.entry)}`)

  const apiVersion = Number(raw.apiVersion)
  if (apiVersion !== PLUGIN_API_VERSION) {
    return fail(`apiVersion 不兼容：需要 ${PLUGIN_API_VERSION}，实际 ${String(raw.apiVersion)}`)
  }

  let workerEntryPath: string | undefined
  if (raw.workerEntry !== undefined) {
    const workerResult = safeEntry(dir, raw.workerEntry, 'workerEntry')
    if (!workerResult.ok) return fail(workerResult.error)
    workerEntryPath = workerResult.path
    if (!existsSync(workerEntryPath)) return fail(`worker 文件不存在：${String(raw.workerEntry)}`)
  }

  const inject = stringArray(raw.inject, 'inject')
  if (typeof inject === 'string') return fail(inject)
  const permissions = stringArray(raw.permissions, 'permissions')
  if (typeof permissions === 'string') return fail(permissions)
  const capabilities = stringArray(raw.capabilities, 'capabilities')
  if (typeof capabilities === 'string') return fail(capabilities)
  const knownCapabilities = ['window']
  for (const cap of capabilities) {
    if (!knownCapabilities.includes(cap)) return fail(`不支持的能力：${cap}`)
  }

  const version = typeof raw.version === 'string' ? raw.version : '1.0.0'
  if (!VERSION_RE.test(version)) return fail(`version 格式错误：${version}`)

  return {
    ok: true,
    value: {
      manifest: {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
        version,
        apiVersion,
        author: typeof raw.author === 'string' ? raw.author : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        entry: String(raw.entry),
        system: raw.system === true,
        inject,
        permissions,
        workerEntry: typeof raw.workerEntry === 'string' ? raw.workerEntry : undefined,
        capabilities
      },
      entryPath,
      workerEntryPath
    }
  }
}

/** 读取插件目录下的 plugin.json */
export function readManifest(dir: string): ManifestResult {
  const file = join(dir, 'plugin.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch (err) {
    return fail(`plugin.json 读取失败：${err instanceof Error ? err.message : String(err)}`)
  }
  return parseManifest(raw, dir)
}

/**
 * 校验插件导出的 configSchema（在加载模块之后调用）。
 * 返回 null 表示合法，否则返回中文原因。
 */
export function validateExportedSchema(value: unknown): string | null {
  const result = validateSchema(value)
  return typeof result === 'string' ? result : null
}

/** 供 host 使用：把校验通过的 schema 原样带回 */
export function normalizeSchema(value: unknown): ConfigSchema {
  const result = validateSchema(value)
  return typeof result === 'string' ? {} : result
}
