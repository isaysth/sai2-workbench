# M3a 插件底座 · 交付说明

> 计划：`docs/plans/M3a-plan.md`　｜　需求：v1.24　｜　开发文档：v1.11  
> 交付日期：2026-11-17　｜　状态：**已交付**

---

## 1. 现在能做什么

1. **插件中心是真的了**：打开「插件中心」能看到内置插件的运行中 / 等待依赖 / 加载失败 / 已禁用状态，不再是空页。
2. **能装能卸**：从文件夹或 zip 安装到 `plugins/`，可禁用、启用、重载、卸载（内置插件不能卸载）。zip 内 `../` 路径直接拒绝。
3. **写坏的插件不拖垮程序**：入口缺失、`apiVersion` 不符、`apply` 抛错、循环依赖都会在列表里显示中文原因，其它插件照常跑。
4. **配置表单自动生成**：插件只写 `configSchema`，插件页就出现字段；`list` 字段能增删行，保存后重启还在。
5. **状态栏随配置走**：不用等主进程回包，本地先更新；主进程改了插件配置，表单会跟着刷新。
6. **缩略图三件套变成内置插件**：`thumb-image` / `thumb-psd` / `thumb-sai2` 在插件页可见可禁用；禁用 `thumb-psd` 后 `.psd` 走封面 / 信息卡，其它格式不受影响。
7. **插件能加侧栏页**：`ctx.addPage` 贡献的页面出现在侧栏，禁用插件后页面和入口一起消失。

---

## 2. 实测数据

环境：Windows 11 build 26200 / Electron 45.3.3 / Node 24.22.3 / 开发模式。

| 场景              | 判据                | 实测                                                                                         |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| 容器 / 加载器 / 事件单测 | 全绿                | **16 条**（容器 7、加载器 6、事件 3）全过                                                                |
| 启动后内置插件状态       | 3 个运行中            | **3/3 running**，各只 `apply` 一次                                                              |
| 坏插件（入口缺失）       | failed + 可读原因     | `入口文件不存在：missing.js`，主程序正常启动                                                               |
| 缺依赖插件           | waiting → running | 单测覆盖，`提供 launcher 后自动 running`                                                             |
| `apply` 抛错      | failed + 自动禁用     | 单测覆盖，错误文案保留在列表里                                                                            |
| 循环依赖            | 全部 failed         | 单测覆盖，错误含 `循环依赖：…`                                                                          |
| 系统插件禁用          | 拒绝                | 单测覆盖                                                                                       |
| 配置 list 增删 3 行  | 重启后保留             | 写入 3 行 → 重启日志 `演示插件已启动，软件数：3`                                                              |
| 插件页首次出现         | 启动即在侧栏            | 修复前缺失，修复后 `nav` 含 `演示页`                                                                    |
| 插件页随禁用消失        | 禁用后无入口            | 禁用后 `nav` 无 `演示页`，重新启用后又出现                                                                 |
| 禁用 `thumb-psd`  | `.psd` 降级         | `{"state":"fail","reason":"暂不支持 .psd 的预览"}`；`.sai2` / 图片不受影响                               |
| 缩略图回归           | 真图仍出              | `正常稿.sai2` / png / webp 全部 `ready`；小画布 3 张仍走信息卡（已知留桩）                                      |
| 干净启动            | 恢复基线              | 3 插件 running、`plugins.disabled=[]`、`plugins.config={}`、6 文件、冷扫 **78ms**、索引 hydrate **1ms** |
| 构建              | 无错误               | `npm run typecheck` / `npm test` / `npm run build` 全绿                                      |

截图：`docs/shots/m3a-plugins.png`（插件中心：3 个运行中插件 + 详情 + 配置区）。

---

## 3. 关键实现决定

### 3.1 插件在主进程跑，v1 不做沙箱

`require` 一个 CJS 文件等于完全权限。计划已定调「可信的本地代码，安装即授权」，所以没有进程隔离；插件页顶部用醒目的提示写明这一点。  
`apply` 有 3 秒超时，抛错的插件标 failed 并自动禁用；但**死循环不会被超时打断**（JS 单线程），这是 v1 的硬边界。

### 3.2 刷新串行化，避免重复 apply

`provide()`、`setEnabled()`、`initialize()` 都会触发状态刷新。实测第一轮每个插件被 `apply` 两次（日志里「已启用」重复）。  
现在加载器内部把刷新排成一条链，并给激活加了 `activating` 锁 —— 对 M3b 的联动插件很关键，否则启动时会把外部程序拉起两遍。

