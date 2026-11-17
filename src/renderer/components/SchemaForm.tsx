import type { ReactElement } from 'react'
import type { ConfigField, ConfigSchema, ConfigRow } from '@shared/plugins'

/**
 * 声明式配置表单：插件只写 configSchema，这里负责渲染与收集值。
 * list 字段支持增删行，行内字段递归用同一套渲染逻辑。
 */
interface SchemaFormProps {
  schema: ConfigSchema
  value: Record<string, unknown>
  disabled?: boolean
  onPatch: (next: Record<string, unknown>) => void
}

function defaultFor(field: ConfigField): unknown {
  if (field.default !== undefined) return field.default
  if (field.type === 'list') return []
  if (field.type === 'bool') return false
  if (field.type === 'int' || field.type === 'float') return field.min ?? 0
  return ''
}

function optionsOf(field: ConfigField): Array<{ value: string; label: string }> {
  return (field.options ?? []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  )
}

export function SchemaForm({ schema, value, disabled = false, onPatch }: SchemaFormProps): ReactElement {
  const keys = Object.keys(schema)
  if (keys.length === 0) {
    return <div className="plugin-form-empty">这个插件没有可配置项</div>
  }

  const patch = (key: string, next: unknown): void => onPatch({ ...value, [key]: next })

  return (
    <div className="plugin-form">
      {keys.map((key) => {
        const field = schema[key]!
        const raw = value[key] === undefined ? defaultFor(field) : value[key]

        if (field.type === 'list') {
          const rows = Array.isArray(raw) ? (raw as ConfigRow[]) : []
          const itemSchema = field.item ?? {}
          const updateRow = (index: number, row: ConfigRow): void => {
            const next = rows.slice()
            next[index] = row
            patch(key, next)
          }
          return (
            <div className="plugin-field plugin-field--list" key={key}>
              <div className="plugin-field-head">
                <span>{field.label}</span>
                <button
                  type="button"
                  className="btn is-sm"
                  disabled={disabled}
                  onClick={() => {
                    const row: ConfigRow = {}
                    for (const [ik, ifield] of Object.entries(itemSchema)) row[ik] = defaultFor(ifield)
                    patch(key, [...rows, row])
                  }}
                >
                  + 添加一行
                </button>
              </div>
              {rows.length === 0 ? <div className="plugin-form-empty">还没有内容</div> : null}
              {rows.map((row, index) => (
                <div className="plugin-list-row" key={`${key}-${index}`}>
                  <SchemaForm schema={itemSchema} value={row} disabled={disabled} onPatch={(next) => updateRow(index, next)} />
                  <button
                    type="button"
                    className="btn is-sm is-ghost"
                    disabled={disabled}
                    onClick={() => patch(key, rows.filter((_r, i) => i !== index))}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )
        }

        if (field.type === 'bool') {
          return (
            <label className="plugin-field plugin-field--bool" key={key}>
              <input
                type="checkbox"
                checked={Boolean(raw)}
                disabled={disabled}
                onChange={(e) => patch(key, e.target.checked)}
              />
              <span>{field.label}</span>
            </label>
          )
        }

        if (field.type === 'enum') {
          return (
            <label className="plugin-field" key={key}>
              <span className="plugin-field-label">{field.label}</span>
              <select
                value={String(raw)}
                disabled={disabled}
                onChange={(e) => patch(key, e.target.value)}
              >
                {optionsOf(field).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )
        }

        if (field.type === 'int' || field.type === 'float') {
          return (
            <label className="plugin-field" key={key}>
              <span className="plugin-field-label">{field.label}</span>
              <input
                type="number"
                value={String(raw)}
                min={field.min}
                max={field.max}
                step={field.type === 'int' ? 1 : (field.step ?? 0.1)}
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) patch(key, field.type === 'int' ? Math.round(n) : n)
                }}
              />
            </label>
          )
        }

        return (
          <label className="plugin-field" key={key}>
            <span className="plugin-field-label">{field.label}</span>
            <input
              type="text"
              value={String(raw)}
              placeholder={field.filter ? `填写${field.filter === 'exe' ? '程序' : '目录'}的绝对路径` : undefined}
              disabled={disabled}
              onChange={(e) => patch(key, e.target.value)}
            />
            {field.hint ? <span className="plugin-field-hint">{field.hint}</span> : null}
          </label>
        )
      })}
    </div>
  )
}
