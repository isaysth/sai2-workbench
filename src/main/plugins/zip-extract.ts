/**
 * zip 解包：插件安装与数据恢复共用。
 *
 * 只允许相对路径 —— 拒绝绝对路径、盘符、`..` 穿越（zip-slip）。
 * 调用方若要额外限制允许的条目，传 `allow` 谓词；命不中直接报错，不做"跳过一半"的半成品安装。
 */
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yauzl from 'yauzl'

/** 条目名是否为安全的相对路径 */
export function safeZipName(name: string): boolean {
  if (!name) return false
  if (name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(name)) return false
  return !name.split(/[\\/]/).includes('..')
}

export interface ExtractOptions {
  /** 额外白名单：返回 false 的条目会让整次解压失败 */
  allow?: (entryName: string) => boolean
}

export function extractZip(zipPath: string, targetDir: string, options: ExtractOptions = {}): Promise<void> {
  const allow = options.allow
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('无法打开 zip 文件'))
        return
      }
      let done = false
      const finish = (failure?: Error): void => {
        if (done) return
        done = true
        zipFile.close()
        if (failure) reject(failure)
        else resolve()
      }
      zipFile.on('error', (e) => finish(e))
      zipFile.on('end', () => finish())
      zipFile.readEntry()
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (!safeZipName(entry.fileName) || (allow && !allow(entry.fileName))) {
          finish(new Error(`zip 内存在不允许的路径：${entry.fileName}`))
          return
        }
        const full = join(targetDir, entry.fileName)
        if (entry.fileName.endsWith('/')) {
          try {
            mkdirSync(full, { recursive: true })
            zipFile.readEntry()
          } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)))
          }
          return
        }
        zipFile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(streamErr ?? new Error(`读取 zip 条目失败：${entry.fileName}`))
            return
          }
          try {
            mkdirSync(dirname(full), { recursive: true })
          } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)))
            return
          }
          const out = createWriteStream(full)
          stream.on('error', (e) => finish(e))
          out.on('error', (e) => finish(e))
          out.on('finish', () => zipFile.readEntry())
          stream.pipe(out)
        })
      })
    })
  })
}

/** 读出 zip 里单个文本条目的内容（数据备份读 manifest.json 用） */
export function readZipText(zipPath: string, entryName: string, maxBytes = 256 * 1024): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('无法打开 zip 文件'))
        return
      }
      let done = false
      const finish = (value: string | null, failure?: Error): void => {
        if (done) return
        done = true
        zipFile.close()
        if (failure) reject(failure)
        else resolve(value)
      }
      zipFile.on('error', (e) => finish(null, e))
      zipFile.on('end', () => finish(null))
      zipFile.readEntry()
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) {
          zipFile.readEntry()
          return
        }
        if (entry.uncompressedSize > maxBytes) {
          finish(null, new Error(`${entryName} 过大`))
          return
        }
        zipFile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(null, streamErr ?? new Error('读取条目失败'))
            return
          }
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('error', (e) => finish(null, e))
          stream.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
        })
      })
    })
  })
}
