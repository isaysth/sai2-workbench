# M3b 联动 + 打开器 + 示例 · 开发计划（待确认）

> 需求：v1.24　｜　开发文档：v1.11　｜　前置：M3a 已交付（`docs/plans/M3a-delivery.md`）
> 状态：**待确认，代码零改动**。按开发文档 §1.2，收到针对本计划的「按这个做」之前不写代码。
> 依据：开发文档 §9 T5.1~T5.4、§10 验收清单，需求 F14 / F15 / F16 / F17，`M3a-delivery.md` §5 / §7。

---

## 1. 目标

这一阶段结束时，用户能做的事：

1. 点侧栏「启动 SAI2」或启动页大按钮，**真的拉起画图程序**；切默认打开器后，按钮文案、双击文件卡的行为一起跟着变。
2. 三个打开器（`opener-sai2` / `opener-ps` / `opener-csp`）作为插件出现在插件中心，可单独禁用；没填路径的打开器在下拉里灰掉，不会点了没反应。
3. 启动画图程序时，`sai2-companion` 按配置的顺序和延迟拉起参考图 / 录屏软件；某个路径失效只在日志和联动状态里提示，**不阻断主程序**。关掉工作台，外部程序不被连带关掉。
4. 文件卡有右键菜单：内置的「打开 / 打开所在文件夹」+ 插件贡献的菜单项；`hello-world` 示例插件一键安装后菜单里就多一项，照着改就能写自己的插件。
5. 主题插件能改配色 / 圆角 / 字号等 CSS 变量，示例主题随包自带；装 / 卸即时生效，主题写坏自动回退浅色，不白屏。
6. `--dev` 模式下改插件代码自动生效，不用重启程序。

---

## 2. 交付物

### 新增

| 路径 | 内容 |
|---|---|
| `src/main/openers/service.ts` | 打开器注册表：`register` / `list` / `resolve` / `launch`；发 `opener_before_launch` / `opener_after_launch` 事件 |
| `src/main/ipc/openers.ipc.ts` | `app:launch` / `app:openWith` / `app:pickFile` / `app:pickDir` 四个通道 |
| `src/main/theme/service.ts` | 主题变量注册表：`registerVars` / `unregister` / `getVars`；无效变量过滤 + 回退 |
| `src/main/plugins/watch.ts` | 开发模式监听 `plugins/` 与内置插件目录，debounce 后 `reload` / `rescan` |
| `src/renderer/components/ContextMenu.tsx` | 最小右键菜单：内置项 + 插件 `fileActions`，按 `when` 过滤 |
| `src/renderer/store/theme.ts` | 主题变量订阅，写到 `documentElement.style` |
| `resources/builtin-plugins/opener-{sai2,ps,csp}/` | 三个打开器插件（manifest + index.js） |
| `resources/builtin-plugins/sai2-companion/` | 联动插件（manifest + index.js） |
| `resources/builtin-plugins/hello-world/` | 示例插件：演示配置表单、文件动作、侧栏页、日志、事件订阅 |
| `resources/builtin-plugins/theme-demo/` | 示例主题：一组 CSS 变量覆盖 |
| `tests/unit/openers.test.ts` | 默认打开器解析、缺失路径提示、禁用后回退、事件时序 |
| `tests/unit/theme.test.ts` | 变量白名单、坏值过滤、卸载回退 |
| `docs/plans/M3b-delivery.md` | 交付说明（交付时产出） |

### 修改

| 路径 | 改动 |
|---|---|
| `src/main/plugins/host.ts` | 给 `PluginContext` 补 `ctx.provide`（插件注册 opener 服务）与 `ctx.addThemeVars` |
| `src/main/plugins/index.ts` | 接 `openers` / `theme` 两个内核服务；`--dev` 时挂目录监听 |
| `src/shared/channels.ts` | 新增 4 个 invoke 通道 + `theme:changed` 事件通道 |
| `src/shared/types.ts` | `RuntimeInfo` 增 `dev` 标记；`AppConfig.openers` 增默认打开器可选项 |
| `src/preload/index.ts` / `index.d.ts` | 暴露 `window.api.app.launch/openWith/pickFile/pickDir`、`window.api.theme.*`、`window.api.ui.fileActions` |
| `src/main/index.ts` | 构造 `OpenersService` / `ThemeService` 并 provide；接启动与退出事件 |
| `src/renderer/App.tsx` | 启动按钮接真实 IPC；侧栏文案改从打开器注册表取；删 `LAUNCH_LABEL` 硬编码 |
| `src/renderer/pages/LaunchPage.tsx` | 大按钮接真实启动；联动状态显示实例数；删「M3b 接入」文案 |
| `src/renderer/components/FileCard.tsx` | 加双击打开 + 右键菜单 |
| `src/renderer/pages/SettingsPage.tsx` | 「自动查找」接 `pickFile`；默认打开器下拉从注册表取；新增联动插件配置入口 |
| `src/renderer/components/Sidebar.tsx` | 联动状态提示从写死文案改为插件上报 |
| `package.json` | `dev` 脚本传 `--dev` 标记 |
| `需求文档.md` / `开发文档.md` | 升版本并同步 M3b 状态 |

