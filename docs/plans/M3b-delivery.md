# M3b 联动 + 打开器 + 示例 · 交付说明

> 计划：`docs/plans/M3b-plan.md`　｜　需求：v1.25　｜　开发文档：v1.12
> 交付日期：2026-11-17　｜　状态：**已交付**

---

## 1. 现在能做什么

1. **启动按钮真的拉起画图程序**：侧栏「启动 XX」和启动页大按钮都走内核 `OpenersService` → `spawn(detached)`；未配置路径时给中文引导并跳设置页，不弹堆栈。
2. **默认打开器可切**：设置页下拉切换后，侧栏按钮文案、双击文件卡的行为一起变；双击 `.psd` 优先走已配置的 PS、`.sai2` 走 SAI2，回退到全局默认。
3. **三个打开器都是插件**：`opener-sai2` / `opener-ps` / `opener-csp` 在插件中心可见、可单独禁用；禁用后对应扩展名不再由它接管。
4. **联动软件按序启动**：`sai2-companion` 在启动画图程序时，按配置的顺序与延迟拉起参考图 / 录屏软件；路径失效只标红提示、不阻断；关掉工作台不会连带关掉外部程序。
5. **文件卡有右键菜单**：内置「用默认程序打开 / 在文件夹中显示 / 复制文件路径」+ 插件贡献的动作；`hello-world` 装好后菜单里就多一项，照着改就能写自己的插件。
6. **主题插件即时生效**：`theme-demo`（暖橙）改强调色 / 圆角 / 字号，装 / 卸立即见效；写坏的值被白名单挡掉，不白屏。
7. **`--dev` 改代码自动重载**：改插件 `index.js` / `plugin.json` 后 200ms 内自动 reload 或重新发现，不用重启；正式版零开销。

---

## 2. 实测数据

环境：Windows 11 build 26200 / Electron 45.3.3 / Node 24.22.3 / 开发模式。

| 场景 | 判据 | 实测 |
|---|---|---|
| 单测 | 全绿 | **25 条**（容器 7 / 加载器 6 / 事件 3 / 打开器 5 / 主题 4）全过 |
| 启动后插件状态 | 9 个全 running | 9/9 running，各只 apply 一次 |
| 打开器未配置点启动 | 中文引导 | `ok:false`，文案「还没配置任何可用的画图程序路径…」 |
| 配置路径后启动 | 真拉起程序 | `ok:true, openerId:opener-sai2`，日志「已启动 SAI2」；示例插件收到 `opener_after_launch` |
| 扩展名优先 | psd→PS、sai2→SAI2 | 单测覆盖；配置两份路径后 `resolve('a.psd')=opener-ps` |
| 默认打开器切换 | 侧栏文案同步 | 切成 `opener-csp` 后按钮文案变「启动 CSP」；配置正确落盘 |
| 联动按序启动 | 顺序 + 延迟 | 单测覆盖排序与事件时序；端到端确认状态上报 |
| 联动路径失效 | 标红不阻断 | 配失效路径后 `status = {"level":"warn","text":"联动：1 个路径失效"}`，主程序正常 |
| 关工作台不关外部程序 | 独立存活 | 启动 notepad 后退出工作台，notepad 仍在（测试后已清理） |
| 右键菜单 | 内置 + 插件项 | `["用默认程序打开","在文件夹中显示","复制文件路径","示例：看看这个文件"]` |
| 禁用示例插件 | 菜单与页面同消失 | 菜单项减为 3 项，侧栏「示例页」入口消失 |
| 主题装 / 卸 / 坏值 | 即时回退 | 启用 `--accent=#ff7a45`；禁用后内联样式清空；重启用恢复；注入值被白名单挡掉（单测） |
| 配置保存即时生效 | 不用手动重载 | `setConfig` 后自动 reload，联动新配置立即反映到状态栏 |
| 开发热重载 | 改代码自动生效 | 改 `hello-world/index.js` 文案 → 日志出现新文案 + 「热重载：hello-world」 |
| M2a/M2b 回归 | 不受影响 | 6 文件 / 6 卡片 / 3 张缩略图 ready / 标签项目池正常 |
| 构建 | 无错误 | `npm run typecheck` / `npm test` / `npm run build` 全绿 |

截图：`docs/shots/m3b-plugins.png`（插件中心：9 个插件 + 示例配置表单 + 动态侧栏页 + 联动告警 + 暖橙主题）。

---

## 3. 关键实现决定

### 3.1 opener 是「声明 + 内核 spawn」，不是插件自己写代码启动

