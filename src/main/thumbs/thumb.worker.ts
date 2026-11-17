import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { decodePsdBuffer } from './psd'

/**
 * PSD 解码 worker。>20MB 的工程在主进程解会卡住几百毫秒（拖窗口都掉帧），
 * 丢到线程里解，主进程只 await 结果。
 *
 * 只做一件事：读文件 → 出 PNG 字节 → 回传。缓存写入、状态回填都由主进程做，
 * worker 不碰磁盘之外的任何状态（崩了也只是这一张降级）。
 */

interface WorkerInput {
  path: string
}

interface WorkerOk {
  ok: true
  png: Uint8Array
  width: number
  height: number
  opaque: boolean
}

interface WorkerFail {
  ok: false
  error: string
}

const input = workerData as WorkerInput

async function run(): Promise<void> {
  try {
    const buf = await readFile(input.path)
    const thumb = decodePsdBuffer(buf)
    // 拷一份独立缓冲再转移：Buffer.concat 在小于 4KB 时会用共享池，
    // 直接转移 pool 的 ArrayBuffer 会把别的内容一起塞过去（且报 invalid transfer）
    const png = new Uint8Array(thumb.png.length)
    png.set(thumb.png)
    const msg: WorkerOk = {
      ok: true,
      png,
      width: thumb.width,
      height: thumb.height,
      opaque: thumb.opaque
    }
    parentPort?.postMessage(msg, [png.buffer])
  } catch (err) {
    const msg: WorkerFail = { ok: false, error: err instanceof Error ? err.message : String(err) }
    parentPort?.postMessage(msg)
  }
}

void run()
