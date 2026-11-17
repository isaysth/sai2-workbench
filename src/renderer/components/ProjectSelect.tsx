import { useState, type ReactElement } from 'react'
import type { Project } from '@shared/types'

/**
 * 项目下拉 + 就地新建（M2b T3.5）。
 *
 * 不弹对话框：详情面板只有 264px 宽，一个居中模态框在这么窄的容器里反而更挤。
 * 选「＋ 新建项目…」就把下拉换成两个输入框，确定后自动选中新项目。
 */
export function ProjectSelect({
  value,
  projects,
  onChange,
  onCreate
}: {
  value: number | null
  projects: Project[]
  onChange: (id: number | null) => void
  onCreate: (name: string, client: string) => Promise<Project | null>
}): ReactElement {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true)
    try {
      const project = await onCreate(clean, client.trim())
      if (project) {
        onChange(project.id)
        setCreating(false)
        setName('')
        setClient('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="proj-form">
        <input
          className="input"
          autoFocus
          placeholder="项目名，如「春季海报」"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setCreating(false)
          }}
        />
        <input
          className="input"
          placeholder="客户（可留空）"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setCreating(false)
          }}
        />
        <div className="proj-form-actions">
          <button className="btn is-sm is-primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建'}
          </button>
          <button className="btn is-sm is-ghost" onClick={() => setCreating(false)}>
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <select
      className="select is-block"
      value={value ?? 0}
      onChange={(e) => {
        const raw = Number(e.target.value)
        if (raw === -1) {
          setCreating(true)
          return
        }
        onChange(raw === 0 ? null : raw)
      }}
    >
      <option value={0}>未归类</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.client ? `${p.name}（${p.client}）` : p.name}
        </option>
      ))}
      <option value={-1}>＋ 新建项目…</option>
    </select>
  )
}