### 3.3 插件页用 iframe srcDoc，不传 React 组件

开发文档写的是 `ctx.addPage({component})`，但插件在主进程，函数无法跨 IPC。改为插件交一段 HTML，渲染端用 `<iframe sandbox="allow-scripts">` 渲染，既显示内容又不把主应用开放给插件 DOM。

### 3.4 解码算法留在内核，插件只声明匹配规则

三个 `thumb-*` 插件通过 `ctx.get('thumb-kernel')` 拿到内核的 provider，再 `ctx.get('thumbs').registerProvider()` 注册。  
原因：PSD 解码产物在 `out/main/thumbs/psd.js`，让 JS 插件去 require 构建产物太脆弱。大 PSD 的 worker 判断改成按扩展名 + 体积，不再依赖插件给 provider 起的 id。

### 3.5 配置写入是递归代理 + 150ms 防抖

`ctx.config.apps.push(row)` 这种嵌套修改也要落盘，所以配置对象被递归 Proxy 包住；改动后 150ms 合并写一次，卸载时立刻 flush。

---

## 4. 与计划的偏差

| 计划                              | 实际                              | 原因                               |
| ------------------------------- | ------------------------------- | -------------------------------- |
| `ctx.addPage({component})`      | `ctx.addPage({html})` + iframe  | 主进程无法向渲染端传 React 组件              |
| 三个 provider 整个搬进插件              | 解码算法留内核，插件注册 match/resolve      | 避免插件 require 构建产物路径；打包后更稳        |
| path 字段用系统对话框                   | 先用文本框 + 路径提示                    | 不新增第 8 个 IPC；M3b 接 opener 时补选择器  |
| 单测框架「vitest 或 node:test」        | vitest 5.1 + `vitest.config.ts` | 与 vite 8 同生态；配置里补 `@shared` 别名   |
| `plugin:list` 返回 `PluginInfo[]` | 返回 `{plugins, pages}`           | 插件页贡献点只在事件里推过不了「首次加载」，必须随初始列表一起给 |
| zip 解压依赖未列                      | 新增 `yauzl` + `@types/yauzl`     | 纯 JS 无原生编译，符合打包约束                |
| 系统插件「开发模式可关」                    | 一律拒绝                            | 本轮没做开发模式例外；M3b 接内置 opener 时再定    |

---

## 5. 已知问题

- **没有进程级隔离**：插件死循环会卡住界面，只能靠任务管理器结束；升级到 worker / 子进程是独立里程碑。
- **zip 安装未做端到端点击验收**：系统文件对话框无法自动驱动；路径穿越校验由 `yauzl` 条目白名单 + manifest `entry` 校验两层保证，手动装一个正常 zip 即可验证。
- **`theme-vars` / `theme-dom` 未做**：按计划推到 M3b。`theme-dom` 的权限清单仍未拍板（建议只允许插件自身数据目录 + 用户手选的一个目录，禁网络 / `child_process` / `index.db`）。
- **`tags` 未拆成插件**：按确认的建议推到 M3b 与 opener 一起接。
- 小画布 SAI2（`intg`/`dpcm`）仍走信息卡，不是本阶段回归目标。可以不用管了，应用场景少
- 禁用缩略图插件后没有第三方解码兜底（例如 `.clip` / `.kra`），需等对应插件。不考虑，让用户自己开发相关插件

---

## 6. 清理状态

临时测试插件（`demo-config` / `broken`）、临时 PSD 文件、对应缩略图 fail 缓存、`data/index.db*` 均已删除或重建；  
`plugins/` 回到空目录，`data/cache/thumbs` 回到 17 张基线，配置 `plugins.disabled` 与 `plugins.config` 均为空。  
保留：`tests/unit/*.test.ts`、`vitest.config.ts`、`resources/builtin-plugins/` 三个内置插件（随包需要）、`docs/shots/m3a-plugins.png`。

---

## 7. 下一步

M3b「联动 + 打开器 + 示例」：三个 `opener-*` 插件、`sai2-companion` 联动、`hello-world` 示例、启动按钮真正拉起程序；  
开工前需要拍板 `theme-dom` 权限清单。再往后是 M4 打包（electron-builder 免安装文件夹，内置插件经 `extraResources` 复制）。
