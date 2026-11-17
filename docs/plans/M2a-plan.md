# M2a 看图 · 开发计划

> 对应需求：**F2 监听文件夹 / F3 缩略图 / F18 封面兜底**，需求 §9 的「M2a 看图」一行
> 前置条件：M1 / M1.6 已交付（三栏窗口、外观三维模型、设置页、日志页、IPC 桥、`sai2img://` 协议）
> 状态：**待确认**（按开发文档 §1.2，未确认前不动代码）
> 预估：**9 个工作日**（不含 UI 打磨；UI 已定版）

---

## 1. 目标（做完之后你能做什么）

1. 在 **设置 → 监听目录** 里加一个或多个文件夹（可选是否含子目录），文件管理页立刻开始出卡片。
2. 往文件夹里丢一个 `sai2 / psd / png / jpg / webp`，**2 秒内**卡片自己冒出来；删掉文件，卡片自己消失；在别的程序里存盘覆盖同名文件，缩略图跟着更新。
3. 卡片显示**真缩略图**：SAI2 直接解文件自带的预览图（`thum` 块），PSD 解合成图，图片走原生解码。不装 SaiThumbs、不装任何外部工具。
4. 卡片按**瀑布流**排列，窗口拉宽列数自动变多，滚动到 1000 条不卡。
5. 出不了图的文件（损坏、加密、小画布 SAI2）显示**信息卡**（后缀名 + 画布尺寸 + 修改时间），不白屏、不报错、不刷屏日志。
6. 缩略图落盘缓存，重启程序不重新解码；设置页能一键清空缓存。

---

## 2. 交付物

### 新增（主进程）

| 文件 | 作用 |
|---|---|
| `src/main/files/index.ts` | 索引入口：扫描 + 监听 + 变更事件聚合 |
| `src/main/files/scanner.ts` | 单目录遍历、扩展名过滤、子目录、条目构造 |
| `src/main/files/watcher.ts` | chokidar 多目录监听、去抖、事件归一（add/change/unlink） |
| `src/main/thumbs/index.ts` | 缩略图调度：提供者链、并发池、超时、落盘缓存、失败缓存 |
| `src/main/thumbs/sai2.ts` | SAI2 容器解析（魔数、画布尺寸、块表） |
| `src/main/thumbs/jssf.ts` | `jssf` → 标准 JPEG 重建（移植 `tools/jssf_probe.py`） |
| `src/main/thumbs/psd.ts` | `ag-psd` 取合成图 |
| `src/main/thumbs/png.ts` | 自写 PNG 编码（IHDR / IDAT / IEND + CRC32） |
| `src/main/thumbs/thumb.worker.ts` | PSD 解码专用 worker（`worker_threads`），避免主进程卡顿 |
| `src/main/thumbs/protocol.ts` | 缩略图协议处理（复用 `sai2img` scheme，host = `thumb`） |
| `src/main/ipc/files.ipc.ts` | 列表查询、增删监听目录、手动重扫、变更推送 |

### 新增（渲染层）

| 文件 | 作用 |
|---|---|
| `src/renderer/components/MasonryGrid.tsx` | 虚拟滚动瀑布流容器 |
| `src/renderer/components/FileCard.tsx` | 单张卡片（缩略图 / 占位 / 选中 / 悬停） |
| `src/renderer/store/files.ts` | 文件列表 store（Zustand），增量应用主进程事件 |
| `src/renderer/hooks/useMasonry.ts` | 列数计算、行高累积、可视区裁剪 |

### 修改

| 文件 | 改什么 |
|---|---|
| `src/main/index.ts` | 启动后读 `config.watch.dirs` 开始索引；退出时停监听 |
| `src/main/protocol.ts` | 注册 `thumb` host（同一 scheme 下分流，不新增 scheme） |
| `src/main/paths.ts` | 新增 `thumbCacheDir` |
| `src/shared/types.ts` | `ProjectFile` 补 `thumbState`；新增 `FileChangeEvent` / `IndexProgress` |
| `src/shared/channels.ts` | 新增 `files:*` 通道 |
| `src/preload/index.ts` + `index.d.ts` | 暴露 `files.list/addDir/removeDir/rescan/onChanged`、`thumbs.clear` |
| `src/renderer/pages/FilesPage.tsx` | 从骨架换成真列表 + 顶部统计 + 空态引导 |
| `src/renderer/pages/SettingsPage.tsx` | 新增「监听目录」卡片（增删、含子目录开关、扩展名勾选、立即重扫） |
| `src/main/config.ts` | `watch.dirs` 增加存在性与去重校验；新增 `cache.maxThumbBytes` |

