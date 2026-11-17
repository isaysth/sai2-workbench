import { createHash } from 'node:crypto'

/**
 * 缩略图缓存键。
 *
 * M2b 起身份优先用 `dev:ino` 而不是路径（计划 §3.5）：
 *   - 之前 `sha1(version|size|mtime|path)`：改个名就是新键，得重新解码。
 *     5 千张批量改名 = 5000 次解码，约 4 分钟。
 *   - 之后 `sha1(version|size|mtime|dev:ino)`：改名、同盘移动键不变，直接命中磁盘缓存。
 *
 * 取不到身份（网络盘 / FAT32 的 ino=0）时退回路径，行为与旧版一致。
 *
 * 输入里必须同时有 size 和 mtime：只看身份的话，用户在 SAI2 里覆盖保存同一张稿，
 * 缓存键不变、还是显示旧图 —— 这种"存了盘但预览没更新"的 bug 极难自查。
 *
 * thumbVersion 参与哈希是给"我改了解码代码"留的开关：+1 即全量失效。
 */
export function thumbKey(
  path: string,
  size: number,
  mtimeMs: number,
  version: number,
  ident?: string
): string {
  // mtime 取整：不同文件系统对同一文件的毫秒部分可能有微小差异（尤其网络盘），
  // 取整后"同一份文件"在同一秒内算出的键是稳定的
  const stamp = Math.round(mtimeMs)
  return createHash('sha1').update(`${version}|${size}|${stamp}|${ident ?? path}`, 'utf8').digest('hex')
}

/** 协议层与缓存层共用的形状校验：<40 位 hex>.<ext> */
export const THUMB_NAME_RE = /^[0-9a-f]{40}\.[a-z0-9]{2,5}$/
/** 失败标记：<40 位 hex>.fail，内容是一行原因 */
export const THUMB_FAIL_RE = /^[0-9a-f]{40}\.fail$/
