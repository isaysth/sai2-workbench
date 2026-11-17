import type { ReactElement, ReactNode } from 'react'

/**
 * 内联 SVG 图标集。统一 24 网格、1.7 描边、currentColor，
 * 不引第三方图标库（减少依赖，颜色跟随主题）。
 */
interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 17, className, children }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconLaunch(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M5 15.5 3.5 20.5 8.5 19" />
      <path d="M14.5 4.5c2.6-2 5.5-1.6 5.5-1.6s.4 2.9-1.6 5.5l-6 7.6-4.9-4.9z" />
      <circle cx="15" cy="9" r="1.4" />
      <path d="M8.5 16.5 4 12" />
    </Svg>
  )
}

export function IconGrid(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Svg>
  )
}

export function IconTerminal(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M6.5 9.5 9 12l-2.5 2.5" />
      <path d="M12 15h5" />
    </Svg>
  )
}

export function IconPlug(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M6.5 8h11v3a5.5 5.5 0 0 1-5.5 5.5A5.5 5.5 0 0 1 6.5 11z" />
      <path d="M12 16.5V21" />
    </Svg>
  )
}

export function IconSettings(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.55 1.03z" />
    </Svg>
  )
}

export function IconMinus(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function IconMaximize(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 12}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.2" />
    </Svg>
  )
}

export function IconClose(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function IconSearch(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 15}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </Svg>
  )
}

export function IconRefresh(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M20 11.5a8 8 0 1 1-2.4-5.7" />
      <path d="M20.5 4.5v5h-5" />
    </Svg>
  )
}

export function IconFolder(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 22}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l1.8 2.2h7.6a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </Svg>
  )
}

export function IconExternal(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
    </Svg>
  )
}

export function IconPause(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M9 5v14M15 5v14" />
    </Svg>
  )
}

export function IconTrash(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 14}>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
    </Svg>
  )
}

export function IconImage(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 22}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l4.5-4.2a1.6 1.6 0 0 1 2.2 0L20 20" />
    </Svg>
  )
}

export function IconInfo(p: IconProps): ReactElement {
  return (
    <Svg {...p} size={p.size ?? 15}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  )
}
