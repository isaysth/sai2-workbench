# M3a 插件底座 · 开发计划（待确认）

> 需求：v1.23　｜　开发文档：v1.10　｜　前置：M2b 已交付（`docs/plans/M2b-delivery.md`）
> 状态：**待确认，代码零改动**。按开发文档 §1.2，收到针对本计划的「按这个做」之前不写代码。
> 依据：开发文档 §8（plugin.json / PluginContext / 状态机 / 热重载）、§9 T4.1~T4.6、§12 第 5 条。

---

## 1. 目标

这一阶段结束时，用户能做的事：

1. 打开「插件中心」能看到**真实的内置插件列表和状态**（运行中 / 等待依赖 / 加载失败 / 已禁用），不再是空页。
2. 能禁用 / 启用一个插件；禁用后相关能力立刻消失，界面上不留点了没反应的按钮。
3. 能从**本地文件夹或 zip** 安装插件；装坏的插件在列表里显示中文原因，主程序照常启动。
4. 插件作者只写 `plugin.json` + 一个 CJS `index.js`，插件页就**自动生成配置表单**，不用写界面。
5. 缩略图三件套改由内置插件提供，但用户看到的卡片、详情、缓存命中行为**与现在完全一致**。

---

## 2. 交付物

### 新增

| 路径 | 内容 |
|---|---|
| `src/shared/plugins.ts` | `PLUGIN_API_VERSION = 1`、`PluginManifest`、`PluginStatus`、`PluginInfo`、`ConfigSchema` 类型 |
| `src/main/plugins/container.ts` | 服务容器：`provide` / `get` / `getAll` / `effect` / `disposeScope` |
| `src/main/plugins/events.ts` | 插件事件总线：固定事件名清单 + 订阅 / 退订 / 清空作用域 |
| `src/main/plugins/manifest.ts` | `plugin.json` 读取与校验（id / entry / apiVersion / inject / system） |
| `src/main/plugins/loader.ts` | 发现 → 校验 → 拓扑排序 → 状态机 → 激活 / 停用 / 重载 |
| `src/main/plugins/host.ts` | `PluginContext` 完整实现（log/config/dataDir/on/effect/runLater/add*Action/dialog/shell） |
| `src/main/plugins/index.ts` | `PluginSystem` 门面，供 `main/index.ts` 与 IPC 调用 |
| `src/main/ipc/plugins.ipc.ts` | `plugin:*` 通道：`list/install/uninstall/setEnabled/reload/getConfig/setConfig` + `plugin:changed` 广播 |
| `src/renderer/store/plugins.ts` | 插件列表 / 状态 / 表单草稿的 Zustand store |
| `src/renderer/components/SchemaForm.tsx` | 6 种字段（string / bool / int / float / enum / path / list）自动表单 |
| `resources/builtin-plugins/{thumb-image,thumb-psd,thumb-sai2}/` | 三个内置缩略图插件（manifest + index.js） |
| `tests/unit/container.test.ts` | 逆序清理、缺失服务报错、循环依赖、重复 provide 单测 |
| `docs/plans/M3a-delivery.md` | 交付说明（交付时产出） |

### 修改

| 路径 | 改动 |
|---|---|
| `src/shared/channels.ts` | 新增 7 个 `plugin:*` invoke 通道 + 1 个 event 通道 |
| `src/preload/index.ts`、`index.d.ts` | 暴露 `window.api.plugins.*` |
| `src/main/index.ts` | 在基础 IPC 之后、索引构造之前装配容器并激活插件；`will-quit` 逆序 dispose |
| `src/main/thumbs/index.ts` | provider 来源从硬编码 `PROVIDERS` 改为容器里的 `thumb-provider` 集合 |
| `src/renderer/App.tsx` | 页面渲染从硬编码三元表达式改为**页面注册表** |
| `src/renderer/components/Sidebar.tsx` | 导航项支持插件动态追加 |
| `src/renderer/store/ui.ts` | 补 `config.onChanged` 订阅（当前渲染端从未订阅，插件配置实时性依赖它） |
| `src/renderer/pages/PluginPage.tsx` | 从静态说明页重写为列表 + 详情 + 自动表单 |
| `package.json` | 加 `vitest` 依赖与 `test` 脚本 |
| `需求文档.md` / `开发文档.md` | 升版本并同步插件状态 |

---

## 3. 任务分解

### T4.1 服务容器（半天）

- `container.ts`：`provide(name, service)` / `get(name)` / `getAll(name)` / `effect(scopeId, fn)` / `disposeScope(id)`。
- `get` 缺服务抛带名字的特定错误 `MissingServiceError: 缺少服务 xxx`；`getAll` 缺失返回空数组。
- `disposeScope` 必须**逆序**执行 effect，单个 effect 抛错不阻断后续，错误写日志。
- 验收：`npm test` 单测 4 条全过（逆序、缺服务、循环依赖、重复 provide 覆盖）。

