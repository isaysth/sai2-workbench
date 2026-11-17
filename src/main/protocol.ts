import { net, protocol } from 'electron'
import { normalize, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProjectFile } from '@shared/types'
import type { Logger } from './logger'
import { THUMB_NAME_RE } from './thumbs/key'
import type { ThumbService } from './thumbs'

/**
 * 自定义图片协议 `sai2img://`。
 *
 * 为什么不用 `file://`：
 *  1. 开发态渲染进程跑在 http://localhost 上，file:// 图片会被跨源策略拦掉；
 *     生产态又是 file:// 页面，两套规则要写两遍分支。
 *  2. 路径含中文 / 空格 / 井号时，file:// 的编码很容易踩坑。
 *  3. 直接把 data 目录暴露给渲染进程不安全，自定义协议可以只放行指定目录。
 *
 * 两个 host 分流（同一个 scheme，不新增 scheme —— 多注册一个就要多维护一套权限）：
 *   `sai2img://bg/<文件>`      → data/backgrounds
 *   `sai2img://thumb/<键>.<扩展>` → data/cache/thumbs
 *
 * ★ v1.19 教训：这里只能用于「显示」。任何 `toBlob` / `toDataURL` 场景
 *   （如导出、取景）都会因为跨源污染 canvas 而抛 SecurityError，必须改走 IPC 字节流。
 */
export const IMG_SCHEME = 'sai2img'

/**
 * 必须在 app ready **之前**调用，否则注册无效。
 * standard: 让 URL 按 `scheme://host/path` 解析；secure: 视作安全上下文。
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMG_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true }
    }
  ])
}

/** 拒绝越界：必须以「root + 分隔符」开头，避免 root 被前缀匹配绕过（如 C:\data-evil） */
function resolveInside(root: string, name: string): string | null {
  const full = normalize(join(root, name))
  if (!full.startsWith(root + sep) && full !== root) return null
  return full
}

export interface ImageProtocolDeps {
  backgroundDir: string
  thumbCacheDir: string
  log: Logger
  thumbs: ThumbService
  /** 按缓存键反查文件（键是 sha1(路径+大小+mtime+版本)，不反查就没法知道该解哪个文件） */
  findByThumbKey: (key: string) => ProjectFile | undefined
}

export function serveImageProtocol(deps: ImageProtocolDeps): void {
  const backgroundRoot = normalize(deps.backgroundDir)
  const thumbRoot = normalize(deps.thumbCacheDir)

  protocol.handle(IMG_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const host = url.hostname || 'bg'

      if (host === 'bg') {
        if (!name) return new Response('missing name', { status: 400 })
        const full = resolveInside(backgroundRoot, name)
        if (!full) {
          deps.log.warn('protocol', `拒绝越界读取：${request.url}`)
          return new Response('forbidden', { status: 403 })
        }
        return await net.fetch(pathToFileURL(full).toString())
      }

      if (host === 'thumb') {
        // 只放行 <40 位 hex>.<jpg|png>，连目录分隔符都不可能出现
        if (!THUMB_NAME_RE.test(name)) {
          deps.log.warn('protocol', `缩略图请求非法：${request.url}`)
          return new Response('forbidden', { status: 403 })
        }
        const key = name.slice(0, 40)
        const file = deps.findByThumbKey(key)
        if (!file) return new Response('gone', { status: 404 })

        const result = await deps.thumbs.get(file)
        if (result.kind === 'fail') return new Response(result.reason, { status: 404 })
        const target = result.kind === 'original' ? result.path : join(thumbRoot, result.name)
        return await net.fetch(pathToFileURL(target).toString())
      }

      return new Response('unknown host', { status: 404 })
    } catch (err) {
      deps.log.warn('protocol', `图片读取失败：${request.url} ${String(err)}`)
      return new Response('not found', { status: 404 })
    }
  })
}
