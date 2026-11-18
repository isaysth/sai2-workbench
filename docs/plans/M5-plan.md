# M5 计划：插件归属重整 + 安装体验升级

> 版本：v1.0　日期：2026-11-18
> 状态：**待确认**（未按此计划动代码）
> 依据：开发总纲 §1.2 拆分判定 / §2 拆分总纲；需求文档相关条款
>
> 本计划覆盖用户 2026-11-18 提出的四项诉求：① 悬浮插件独立、② FX Studio 官方化定位、
> ③ 同功能插件合并、④ 插件安装便捷化。全部是工作台框架仓库 `sai2-workbench\` 内的改动，
> 不涉及容器父目录结构，也不打包发版（按发布节奏，属功能迭代）。

---

## 目标（用户语言）

1. 「启动悬浮窗」不再是内置插件，而是和工作台分开的一个独立插件项目，能单独改、单独发。
2. FX Studio 从「社区非官方」改成「官方出品的功能插件」——功能来源照实写清（UI 与核心是自己写的，算法和部分工具借用了第三方 MIT 代码），不再给用户"野路子"的观感。
3. 插件中心里功能重复的插件合并：三个「打开器」并成一个、三个「缩略图」并成一个，列表从 10 项精简到 6 项，配置不丢、能力不减。
4. 装插件不用再点「选择文件」翻目录——点一个按钮打开插件目录，把 zip 丢进去，工作台发现后弹窗问一句「是否安装」，你点确定就装好，失败给出人话原因。

---

## 交付物

| 分类 | 文件 / 位置 | 说明 |
|---|---|---|
| 新独立项目 | `sai2工作台\sai2-window-float\`（新建 git 仓库） | 从内置搬出的悬浮插件，含 plugin.json / index.js / README |
| 框架内置插件 | `resources\builtin-plugins\`（6 个） | 删除 `launcher-float`；删除 `opener-sai2/ps/csp`、`thumb-image/psd/sai2`，新增 `openers`、`thumbs` 两个合并插件 |
| 框架配置 | `src\main\index.ts`、`config.ts` 相关 | 合并后旧配置键（openers.sai2 等、plugins.config.<旧id>）平滑迁移，不丢用户已填路径 |
| 插件 IPC | `src\shared\channels.ts`、`src\main\ipc\plugins.ipc.ts`、`src\preload\index.ts(+.d.ts)` | 新增：打开插件目录、扫描待装 zip、按路径安装、`plugin:zip-found` 事件 |
| 插件页 | `src\renderer\pages\PluginPage.tsx`、`store\plugins.ts` | 新增「打开插件目录」按钮；发现 zip 时弹确认框并展示安装结果 |
| 文档 | `开发总纲.md`、`开发总进程.md`、`README.md`、`需求文档.md`、`开发文档.md`；FX Studio 的 `plugin.json`/`README.md`/README 链接 | 归属、项目索引、身份定位、插件数量等同步 |
| 测试 | `tests/unit/` 新增或调整 | 覆盖配置迁移、zip 扫描的安全路径校验、合并插件注册 |

---

## 任务分解

### T1　悬浮插件独立（对应诉求①）

1. 在父目录建 `sai2-window-float\` 并 `git init`；把 `resources/builtin-plugins/launcher-float/` 的 `plugin.json` + `index.js` 复制过去。
2. 写独立项目的 `README.md`：声明它只依赖公开契约（`ctx.get('window-manager')` / `ctx.on('opener_after_launch')` / `ctx.addToolbarAction`），从工作台 v0.1.0 起可用；注明配置项与作用。
3. 确认内核侧 `window-manager` 服务与 `opener_after_launch` 事件是**公开稳定接口**（当前实现已满足：插件通过 `ctx.get`/`ctx.on` 使用，无内部源码依赖）——若需文档化，在总纲 §2.2 契约清单补这两项。
4. 从框架内置目录删除 `launcher-float`，更新 `开发文档.md` §8.6 内置插件清单、README 与需求文档中提到它的位置。
5. **兼容**：悬浮 UI 与托盘行为是内核随窗口状态渲染的，不随插件搬走；删除内置插件后需验证"未安装任何悬浮插件时工作台功能完整"（只是不再自动悬浮）。
6. 验收：独立项目 `git status` 干净、可从 zip 安装进工作台、装后悬浮/托盘行为与原来一致；不装时主程序正常。

### T2　FX Studio 官方化定位（对应诉求②）

1. `sai2-fx-studio\plugin.json`：`author` 改为官方口径（如「sai2工作台 · 官方功能插件」），`description` 改为「官方非基础插件；UI 与核心引擎原创，算法移植自 MIT 项目，随包注入套件来自上游 MIT fork」。
2. `sai2-fx-studio\README.md`：顶部免责声明从「非官方作品、无隶属或背书关系」改成**准确表述**——官方功能插件，但含第三方 MIT 代码、原样分发并注明来源；保留使用前备份画作的提醒。
3. 框架 README / 需求文档里对它的描述从「非官方插件」改为「官方功能插件（独立项目）」；保留独立项目路径。
4. 不改任何功能代码、不改算法与第三方声明内容。
5. 验收：三处口径一致（plugin.json / README / 框架文档），第三方来源声明仍在且准确。

### T3　同功能插件合并（对应诉求③）

合并粒度：三组 → 两个插件。

1. 新建 `resources/builtin-plugins/openers/`：把三个 opener 的注册合并进一个 `apply`，仍注册 `opener-sai2/ps/csp` 三个 id（内核按 id 读 `config.openers.*`，**插件 id 变了不影响打开器 id**）。plugin.json 用新 id `openers`。
2. 新建 `resources/builtin-plugins/thumbs/`：三个缩略图提供者合并注册，保留各自 supports/ext/priority，避免解码冲突；plugin.json 用新 id `thumbs`。
3. 配置迁移：旧 `plugins.config.launcher-float` 之外的 opener/thumb 插件本身无配置项（路径在 `config.openers.*`，与插件 id 无关），**无需迁移路径配置**；只需在 `plugins.disabled`（禁用名单）中把旧 id 映射到新 id，避免用户之前禁用了某个 opener 却在合并后被整体打开。
4. 删除六个旧插件目录；更新 `开发文档.md` §8.6 与 README「内置插件」相关表述。
5. 验收：插件数 10→6；三种格式打开器与三种缩略图全部仍可用；曾禁用单个 opener 的用户行为符合预期（需在 T3.3 明确策略并在交付说明里写清）。

### T4　安装便捷化（对应诉求④）

目标交互：点「打开插件目录」 → 用户把 zip 丢进去 → 工作台发现后弹窗「发现 X.zip，是否安装？」 → 确定即装 → 结果提示。

1. **IPC 新增**（`channels.ts` / `plugins.ipc.ts` / `preload`）：
   - `plugin:open-dir`：用 `shell.openPath(pluginDir)` 打开插件目录（需确认 preload 暴露，当前未暴露——新增最小面：`shell.openPath` 只开目录，不接受任意路径输入，或由主进程固定为 pluginDir）。
   - `plugin:install-zip-path`：`installChecked` 已有校验，新增一个"按给定 zip 路径安装"的 handler，复用现有 `extractZip` + `findManifestDir` + `safeZipName` 安全校验，不新写解压逻辑。
   - 事件 `plugin:zip-found`（主 → 渲染）：payload 为候选 zip 路径数组。
2. **发现机制**：复用现有 `PluginWatcher` 或新增轻量扫描——扫描 `pluginDir` 根目录下的 `*.zip`（只看一层，不递归；跳过隐藏文件）。策略二选一，写计划时定为：**启动扫一次 + 页面刷新扫一次 + `fs.watch` 目录新增时扫一次**（正式版也挂这个监听，因为它轻量且是功能所需，区别于 dev 热重载）。
3. **去重与记忆**：已安装的 zip 在同名插件存在时不再重复询问；用户点「取消安装」的 zip 记录到内存 Set，本次会话不再提示（避免反复弹窗）；是否需要持久化延后到后续里程碑（列入"不做的事"）。
4. **渲染端**：`PluginPage` 顶栏加「打开插件目录」按钮；订阅 `plugin:zip-found`，弹确认框（可复用 `ctx.dialog.confirm` 风格或 `window.confirm` / 自建 Modal），确定后调 `plugin:install-zip-path`，用 `onToast` 显示结果；刷新插件列表。
5. **安全**：沿用 `safeZipName` 拒绝 `../` 与绝对路径；拒绝超大 zip（设一个上限，如 200MB）与非法 manifest；所有 I/O 包 try/catch + 中文错误文案（编码规范）。
6. 验收：手动丢入一个合法 zip → 弹窗 → 确定后出现在列表且可用；丢入非法 zip → 人话报错不崩溃；已安装的 zip 不再重复提示；取消后本次不再提示。

### T5　文档与状态同步（对应诉求①②③④的收尾）

1. `开发总纲.md`：文档地图/目录树加入 `sai2-window-float`；项目索引加入新项目；契约清单补 `window-manager` / `opener_after_launch` 为公开能力。
2. `开发总进程.md`：状态卡加入新项目行（版本 0.1.0、独立仓库、无 remote 待建）；框架内置数 10→6；FX Studio 身份改为官方；更新快照时间与进行中项。
3. 框架 `README.md` / `需求文档.md` / `开发文档.md`：插件数、内置清单、FX Studio 定位、悬浮插件位置全部同步。
4. 更新两个仓库 git；按发布节奏**不打包、不上传 Release**。

---

## 不做的事

- **不改内核窗口/托盘逻辑**：`WindowManager`、`FloatBar`、托盘菜单保持原样；悬浮插件独立只是换存放位置。
- **不改 FX Studio 功能与第三方代码**：T2 仅改口径文档与 manifest 文案。
- **不合并 hello-world / theme-demo / sai2-companion**：前者是示例、后者是单一联动职责，不属于"同功能重复"。
- **不做 zip 管理的持久化**：取消安装的记忆只在本次会话；不做"忽略列表"配置文件、不做 zip 自动删除。
- **不做拖拽进窗口安装**：本里程碑只做"打开目录 + 丢 zip + 询问"这一种交互。
- **不打包发版**：按发布节奏，这是功能迭代，不重建整包/增量包、不动 Release。
- **不动容器父目录结构**：父目录仍是纯容器，`.workbuddy` 原地不动。

---

## 风险与未知

| # | 风险 | 应对 |
|---|---|---|
| 1 | 悬浮插件独立后无人安装 → 用户升级后"自动悬浮"功能消失 | ① 交付说明明确写出"现在是独立插件，需从 zip 安装"；② 考虑在框架内置一个**只含提示的占位**引导安装（若采纳需加回 1 个内置项，计划执行前定） |
| 2 | `window-manager` / `opener_after_launch` 作为独立插件依赖，算公开契约，未来内核改动可能破坏 | 在总纲 §2.2 明确列为公开契约，内核改这两处时按契约变更流程通知独立插件同步 |
| 3 | 合并插件后禁用状态错乱（用户曾禁用某个 opener） | T3 明确策略：合并时把旧 id 禁用状态按"全部禁用/保持启用"映射，二选一，交付说明写清 |
| 4 | 官方化定位与第三方声明的措辞边界 | 只改身份口径，不改技术事实；第三方 MIT 来源、逐层魔改清单、免责声明原文保留 |
| 5 | 目录监听在正式版常驻的开销与误报 | 只扫一层 `*.zip`、200ms 防抖、与 dev 热重载共用 watcher 基础设施；已安装/已取消的 zip 去重 |
| 6 | `shell.openPath` 暴露面 | 只开放"打开固定插件目录"这一个入口，不提供任意路径参数 |
| 7 | FX Studio 与框架版本适配 | 本次只改文案不改 API，apiVersion 仍为 1，无适配问题 |

---

## 需要你确认的三处决策（写进计划，确认后我按此执行）

1. **风险 1**：悬浮插件独立后，是否在框架保留一个"提示去安装"的占位内置项？（推荐：**保留**，避免升级后功能静默消失）
2. **风险 3**：合并插件时，用户之前单独禁用过某个 opener/thumb 的，合并后如何处理？（推荐：**保持禁用**——若组内任一旧插件被禁用，则合并插件默认禁用，让用户手动启用）
3. **zip 发现方式**：确认采用"启动扫 + 刷新扫 + 目录新增监听"三合一（推荐），还是仅"点刷新时扫"更保守。

> 按项目铁律：本次只交计划，**等你针对计划回复「按这个做」后**才开始改代码。
