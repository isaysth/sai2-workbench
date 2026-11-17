/** 缩略图长边上限。卡片最大 260px，2× DPR 下 520 才刚好看，512 足够且省磁盘。 */
export const THUMB_MAX_EDGE = 512

/** 单张缩略图解码超时。超过就判失败 —— 拖着一张卡死整列更糟。 */
export const THUMB_TIMEOUT_MS = 8000

/** 同时解码的数量上限。4 个能把 SSD/CPU 吃满，再多只是互相抢 IO。 */
export const THUMB_CONCURRENCY = 4

/** 超过这个体积的 PSD 丢 worker，避免主进程卡住几百毫秒（界面掉帧） */
export const PSD_WORKER_THRESHOLD = 20 * 1024 * 1024

/** 缩略图输出 JPEG 的质量。82 在 512 长边下几乎看不出与原图差别，体积约为 PNG 的 1/6 */
export const THUMB_JPEG_QUALITY = 82