---

## 3. 任务分解

### T5.1 打开器服务 + 三个 opener 插件（1.5 天）

- 内核 `OpenersService`：`register({id, label, exts, open})` 由插件调用；`resolve(file?)` 按 `config.openers.default` 选，文件类型不匹配时回退默认；`launch(file?)` 执行并派发前后事件。
- 三个 opener 插件 `inject: ['openers', 'config']`，在 `apply` 里注册自己；路径从 `config.openers.<id>.path` 取，不写死在插件里。
- 用 `child_process.spawn(path, args, { detached: true, windowsHide: false })` + `unref()`：关掉工作台不连带关外部程序。路径不存在给中文提示并记日志。
- 设置页「自动查找」在常见安装位置找 `sai2.exe` / `photoshop.exe` / `clipstudiopaint.exe`，找不到再让用户手选；默认打开器下拉只列已配置路径的插件。
- **验收**：切到 `opener-ps` 后侧栏文案变「启动 PS」，双击 `.psd` 走 PS；把 PS 路径清空后下拉灰掉，点启动给中文引导不弹堆栈。

### T5.2 sai2-companion 联动插件（1 天）

- 订阅 `opener_before_launch`，按 `apps` 配置（名称 / 路径 / 延迟 / 开关）排序，用 `ctx.runLater` 依次启动；`app_quit` 时不做任何 kill。
- 路径失效：`existsSync` 检查失败 → 日志 warn + `ctx.addToolbarAction` 之外再上报一个状态给侧栏（红点 + hover 文案），不抛错。
- 配置表单复用 `ConfigField.list`，`item` 含 `name`(string) / `path`(path,filter=exe) / `delay`(int) / `enabled`(bool)；M3a 交付说明里 path 用文本框的临时方案在这里补齐选择器。
- **验收**：配两项（延迟 0 / 500ms）启动，日志有两条且顺序正确；把其中一项路径改成不存在的，主程序照常启动、侧栏标红；关掉工作台后外部程序仍在。

### T5.3 右键菜单 + hello-world 示例（1 天）

- 渲染端 `ContextMenu`：FileCard 右键弹出，内置「用默认程序打开」「打开所在文件夹」「复制路径」；插件 `fileActions` 从 `plugin:list` 下发的贡献点里取，主进程 `when` 判断不了就交给渲染端按扩展名过滤。
- `hello-world` 演示全部扩展面：`configSchema`（string / bool / enum / list 各一个）、`addFileAction`、`addToolbarAction`、`addPage`（iframe HTML）、`log`、`on('file_open')`、`runLater`。
- 示例插件用「演示用，可随时卸载」标注，不设 `system: true`。
- **验收**：一键安装后右键多一项、侧栏多一页；禁用后菜单项和页面同时消失，无残留。

### T5.4 theme-vars + 示例主题（1 天）

- `ThemeService`：插件 `ctx.addThemeVars({ '--accent': '#f60', ... })`；内核维护「插件 id → 变量表」映射，`unregister` 立即重算；变量值做白名单（只接受颜色 / 数字 / px / 合法 CSS 值），`cssText` 注入失败自动回退浅色。
- 与现有三套外观叠加规则：插件变量优先级高于主题默认值，但**不覆盖** `--glass-alpha` / `--glass-blur` / `--bg-clarity`（这几项是 M1 定版的交互参数）。
- `theme-demo` 示例主题随包：改强调色、圆角、卡片字号三处。
- **验收**：启用示例主题配色立即变；把变量写成非法值 → 回退浅色、日志有原因；卸载 → 恢复原主题；重启后保持。

### T5.5 `--dev` 热重载（0.5 天）

- `npm run dev` 传 `--dev`；主进程 `resolvePaths` 读取该标记，`RuntimeInfo.dev = true`，设置页显示「开发模式」。
- `plugins/watch.ts` 用 `fs.watch` 监听用户插件目录与内置目录：manifest 变化 → `pluginSystem.rescan()`；entry / config 变化 → 单插件 `reload()`；200ms debounce。
- 开发模式才监听；正式版零开销。热重载失败保留旧状态并在插件页显示原因。
- **验收**：改示例插件 `index.js` 里的日志文案，不重启即在日志页看到新文案；改坏语法后插件标 failed，其它插件不受影响。

### T5.6 自测与交付（0.5 天）

- `npm run typecheck` / `npm test` / `npm run build` 全绿。
- 抽测 M2a / M2b 回归：瀑布流出图、筛选、标签 / 项目改名保留、5000 条滚动。
- 三条异常路径：打开器路径失效、联动路径失效、主题变量非法值。
- 写 `M3b-delivery.md`，需求升 v1.25、开发文档升 v1.12，清理临时测试产物。

