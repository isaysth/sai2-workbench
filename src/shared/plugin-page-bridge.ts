/**
 * 插件页面的 postMessage 协议。
 *
 * 插件贡献的页面跑在 `sandbox="allow-scripts"` 的 iframe 里（opaque origin，拿不到
 * `window.api`），与内核之间只有一条 postMessage 通道：
 *
 *   页面 → 内核：{ __sai2Page: 'action', id }        触发本插件注册的工具栏动作
 *   内核 → 页面：{ __sai2Page: 'result', id, ok, error? }
 *
 * 这里只放纯逻辑（不碰 DOM），方便在 node 环境直接单测。
 */
export const PAGE_BRIDGE_KEY = '__sai2Page'

/** 动作 id 上限，防止页面塞超长字符串进 IPC */
const MAX_ACTION_ID_LENGTH = 200

/** 动作 id 字符集：与插件里 addToolbarAction 的命名习惯一致，顺带挡掉注入类怪字符 */
const ACTION_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/

export interface PageActionMessage {
  __sai2Page: 'action'
  id: string
}

export interface PageResultMessage {
  __sai2Page: 'result'
  id: string
  ok: boolean
  error?: string
}

function isActionId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_ACTION_ID_LENGTH && ACTION_ID_PATTERN.test(value)
  )
}

/** 校验并解析页面发来的消息；不是本协议的一律返回 null（不抛错） */
export function parsePageMessage(raw: unknown): PageActionMessage | null {
  if (typeof raw !== 'object' || raw === null) return null

  const record = raw as Record<string, unknown>
  if (record[PAGE_BRIDGE_KEY] !== 'action') return null

  const id = record.id
  if (!isActionId(id)) return null

  return { __sai2Page: 'action', id }
}

/** 构造回发给页面的结果消息 */
export function buildResultMessage(id: string, ok: boolean, error?: string): PageResultMessage {
  const message: PageResultMessage = { __sai2Page: 'result', id, ok }
  if (error) message.error = error
  return message
}