### 产出物

- 可运行的程序：`npm run dev` 或打好的免安装包，丢文件即可验。
- 自测报告：`docs/plans/M2a-delivery.md`（含实测数据与截图）。
- `tests/fixtures/` 下放 3 个真实 SAI2 + 1 个 PSD + 1 个损坏文件 + 1 个 5000×4000 大图，供回归。

---

## 3. 任务分解

每项都写清「改哪个文件 / 怎么验」，粒度按半天到一天。**顺序即依赖顺序**，可逐项交付。

### T2.1 索引与监听地基（1.5 天）

- `shared/types.ts`：定 `ProjectFile`（path / name / ext / dir / size / mtimeMs / canvas? / thumbState）、`FileChangeEvent`（`upsert` / `remove` / `reset`）、`IndexProgress`（已扫数 / 总数）。
- `main/files/scanner.ts`：
  - `scanDir(dir, { recursive, extensions }): AsyncGenerator<ProjectFile>` —— 用 `fs.promises.readdir({ withFileTypes: true })` 逐层推进，**每 200 条 yield 一次**，避免大目录一次性占满内存。
  - 跳过隐藏目录（`.git`、`.thumbnails`、`$RECYCLE.BIN`）、跳过符号链接环（记录已访问 inode）。
  - `stat` 失败（被占用 / 已删除）→ 跳过该条，记 debug 日志，不中断整轮扫描。
- `main/files/watcher.ts`：
  - `chokidar.watch(dirs, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }, depth, ignored })`
  - `add` / `change` / `unlink` 各自由 `debounceMs`（默认 200）合并，同路径只留最后一次。
  - 扩展名不在白名单的直接丢；`unlinkDir` 展开成该目录下所有条目的 `remove`。
- `main/files/index.ts`：
  - `startIndex(dirs)`：先全量扫（分批推送 `reset` → 逐批 `upsert`），扫描期间来的 watcher 事件进队列，扫完一次性回放，**保证不出现"扫描把它覆盖掉"的丢事件**。
  - 内存索引 `Map<absPath, ProjectFile>`，导出 `list()` / `get(path)`。
  - `stopIndex()`：关闭所有 watcher，清定时器。
- `ipc/files.ipc.ts`：`list` / `addDir` / `removeDir` / `rescan`；变更通过 `broadcast` 推给渲染端（复用现有 `main/ipc/broadcast.ts`）。

**验收**
- 监听一个放了 3000 个文件的目录：首次扫描 ≤ 8 秒，界面期间可操作。
- 丢入一个 psd：从落盘到渲染端收到事件 ≤ 2 秒（日志打时间戳核对，不靠感觉）。
- 删除文件：卡片 2 秒内消失。
- 扫描中新增文件：不丢事件（扫完仍在列表里）。
- 断网盘/移动硬盘拔掉：日志 1 条 warn，不崩、不刷屏。

### T2.2 缩略图调度与缓存（1 天）

- `thumbs/index.ts`：
  - `getThumb(file): Promise<{ key, url, state }>`，提供者链按需求 §附：`image → psd → sai2 → 封面兜底`。
  - **缓存键** `sha1(路径 + size + mtimeMs + thumbVersion)`，落 `data/cache/thumbs/<key>.<ext>`。
  - 命中直接返回；未命中进并发池（上限 4）；单文件超时 8 秒判失败。
  - 失败也落盘：`<key>.fail`（内容是原因），带 mtime，文件更新即失效 —— 避免滚到坏文件反复重试。
  - 提供者抛异常 → 记一次 debug 日志 → 下一个提供者，**绝不上抛到 UI**。
- `paths.ts` 加 `thumbCacheDir`；`config.cache` 加 `maxThumbBytes`（默认 2GB）。
- 超限清理：写缓存后检查目录总大小，超限按 mtime 删最旧的 10%（简单 LRU，不做 index.json）。

**验收**
- 首屏 200 张：主进程 CPU 无持续满载，渲染端滚动不掉帧。
- 同一文件二次请求直接命中缓存（日志出现 `cache hit`）。
- 故意放一个 0 字节的 sai2：生成 `.fail`，二次请求不再解码。
- 清空缓存后首屏重新生成，`thumbVersion` 递增使旧键失效。