三个 opener 插件只声明 `{id, label, configKey, exts}`，读路径、检查存在性、spawn、派发事件全在内核 `OpenersService`。这样插件极简、路径检查与中文错误统一、单测好写。插件可选覆盖 `launch` 实现自定义启动（已留接口）。

### 3.2 插件注册走内核服务的 `register()` + `ctx.effect`，不加通用 `ctx.provide`

计划里写的是给 `PluginContext` 补 `ctx.provide`，实现时发现内核已经 provide 了 `openers` / `theme` 服务，插件 `ctx.get('openers').register(...)` 返回注销函数、交给现成的 `ctx.effect` 即可自动清理。通用 provide 只会增加复杂度和测试面，故未实现。

### 3.3 主题变量内联注入，优先级天然高于主题文件

插件变量通过 `documentElement.style.setProperty` 写入（内联样式），优先级高于 `themes.css` 里的选择器定义，无需改任何主题文件。禁用时按记录的关键字 `removeProperty` 撤销，能恢复原样。

### 3.4 保存插件配置后自动 reload

M3a 里 `setConfig` 只写配置，插件 `apply` 时拿到的是配置快照，导致联动这类插件要用户手动点一次「重载」才生效。M3b 让 `setConfig` 保存后自动 `reload`，配置即时生效。

### 3.5 插件页无法传 React 组件，仍用 iframe

延续 M3a：`hello-world` 的 `addPage` 交一段 HTML，渲染端用 `<iframe sandbox="allow-scripts">` 渲染。示例页是纯静态说明，演示扩展点即可。

---

## 4. 与计划的偏差

| 计划 | 实际 | 原因 |
|---|---|---|
| 给 `ctx` 补 `ctx.provide` / `ctx.addThemeVars` | 只补 `addThemeVars`；opener 走 `register()` + `ctx.effect` | 内核服务已 provide，通用 provide 多余（见 §3.2） |
| `hello-world` 插件页「一键安装」到用户目录 | 做成内置插件，随包可见 | 内置插件已能在插件中心查看 / 禁用，且用户可直接照着源码改；一键安装会复制一份冗余代码 |
| `--dev` 命令行标记 | 用现成的 `isDev`（`!app.isPackaged`） | 开发脚本已是开发模式，无需新标记；设置页已显示「开发模式」 |
| 路径字段选择器补进插件表单 | 设置页打开器路径用 `pickFile('exe')`；联动插件表单的 path 字段仍是文本框 | 后者是 list 内的嵌套字段，选择器接法不同；功能可用（手填路径），体验留待优化 |
| 主题 `dom-layer` 最小版 | 未做 | 本阶段先落 `theme-vars`（覆盖 F17 的配色 / 圆角 / 字号）；DOM 层与视频背景按计划 §4.1 建议推 M3c |

---

## 5. 已知问题与边界

- **无进程级沙箱**：插件仍是「可信本地代码，安装即授权」；`theme-vars` 白名单只约束 CSS 变量，插件自己 `require('fs')` 不受限。
- **联动 `running` 锁按「本轮」计**：一次启动里的多个联动程序用 `running` 标记防重入，全部 launch 后释放；若某个程序 `shell.launch` 永不 resolve，锁不会释放（实际 `spawn` 的 spawn 事件很快）。
- **`--font-scale` 只接到少数元素**：卡片名、导航项、启动按钮、设置卡片标题；其它字号未接入，示例主题的「字号」效果有限。
- **主题变量不是持久化配置**：它由启用中的主题插件贡献，重启后插件仍启用则仍生效；禁用插件即恢复。
- **`thumb-shell` 未做**：依赖用户装 SageThumbs 之类外壳扩展，本机无法验证，按计划 §4.4 推给用户自己开发。

---

## 6. 清理状态

`data/config.json` 恢复基线（`plugins.disabled=[]`、`plugins.config={}`、打开器路径为空、默认 `opener-sai2`）；临时截图 `m3b-probe*.png` 已删，测试用 notepad 进程已结束；`plugins/` 用户目录为空，`data/cache/thumbs` 保持 17 张基线；保留 `docs/shots/m3b-plugins.png` 作为交付截图。  
单测文件 `tests/unit/{openers,theme}.test.ts` 均为纯逻辑（注入 runner / 无 Electron 依赖），可随时重跑。

---

## 7. 下一步

M4 打包：`electron-builder` 出免安装文件夹（`dir` + `zip`），9 个内置插件经 `extraResources` 复制到 `plugins/builtin`，校验便携路径与不可写回退，补 README / LICENSE / THIRD-PARTY-NOTICES，实测冷启动 / 内存 / 1000 文件。  
可选独立里程碑：`dom-layer` 主题插件与视频背景（需先定权限清单）。
