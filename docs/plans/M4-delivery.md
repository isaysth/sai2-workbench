# M4 打包 · 交付说明

> 计划：开发文档 §9 M4　｜　需求：v1.26　｜　开发文档：v1.13
> 交付日期：2026-11-17　｜　状态：**已交付**

---

## 1. 现在能拿到什么

两个免安装产物，都在 `dist/`：

| 产物 | 用途 | 体积 |
|---|---|---|
| `dist/win-unpacked/` | 解压/双击即用的文件夹，`sai2工作台.exe` | 403MB（含 Electron 45 本体） |
| `dist/sai2工作台-0.1.0-win.zip` | 拷到另一台电脑的压缩包 | **159MB** |

- **免安装**：双击 `sai2工作台.exe` 即用，不写注册表，不需要管理员权限。
- **便携**：默认把 `data\`（配置/索引/缓存/背景）和 `plugins\`（用户插件）放 exe 同级，整个文件夹拷走数据跟着走。
- **不可写回退**：程序放在 `Program Files` 这类目录时，数据自动改放 `%APPDATA%\sai2-workbench\`，设置页如实显示「用户目录」；**内置插件仍在程序自带目录，不受影响**。
- **许可齐全**：`LICENSE`（MIT）、`THIRD-PARTY-NOTICES`（依赖 + libsai/SaiThumbs 署名）、`README`（安装/使用/插件开发）都已就位；打包产物内还有 electron-builder 自动附带的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

---

## 2. 实测数据

环境：Windows 11 build 26200 / Electron 45.3.3 / x64 / Node 22.22.2。

| 场景 | 判据 | 实测 | 结论 |
|---|---|---|---|
| 冷启动（打包版） | ≤3s | **516ms**（16:07:32.614 启动 → 16:07:33.130 窗口显示） | ✅ 远优于 |
| 内存（打包版稳定后） | ≤480MB | 4 进程：工作集合计约 **410MB**、私有合计约 **281MB** | ✅ |
| 1000 文件冷扫 | 秒级 | **171ms**（扫描完成日志） | ✅ |
| 1000 文件列表加载 | —— | **4ms**，虚拟滚动常驻 20 张卡片 | ✅ |
| 9 个内置插件（打包版） | 全 running | 9/9 running，各只 apply 一次 | ✅ |
| 干净启动（删 data 后） | 重建默认、插件齐全 | 9 running / 配置空 / 监听目录空 | ✅ |
| 便携模式 | 数据在 exe 同级 | 数据目录 `dist\win-unpacked\data`，设置页显示「便携（程序同级）」 | ✅ |
| 不可写回退 | 数据在 APPDATA、插件不丢 | `data` 占位为不可写后，数据改到 `%APPDATA%\sai2-workbench\data`，9 插件仍从 `resources\builtin-plugins` 全部加载 | ✅ |
| 类型/单测/构建 | 全绿 | typecheck、25 条单测、`npm run build` 全过 | ✅ |
| zip 体积 | ≤250MB（目标约 90MB） | **159MB** | ✅ 上限内，高于理想值（见 §5） |

截图：`docs/shots/m4-packed-plugins.png`（打包版插件中心：9 插件运行中、插件来源指向程序自带 resources 目录、数据目录标注便携）。

---

## 3. 关键实现决定

### 3.1 内置插件与数据目录解耦（M4 修复的真实缺陷）

`paths.ts` 原来把 `builtinPluginDir` 也算进 `base`（便携/回退）里：数据回退到 `%APPDATA%` 时，内置插件目录也跟着指过去，但打包资源只在程序自带的 `resources\` 里——**装在 Program Files 时 9 个内置插件会全部丢失**。

修法：内置插件目录在打包态固定为 `process.resourcesPath/builtin-plugins`（extraResources 复制过来的只读资源），与 `base` 无关；只有用户插件目录 `pluginDir` 跟随数据回退。加了老布局兜底 `rootDir/plugins/builtin`。实机验证两种模式下 9 插件都在。

### 3.2 打包只收 `out/`，不收整包 node_modules

本机 `node_modules` 582MB（其中 electron/dist 358MB）。`electron-builder.yml` 的 `files` 只列 `out/**/*` 与 `package.json`，运行依赖由 electron-vite 的 `externalizeDepsPlugin` 按实际引用收进 asar。避免把 devDependencies 与 Electron 源码重复打进包。

### 3.3 worker 解包到 asar 外

`worker_threads` 不能从 asar 内部加载，`asarUnpack` 把 `out/main/thumb.worker.js` 解到 `app.asar.unpacked/`，大 PSD 仍走 worker 解码、不卡界面。

### 3.4 打包走国内镜像

electron-builder 默认去 GitHub 拉辅助工具时遇到 502。打包命令配 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 走 npmmirror 镜像后成功；这只是打包时的环境变量，不影响产物运行（产物运行期零联网）。

---

## 4. 与计划的偏差

| 计划 | 实际 | 原因 |
|---|---|---|
| 内置插件复制到 `plugins/builtin` | 复制到 `resources/builtin-plugins` | 与数据目录解耦，回退模式下才不丢插件（见 §3.1）；加载器两个目录都扫，行为一致 |
| zip 约 90MB | 159MB | Electron 45 本体压缩后约 159MB，这是 Electron 应用的固有体量；仍在「不超过 250MB」硬指标内。要压到 90MB 需换更小的运行时或 UPX，风险大于收益，未做 |
| 代码签名 | 未签名 | 无签名证书；未签名不影响免安装使用，部分杀软可能误报，README 已说明 |
| 拷到另一台电脑实测 | 未做（本机无第二台电脑） | 便携/回退两种数据布局已在本机验证；跨机运行依赖目标机同为 Win x64，属正常 Electron 前提 |

---

## 5. 已知问题与边界

- **仅 Windows x64**：`win.target` 只出了 x64。需要 arm64 / 32 位得改 `electron-builder.yml` 重打。
- **未做自动更新**：免安装形态，升级靠替换文件夹（数据目录独立，可保留）。
- **`thumbReady:0` 瞬时值**：1000 文件冷扫后 2 秒内缩略图尚未全部异步生成，属正常；滚动到可见区会按需出图。
- **无代码签名**：见 §4。

---

## 6. 清理状态

- 测试集 `tests/perf1000` 已删；打包版 `dist/win-unpacked/data`（测试期写入的 1000 文件配置）已删，下次启动重建默认。
- 回退测试在 `%APPDATA%\sai2-workbench` 建的临时数据已删。
- 无残留 Electron 进程；`docs/shots/` 只保留交付截图 `m4-packed-plugins.png`。
- 可重跑基线夹具 `tests/fixtures/make-5000.mjs` 保留。
- 交付产物 `dist/win-unpacked/` 与 `dist/sai2工作台-0.1.0-win.zip` 为本次成果，予以保留。

---

## 7. 下一步（可选独立里程碑）

- `dom-layer` 主题插件与视频背景（需先定权限清单）；
- 磁盘写操作（改名 / 复制 / 移动 / 批量删除到回收站）；
- arm64 打包、代码签名、自动更新。