### T2.3 SAI2 容器解析（0.5 天）

- `thumbs/sai2.ts`，严格按开发文档 §7.2：
  - 读前 64 字节：魔数 `SAI-CANVAS-TYPE0`、标志位（16+1 字节 `&7`）、画布宽高（20 / 24，u32 LE）、块表条数（32）。
  - 块表从 64 起，每条 16 字节：`tag(4) + layerId(u32) + 绝对偏移(u32) + 保留(u32)`；**长度 = 下一块偏移 - 本块偏移**，最后一块到文件末尾。
  - 只读需要的块（`thum` / `intg`），**不整文件读入**（真实稿件 75MB，整读会拖慢首屏）。
  - 返回 `{ canvas, thumbKind: 'jssf' | 'dpcm' | null, bytes }`。
- `dpcm` 分支：**留桩返回 null**，文件头写清 TODO 与格式提示（需求 F18 的降级链接住）。

**验收**
- `测试/最近画的一张正常稿.sai2`（3000×4000，67 块）：解析出画布 3000×4000、找到 `thum` 块 67820 字节。
- `纯白画布256.sai2` / `纯白画布300400.sai2`：正确识别为 `intg` 路径并返回 null（不报错）。
- 只读文件头 + 块表：对 75MB 稿件的解析耗时 < 10ms（打日志核对）。

### T2.4 `jssf` → JPEG 重建（1 天，本项目最需要仔细的一步）

- `thumbs/jssf.ts`：逐段移植 `tools/jssf_probe.py`，函数拆成
  `readHeader` / `readQuantTables` / `readScanRows` / `buildJpeg`。
- 重建顺序：`SOI` → `DQT`(luma, [chroma]) → `DHT`(IJG 标准 4 表) → `SOF0` → `DRI`(=`ceil(w/8)`) → `SOS` → 逐行 `u16 长度 + 熵数据`（行间插 `RSTn`，`n = 行号 & 7`）→ `EOI`。
- 采样因子 `0x11`；Huffman 常量表与 Python 脚本一字不差（照抄，不改写）。
- 边界：行越界 / 长度为 0 / `channels` 非 1/3 → 抛 `JssfError`，由调度层降级。

**验收**
- 用 3 个真实 `.sai2` 重建出的 JPEG，与 Python 脚本产出的 `.thumb.png` **做像素比对，平均差 < 1**（脚本已能出图：375×500 RGB）。
- 故意截断字节流：抛 `JssfError`，不崩进程。
- 单文件重建 + 落盘耗时 < 100ms。

### T2.5 PSD 解码 + PNG 编码（1 天）

- `thumbs/psd.ts`：`readPsd(buffer, { skipLayerImageData: true, skipThumbnail: false, useImageData: true })`，取 `psd.imageData`（RGBA）。
- `thumbs/png.ts`：手写编码器 —— `IHDR` + `IDAT`（`zlib.deflateSync`）+ `IEND`，CRC32 用查表法（约 20 行）。**不引入 node-canvas**（原生依赖会让免安装包从 80MB 涨到 150MB+，且 Win7 兼容差）。
- `thumbs/thumb.worker.ts`：>20MB 的 PSD 丢 worker 解码，主进程只 await 结果；worker 崩溃 → 该文件降级占位，主进程不受影响。
- 缩略图统一缩到**长边 512**（卡片最大 260，2× DPR 够用），用 `imageData` 降采样（最近邻 + 4×4 平均，别上复杂插值）。

**验收**
- 20MB PSD：出图，主进程 UI 无卡顿（DevTools 无 >200ms 长任务）。
- 300MB PSB：worker 里跑，界面照常操作；解码完成出图。
- 16bit / CMYK PSD：ag-psd 若返回异常 → 降级占位，日志一条 warn，不影响其他卡片。
- 输出的 PNG 用系统看图软件能正常打开（验证 CRC 与 zlib 正确）。

### T2.6 缩略图协议（0.5 天）

- 复用现有 `sai2img` scheme，host 分流：
  - `sai2img://bg/<file>` → `data/backgrounds`（已有）
  - `sai2img://thumb/<key>` → `data/cache/thumbs`（新增）