### T4.2 加载器与状态机（1 天）

- `manifest.ts`：读 `plugin.json`，校验 `id`（小写短横线）、`entry` 存在、`apiVersion === 1`、`inject` 为字符串数组、`system` 布尔；失败返回中文原因而不是抛。
- `loader.ts`：`discover(builtinDir, userDir)` 合并两处（用户目录同 id 覆盖内置）→ 校验 → 按 `inject` 拓扑排序 → `waiting / running / failed / disabled`。
- 注入服务后自动重试 `waiting` 插件；循环依赖全部标 `failed`，错误文案写成「循环依赖：a → b → a」。
- `apply` 抛错 → `failed` + `error` + 写日志 + 自动加入 `config.plugins.disabled`，主程序继续。
- 验收：手工造 4 个坏插件（缺 entry / apiVersion 错 / 缺依赖 / apply 抛错），启动不崩，列表状态与原因正确。

### T4.3 PluginContext 与事件总线（半天）

- `host.ts` 实现开发文档 §8.3 的全部成员；`ctx.config` 读写走 `config.plugins.config.<id>`，保存走 `config:set` 同一条原子写链路。
- `events.ts` 固定事件名清单（防止插件拼错名静默失效），`ctx.on` 注册的订阅在 `disposeScope` 时自动注销。
- `ctx.addFileAction` / `addToolbarAction` / `addPage` 先只做**数据收集 + 广播**，UI 消费在 T4.4 / M3b 补；禁用后必须清空该插件注册项。
- 验收：写一个测试插件，订阅 `app_ready` 打日志、加一个文件右键动作、设一个 interval；禁用后 interval 停止、动作消失。

### T4.4 插件中心页面（1 天）

- `PluginPage` 改为列表：卡片显示名称 / id / 版本 / 作者 / 状态徽标 / 错误原因；支持启用禁用、安装（文件夹或 zip）、卸载、重载、展开详情看 `plugin.json`。
- zip 安装：解压到临时目录 → 校验 manifest → 校验 `entry` → 移到 `plugins/<id>`；失败清临时目录并显示原因；只允许 zip 内相对路径，拒绝 `../` 穿越。
- 页面注册表：`App.tsx` 从 `ctx.addPage` 收集的表渲染动态页；`Sidebar` 同步追加图标项。
- 验收：装一个示例插件立刻出现在列表；禁用后它的页面和按钮都消失；卸载后目录被清掉。

### T4.5 SchemaForm 自动表单（半天）

- 支持 `string / bool / int / float / enum / path / list` 七种字段（`list` 可增删行，`path` 用现有系统对话框选路径）。
- 保存走 `config:set`，本地先更新再落盘（复用 `store/ui.ts:updateConfig` 的乐观更新套路），失败回滚并提示。
- `store/ui.ts` 补 `config.onChanged` 订阅，外部改配置时表单同步。
- 验收：用 `sai2-companion` 形状的 `apps` 列表字段增删 3 行并保存，重启后行数与值一致。

### T4.6 拆缩略图三件套（1 天，高风险）

- 三个 provider 从 `thumbs/providers.ts` 搬迁到 `resources/builtin-plugins/thumb-*/index.js`，各自 `plugin.json` 声明 `inject: ["thumbs"]`，`apply` 里 `ctx.get('thumbs').registerProvider({...})`。
- `ThumbsService` 增加 `registerProvider(provider)`，调度层从容器 `getAll('thumb-provider')` 取；**封面兜底 `findCover` 留在内核**，不插件化。
- 大 PSD worker 的入口保持 `psd.ts` 不动，但路径由插件声明的 `workerEntry` 提供；worker 产出协议（`ThumbOutput`）作为插件 API 一部分冻结。
- 禁用 `thumb-psd` 后 `.psd` 走封面兜底 / 信息卡，其它格式不受影响；重新启用恢复真缩略图。
- 验收：M2a 的三个回归点重测——jssf 逐像素对拍、PSD 出图、webp passthrough；5000 条列表与滚动基线不变。

### T4.7 自测与交付（半天）

- `npm run typecheck` + `npm run build` + `npm test` 全绿。
- 抽测 M2b 三条回归：二次启动 hydrate ≤300ms、改名标签保留、坏库自愈。
- 异常路径 3 条：插件目录不可读、`apply` 抛错、zip 内路径穿越。
- 写 `docs/plans/M3a-delivery.md`，同步文档版本。

---

## 4. 不做的事

