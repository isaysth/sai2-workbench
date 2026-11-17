# SAI2 插件套件集成 · 计划（待确认，零代码改动）

> 来源：小红书用户分享的开源项目 [SAI2 插件套件 v1.64.0](https://celery-play-game.top/posts/sai2-download.html)，
> 上游 MIT 仓库 <https://github.com/PainterAnkry/sai2-plugin-suite>（Celery 的 fork 同为 MIT）。
> 目标：为 sai2工作台增加"一样的功能插件"。本文先讲清可行性边界，再给可选方案。

---

## 一、关键发现：它不是我们这种插件

调研后必须先说明一个架构事实，否则承诺会落空：

| 维度 | sai2工作台的插件 | 这个 SAI2 插件套件 |
| --- | --- | --- |
| 形态 | 一个 `index.js`（CommonJS），主进程直接加载 | 一套原生程序：`sai2_bridge.exe` + `sai2_agent.dll` + `sai2_injector.exe` + bat 脚本，`zig c++` 编译 |
| 工作方式 | 贡献菜单/页面/状态，调用内核服务 | **DLL 注入 SAI2 进程**读图层名 + **剪贴板往返**搬运图像 + 模拟快捷键回贴 |
| 运行环境 | Electron 主进程 | 独立 Windows x64 进程，需杀软白名单、权限与 SAI2 一致、仅 64 位 SAI2 |
| 能力边界 | 无法读取 SAI2 画布/图层 | 能抓取当前图层、应用滤镜后贴回 |

结论：**"把它的功能搬成我们的插件"做不到**——模糊/液化/选区这些依赖对 SAI2 画布的实时注入与剪贴板交互，我们的 `PluginContext` 没有也不该有这种能力（v1 插件是可信本地 JS，无进程隔离、不碰注入）。

能做的是**集成/桥接**：把它当作外部程序，从我们工作台里方便地启动、配置、联动，把它的入口嵌进我们的界面。

---

## 二、可选方案（请拍板）

### 方案 A：桥接插件（推荐，零风险）
新增一个内置插件 `sai2-fx-bridge`，把套件作为外部程序接入：

- **配置**：套件解压目录（`path` filter:`dir`）、是否随 SAI2 启动自动拉起面板
- **能力**：
  - 工具栏动作「打开 SAI2 插件面板」→ `ctx.shell.launch` 启动它的 exe
  - 右键 .sai2 文件动作「用插件套件处理」→ 拉起面板 + 打开该文件
  - 订阅 `opener_before_launch`（payload 含 `openerId`/`file`/`exe`），当 `openerId === 'opener-sai2'` 时按需自动拉起面板
  - `setStatus` 显示套件路径是否有效（失效显示 warn）
  - 侧栏页一段 HTML：功能介绍、快捷键表、白名单/64 位提醒
- **不捆绑二进制**：用户自己下载解压；插件只负责定位与启动
- 与现有 `opener-*`、`sai2-companion` 完全同构，改动小、回归风险低

### 方案 B：桥接 + 随包分发套件
在 A 之上，把 3MB 套件 zip 放进 `resources/`，用 `extraResources` 随包，插件提供「一键解压安装 / 添加杀毒白名单」引导。

- 优点：用户开箱即用
- 代价：①下载并校验源 zip（SHA-256 `24acd721…`）；②别人的 exe/dll 进我们的包，**杀软误报风险显著上升**（套件本身要白名单，会连累整个工作台的口碑）；③THIRD-PARTY-NOTICES 要补上游署名；④体积 +3MB

### 方案 C：JS 自研离线批处理（不做成"一样的功能"）
只把我们已能解码的格式（SAI2/PSD/PNG）做离线批处理：反相、去色、亮度对比度、阈值、模糊等纯像素算法，在缩略图 worker 里跑，产出新图片。

- 优点：纯自研、不碰注入、不误报、完全属于我们
- 缺点：**液化/选区/回贴图层做不到**，与套件"一样的功能"差距大；且是另一条产品线，不是"参考她的代码"

### 方案 D：移植 C++ 源码进 Electron —— 不推荐
需 zig 工具链、编译注入组件，与 Electron 架构冲突，维护成本极高。

---

## 三、推荐路线

**先做方案 A**，它用最小改动把"找图—打开—修图"串成一条链，且与现有插件体系一致。是否叠加方案 B 的随包分发，由你决定（见待确认项）。

---

## 四、任务分解（方案 A，若确认执行）

| 任务 | 内容 | 产出 |
| --- | --- | --- |
| T6.1 | 新增 `resources/builtin-plugins/sai2-fx-bridge/{plugin.json,index.js}` | 清单声明 `inject:[]`、`permissions:["启动用户指定的外部程序"]`、`system:false` |
| T6.2 | `configSchema`：`suiteDir`（path/dir）、`autoLaunchWithSai2`（bool）、`panelExe`（string，默认 `启动插件面板.bat` 或 `sai2_bridge.exe`） | 配置表单 |
| T6.3 | `apply` 实现：`ctx.shell.exists` 校验 + `setStatus`；工具栏/右键动作拉起面板；订阅 `opener_before_launch` 按 `openerId` 联动；`ctx.effect` 清理 | 插件逻辑 |
| T6.4 | `addPage` 一段 HTML：功能一览、快捷键、白名单与 64 位前提、上游 MIT 署名链接 | 侧栏说明页 |
| T6.5 | 单测：路径校验、事件联动过滤、动作触发（mock ctx），并入现有 vitest | `tests/unit/sai2-fx-bridge.test.ts` |
| T6.6 | 自测：干净启动插件 running；未配路径时 status=warn；配一个假 exe 后工具栏点击能拉起；typecheck/test/build 全绿 | 验证记录 |
| T6.7 | 文档：需求文档 + 开发文档版本递增；交付说明 `Sai2FxBridge-delivery.md` | 文档 |

## 五、不做的事

- 不做 DLL 注入、不模拟鼠标键盘、不读写 SAI2 画布
- 不把它的 C++/DLL 源码搬进我们的工程
- 不捆绑二进制（除非确认方案 B）
- 不改 M1~M4 已定版的外观与核心 IPC

## 六、风险与待确认项

1. **合规/口碑**：套件是第三方 MIT 工具且需杀软白名单；桥接只启动它、不改它，但要显著提示用户风险。方案 B 捆绑会放大误报风险。
2. **可执行入口**：套件的 bat 需要 cmd 解释，而 `ctx.shell.launch` 明确用参数数组直传、不走 shell（防注入）。实现时要么直接启动 `sai2_bridge.exe`，要么为 bat 走 `cmd /c`——后者需要内核加一个受控的 launchShell，属额外改动，倾向前者。
3. **待你确认**：
   - 选 A / A+B / C？
   - 插件是否设为 `system:true`（不可禁用）？建议 `false`（可关）。
   - 侧栏说明页要不要放套件的下载链接（我们不托管、只指向作者页面）？