- 路径校验同现有逻辑（`startsWith(root + sep)`），只放行 `<32 位 hex>.<ext>`，挡路径穿越。
- 命中 `.fail` 的键返回 404，前端展示占位卡。

**验收**
- `<img src="sai2img://thumb/<key>">` 直接出图，不经过 base64。
- `sai2img://thumb/..%2F..%2Fconfig.json` 被 403。
- **注意（v1.19 教训）**：这里只做"显示"，任何 `toBlob` / `toDataURL` 场景（如以后导出）必须改走字节流。

### T2.7 文件列表 IPC 与前端 store（1 天）

- `files.list({ dir?, keyword?, limit, offset })` → `{ total, items }`；排序固定 `mtime desc`。
- 变更推送 `files:changed`：批量 `{ adds: ProjectFile[], removes: string[], reset?: true }`，**每 120ms 合并一次**，避免 2000 个文件触发 2000 次 React 更新。
- `store/files.ts`：收到事件后按 path 合并（`Map` → 数组），保持滚动位置。
- 卡片渲染时先出占位轮廓（固定宽高比 3:4），缩略图加载完淡入 —— 避免瀑布流跳动。

**验收**
- 丢 100 个文件进目录：界面只更新 1~2 次（React DevTools 看 commit 次数）。
- 滚动到第 800 条再删掉第 3 条：列表正确更新且滚动位置不动。
- 前端收到 `reset`：清空重排，不残留旧卡片。

### T2.8 瀑布流 + 卡片（1.5 天）

- `useMasonry.ts`：给定容器宽、卡片宽（来自 `general.thumbnailSize`）、各卡片实际高度（缩略图加载后回填），算出「列数 = floor(宽 / (卡片宽 + 间距))」和每条 `{x, y}`，按列累积最短列。
- `MasonryGrid.tsx`：绝对定位 + `transform: translate3d`；只渲染「可视区 ± 一屏」的卡片；`ResizeObserver` 监听容器宽度变化重排。
- 卡片高度未知时先用 3:4 占位，图加载后回填真实高度并重排（重排只影响下方卡片 y 值，已有滚动位置补偿）。
- `FileCard.tsx`：缩略图 / 文件名（单行省略）/ 后缀角标 / 悬停抬升 / 选中蓝边 + 右上角勾（需求 §3 视觉要求，样式已有变量）。

**验收**
- 1000 条数据：滚动**肉眼无卡顿**，DevTools Performance 无 >50ms 长任务。
- 窗口从 1360 拉到 1920：列数从 4 变 6，不闪白。
- 卡片大小从「中」调「大」：立刻重排，图片不重新请求（缓存命中）。
- 缩略图 404 的卡片：占位块高度稳定，不引起瀑布流抖动。

### T2.9 占位卡与失败降级（0.5 天）

- 三级降级：`解码失败 → 同名 png 当封面 → 信息卡`。
- 信息卡内容：后缀名大字 + 画布尺寸（SAI2 可读）+ 修改时间 + 文件名。配色用 `--text-2/3`，不抢戏。
- 失败原因只记一次日志（同 key 不重复刷）。

**验收**
- 0 字节 sai2 / 改扩展名的 txt / 加密 PSD：三种都出信息卡，控制台无红字。
- 有同名 png 的 sai2：显示 png 封面（顶部标「封面」角标）。
- 日志页里每个坏文件只出现 1 条 warn。

### T2.10 设置页「监听目录」卡片（0.5 天）

- 列表：路径（可点击在资源管理器打开）、含子目录开关、移除按钮。
- 添加：`dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] })`，加进去后立刻扫描并提示「已开始索引 N 个文件夹」。
- 扩展名勾选：按 `config.watch.extensions` 的默认集合，可增减（`.clip` / `.kra` 先勾上但实际靠系统缩略图插件，M3a 才接）。
- 「立即重扫」按钮：清索引重新扫（不动缓存文件，除了 mtime 变化才失效）。

**验收**
- 加一个目录：文件页 2 秒内开始出卡片。
- 加一个不存在的路径（手动改配置文件）：提示「路径不存在」，不崩。
- 移除目录：卡片立刻消失（不删磁盘文件）。

### T2.11 自测与性能基线（1 天）

按开发文档 §1.4 走完整五条，另外补：