- **不做 M3b 的内容**：三个 opener 插件、`sai2-companion` 联动、`hello-world`、启动按钮的真正启动行为、`--dev` 热重载（T4.7 只做手动重载）。
- **不做主题插件**：`theme-vars` 和 `theme-dom` 都推到 M3b，等 §6 的权限清单拍板。
- **不拆 `tags` 插件**：当前标签深度耦合 `files.ipc` 与详情面板，收益低风险高；建议与 M3b 的 opener 一起接（待确认，见 §6）。
- **不做智能文件夹 / 时间分组 / 多选 / Ctrl+F**（P2 范围）。
- **不做插件沙箱**：v1 插件是「可信的本地代码」，在主进程用 `require` 加载，安装即授权。插件页必须把这句话写在显眼位置。
- **不联网、不做插件市场、不做自动更新**（需求明令禁止）。
- 不动缩略图缓存键、并发池、瀑布流、SQLite schema。

---

## 5. 风险与未知

| 风险 | 降级方案 |
|---|---|
| 主进程加载任意 CJS = 完全权限，插件写坏可能卡死界面 | 只做「明示授权 + 状态隔离」：`apply` 超时 3s 标 failed；不做进程隔离（v1 定位是可信本地代码） |
| 大 PSD worker 直连 `psd.ts`，插件化后路径 / 协议可能断 | 保留 `psd.ts` 在内核，插件只声明 `workerEntry` 与输出协议；worker 不 require 插件代码 |
| 封面兜底直连 `imageProvider`，拆完可能丢封面角标 | `findCover` 与 `imageProvider` 留在内核，`onPatch` 四参数回填链原样保留 |
| 渲染端从未订阅 `config:changed`，插件配置外部改动不同步 | T4.5 显式补订阅；同时保留乐观更新，不改成「等主进程回包」 |
| 引入 vitest 与 electron-vite / vite 8 配置冲突 | 降级用 `node:test` + `tsx` 跑 `tests/unit/*.test.ts`，不引入额外运行时 |
| `plugin.json` 被改坏导致启动白屏 | manifest 校验在激活前完成，失败只标 failed；启动链路不 await 插件加载 |
| 插件 `effect` 清理抛错导致后续插件没卸干净 | `disposeScope` 逐个 try/catch，错误写日志，继续清下一个 |

---

## 6. 需你拍板（4 项）

1. **主题 DOM 层权限**（开发文档 §12 第 5 条点名要确认）
   - 建议：M3a 只做 `theme-vars`（输出 CSS 变量表）；`theme-dom`（挂全屏层、读本地文件）推到 M3b。
   - 若现在就要权限清单，建议定为：必须显式声明 `dom-layer` / `read-local-files`；读文件**只允许插件自身 `data/plugin-data/<id>/` + 用户手动选中的单个目录**；**禁止** `child_process`、网络请求、访问 `data/index.db`；插件页用红字列出权限，启用时需点一次「我信任此插件」。
2. **`tags` 是否本阶段拆成插件**：建议推到 M3b（与 opener 一起），理由是它现在被文件页 / 详情面板直接调用，拆分收益低、回归面大。
3. **是否引入 vitest**（T4.1 单测需要）：建议引入；不引入则用 `node:test` + `tsx` 降级。
4. **T4.6 缩略图拆分是否接受「禁用后落回封面兜底」**：这是零改内核调度层的前提；如果你要求「禁用 thumb-psd 后 .psd 完全不可见」，需要额外改降级链。

---

## 7. 验收清单

| # | 场景 | 判据 |
|---|---|---|
| 1 | 启动后打开插件中心 | 至少 3 个内置插件显示「运行中」，状态来自真实加载器 |
| 2 | 禁用 `thumb-psd` | `.psd` 走封面 / 信息卡，`.sai2` / 图片不受影响；重新启用后恢复 |
| 3 | 安装缺 `entry` 的插件 | 列表显示「损坏（原因）」，主程序不崩、日志有记录 |
| 4 | 安装 `apply` 抛错的插件 | 状态 `failed`，原因可读，其它插件照常运行 |
| 5 | 缺依赖插件 | 状态 `waiting`，服务被 provide 后自动变 `running` |
| 6 | zip 内 `../` 路径穿越 | 拒绝安装，临时目录被清理 |
| 7 | SchemaForm 增删 `apps` 列表 3 行 | 保存后重启仍在 |
| 8 | 插件注册侧栏页后禁用 | 页面和按钮一起消失，不留死链 |
| 9 | 回归 M2b | 二次启动 hydrate ≤300ms；改名标签保留；截断库自愈 |
| 10 | 回归 M2a | jssf 对拍零差异；webp passthrough；5000 条滚动 0 长任务 |
| 11 | 构建 | `npm run typecheck` / `npm run build` / `npm test` 全绿 |

---

## 8. 预计工作量

T4.1 0.5 天 + T4.2 1 天 + T4.3 0.5 天 + T4.4 1 天 + T4.5 0.5 天 + T4.6 1 天 + T4.7 0.5 天 = **5 天**。