---

## 4. 关键实现决定（建议值，待确认）

### 4.1 theme-dom 权限清单（M3a 交付说明明确要求拍板）

建议按下面定稿，直接写进计划执行：

| 权限声明 | 含义 | v1  enforcement |
|---|---|---|
| `theme-vars` | 只输出 CSS 变量表 | 完全支持 |
| `dom-layer` | 可挂一个全屏层（iframe sandbox） | 支持，遮罩不拦截鼠标，插件页可开关 |
| `read-local-files` | 只能读插件自身 `data/plugin-data/<id>/` + 用户手选的一个目录 | 软约束：API 只给这两个根路径，插件自行 `require('fs')` 仍可绕过 |
| 网络 / `child_process` / `index.db` | 不提供 API | 软约束：v1 无进程隔离，清单只是声明 + 展示，不是沙箱 |

**本阶段建议只做 `theme-vars` + `dom-layer` 的最小版**（够覆盖 F17 的配色 / 背景图 / 圆角 / 字号），`read-local-files` 与动态视频背景推到 M3c 独立里程碑 —— 在 v1 无沙箱的前提下放开本地文件读取，风险大于收益。

### 4.2 tags 继续留在内核

`M3a-delivery.md` §5 写的是「推到 M3b 与 opener 一起接」。复评后建议**不拆**：`tags` 被文件页、详情面板、筛选条三处直接调用，拆分只增加一次 IPC 往返，收益低、回归面大。opener 拆插件的价值在于「换默认软件不用改主程序」，tags 没有对应诉求。

### 4.3 右键菜单是 M3b 的必做项，不是附带项

M2b 推迟了右键菜单，但 M3a 已经把 `addFileAction` 的数据收集做完了，T5.3 要有可见效果就必须把渲染端菜单补上。这一步不做，`hello-world` 演示不了「右键出现新菜单项」，需求 F15 也算没交付。

### 4.4 `thumb-shell` 不做

需求文档列了 10 个内置插件，本阶段做到 9 个（3 thumb + 3 opener + companion + hello-world + theme-demo）。`thumb-shell` 依赖用户装 SageThumbs 之类的外壳扩展，本机无法验证，且 `M3a-delivery.md` §5 已定调「让用户自己开发相关插件」。

### 4.5 默认打开器按扩展名解析

`config.openers.default` 是全局默认；双击 `.psd` 时若 `opener-ps` 已配置且可用，优先用它，否则回退全局默认。这样满足需求「默认 PS 打开 psd、SAI2 打开 sai2」而不用改主程序。

---

## 5. 待确认清单

上面 §4 已给出建议值，回复「按这个做」即按建议执行。如需调整，指出条目即可：

1. **theme-dom 权限**：按 §4.1 定稿，本阶段只做 `theme-vars` + 最小 `dom-layer`，`read-local-files` / 视频背景推 M3c？
2. **tags 是否拆插件**：按 §4.2 不拆？
3. **右键菜单**：按 §4.3 纳入 M3b？
4. **thumb-shell**：按 §4.4 不做？
5. **默认打开器按扩展名优先**：按 §4.5 做？还是严格只用全局默认？

---

## 6. 验收清单（本阶段逐条打勾）

```
□ 未配置打开器路径时点启动 → 中文引导，不弹堆栈
□ 切默认打开器 → 侧栏文案 + 双击行为同步变
□ 双击文件卡 → 用默认/扩展名匹配的打开器拉起程序
□ 联动按配置顺序和延迟启动，路径失效标红不阻断
□ 关掉工作台，外部程序不被连带关闭
□ hello-world 一键安装 → 右键多一项、侧栏多一页；禁用后都消失
□ 主题变量立即生效；非法值回退浅色；卸载恢复
□ 改插件代码 → dev 模式自动生效；改坏后只 failed 自己
□ 中文 / 空格 / 长路径全部可用
□ typecheck / test / build 全绿，M2a + M2b 回归抽测通过
```

---

## 7. 风险与边界

- **无进程级沙箱**：v1 插件仍是「可信本地代码，安装即授权」，权限清单只做展示与 API 约束，不是安全边界。
- **启动外部程序不可逆**：`spawn` 只做路径存在性检查，不做签名 / 白名单；用户填入的路径由用户负责。
- **热重载的 require 缓存**：主进程 CJS 缓存已按 `host.ts` 的方式清理，但插件自己 `require` 的子模块可能残留，热重载只保证入口文件更新。
- **主题变量与 M1 定版外观叠加**：`--glass-alpha` / `--glass-blur` / `--bg-clarity` 不允许插件覆盖，避免用户把 M1 调好的透明效果改坏后无处可退。