| 场景 | 判据 |
|---|---|
| 首屏 200 张（含 20 个 sai2） | 出图 ≤ 4 秒（缓存空） |
| 1000 条滚动 | 无 >50ms 长任务 |
| 5 万文件目录 | 首扫 ≤ 90 秒，期间界面可用，有进度提示 |
| 复制 500 个文件进目录 | 事件合并生效，界面不卡死 |
| 拔掉监听目录所在的移动硬盘 | 1 条 warn，程序正常 |
| 缩略图缓存 3GB | 自动清到 2GB 以下 |
| 回归 | 外观四组合、背景图取景、日志页 |

---

## 4. 不做的事（本阶段明确不碰）

- **标签、搜索、右键菜单、改名/复制/移动/删除、详情面板大图** → M2b。
- **`intg` / `dpcm` 小画布解码**（<512×512 的 SAI2）→ 留桩，走封面兜底。**估 1.5 天，建议单独作为 M2a-补 任务**，不混进来。
- **插件化缩略图提供者**：M2a 用内置提供者链，但**接口按插件形状写**（`{ id, match(ext), resolve(file) }`），M3a 只需把它包成插件，不重写。
- **主题插件 / 视频背景 / 联动**：按你的定调，UI 定版，这类需求交给 M3a 插件系统承载。视频背景需要插件能挂 DOM 与读取本地视频，属于新的扩展点，**在 M3a 计划里单列**（见 §5 风险 6）。
- PSD 图层、SAI2 图层、`.clip` / `.kra` 原生解码（先靠 M3a 的 `thumb-shell` 插件或占位卡）。
- 列表视图、排序切换、标签筛选条（M2b / P2）。

---

## 5. 风险与未知

| # | 风险 | 概率 | 降级方案 |
|---|---|---|---|
| 1 | `jssf` 移植出错（Huffman 表或 RST 位置差一点就花屏/黑图） | 中 | **对拍机制**：Python 脚本先产出黄金 `.thumb.png`，TS 版逐像素比对；不一致就退回"只读 `thum` 里的 JPEG 前缀直出"，仍不行则整类走封面兜底 |
| 2 | PSD 变体多（16bit / CMYK / 超大画布），`ag-psd` 覆盖不全 | 中 | 任何异常都降级信息卡；日志记 `psd 解码失败：<原因>`，不阻塞其它卡片 |
| 3 | 超大目录（5 万+）首扫慢 | 中 | 分批 yield + 进度条；超过 3 万条提示"建议缩小监听范围"；仍可用（只是首屏慢） |
| 4 | chokidar 在网络盘 / OneDrive 目录收不到事件 | 低 | 该类目录降级为**30 秒定时轮询**（只比对 mtime），设置页标注「该目录已切为轮询模式」 |
| 5 | 瀑布流自写虚拟滚动有坑（测量抖动导致跳动） | 中 | 先上"非虚拟的 CSS `columns` 方案"保底（1000 条也能跑），性能不达标再换虚拟滚动；两条路都在 T2.8 内预留 |
| 6 | 未来"视频背景 / 动态主题"插件需要比"只输出 CSS 变量"更强的能力 | 确定（但不是 M2a） | M2a 不动外观；M3a 计划里把主题插件拆成两级：`theme-vars`（只出变量，现有 F17）与 `theme-dom`（可挂一个全屏层 + 读本地文件，权限显式声明）。**这一条需要你在 M3a 计划阶段拍板** |
| 7 | 缩略图缓存膨胀 | 低 | 2GB 上限 + 按 mtime 淘汰 10%；设置页可手动清空 |
| 8 | 图片色偏（背景透明卡片下的缩略图） | 低 | 缩略图卡片底恒为 `--bg-card` 实色（已定），本次不改 |

---

## 6. 需要你先点头的三件事

1. **任务清单与顺序**按 §3 走（9 天）。如果只想先看到"丢文件能出图"，可以先只做 T2.1~T2.6（约 5.5 天），瀑布流与设置页交互放第二批。
2. **缩略图尺寸固定长边 512**（不随卡片大小重生成）。理由是卡片最大也就 260px，2× DPR 512 足够；这样一份缓存通吃所有卡片尺寸，省磁盘也省解码。
3. **小画布 SAI2（<512×512）本次不做真解码**，走信息卡；确认这样可接受，或要求一并做（+1.5 天）。

确认后我按 T2.1 开始，每完成一个任务我都会给你可运行的状态。
