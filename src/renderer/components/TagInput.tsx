import { useRef, useState, type ReactElement } from 'react'
import type { Tag } from '@shared/types'
import { IconClose } from './Icons'

/**
 * 标签输入（M2b T3.5）。
 *
 * 交互刻意做得朴素：回车加、`×` 删、退格删最后一个、下拉从已有标签里补全。
 * 不自动弹浮层 —— 浮层要处理焦点、层级、点击外部关闭，做不好反而比原生
 * `<datalist>` 难用（计划 §6 风险 7）。真需要筛选时，`<datalist>` 已经够。
 */
export function TagInput({
  value,
  options,
  onChange,
  disabled,
  placeholder = '回车添加标签…'
}: {
  value: string[]
  options: Tag[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
}): ReactElement {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listId = 'tag-suggest'

  const add = (raw: string): void => {
    const name = raw.trim().slice(0, 40)
    if (!name) return
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...value, name])
    setDraft('')
  }

  const remove = (name: string): void => onChange(value.filter((v) => v !== name))

  return (
    <div
      className={`tag-input${disabled ? ' is-disabled' : ''}`}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((name) => (
        <span className="tag-chip" key={name}>
          {name}
          <button
            className="tag-chip-x"
            title="移除这个标签"
            onClick={(e) => {
              e.stopPropagation()
              remove(name)
            }}
          >
            <IconClose size={9} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-input-field"
        value={draft}
        list={listId}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1]!)
          }
        }}
        onBlur={() => {
          // 输了一半就点走：当作确认，不然用户会以为输了没生效
          if (draft.trim()) add(draft)
        }}
      />
      <datalist id={listId}>
        {options
          .filter((t) => !value.some((v) => v.toLowerCase() === t.name.toLowerCase()))
          .map((t) => (
            <option key={t.id} value={t.name} />
          ))}
      </datalist>
    </div>
  )
}
