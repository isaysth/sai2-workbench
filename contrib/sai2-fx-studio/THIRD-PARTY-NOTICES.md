# 第三方声明与魔改清单 · SAI2 FX Studio

本插件是一个**非官方**作品，与下游分发者、小红书分享者及上游作者均无隶属或背书关系。

## 一、上游来源

- **项目**：PainterAnkry/sai2-plugin-suite（SAI2 插件系统：伴随宿主 + 注入代理 + 一功能一窗口 UI）
- **许可**：MIT License，版权所有 (c) 2026 PainterAnkry（全文见 `LICENSE-UPSTREAM`）
- **仓库**：<https://github.com/PainterAnkry/sai2-plugin-suite>
- **获悉途径**：经小红书用户分享的 fork 了解到该项目；该 fork 同为 MIT 许可。

根据 MIT 许可要求，本插件保留上游版权声明与许可全文，并逐层列明改动如下。

## 二、分层魔改清单

| 层 | 上游实现 | 本插件做法 | 改动性质 |
| --- | --- | --- | --- |
| UI 层 | Win32 GDI 自绘（`tools/bridge/Ui.cpp` 等） | 全部重写为 HTML/CSS 独立玻璃浮窗（见 `ui/`），未使用上游任何绘制代码 | **完全重写** |
| 核心引擎 | C++ `BridgeCore`（`tools/bridge/BridgeCore.*`） | 全部重写为 JS（`core/session.js`、`core/image.js`），会话/撤销/预览/流程自研 | **完全重写** |
| 算法层 | C++ 头文件 kernel | 逐条移植算法逻辑到 JS（见下），未使用上游编译产物 | **移植** |
| 注入层 | `sai2_agent.dll` + `sai2_injector.exe`（C++/IAT hook） | **未修改、原样随插件分发**（`vendor/sai2-plugin-suite/`），打开浮窗默认自动运行注入器；本插件只通过公开命名管道协议对接 | **原样分发，代码未改** |
| 通信协议 | 单行 JSON 命名管道 `\\.\pipe\sai2agent` | 按上游 `docs/SAI2Injection.md` §4 公开的协议重新实现（`core/agent.js`） | **协议沿用，代码重写** |

### 随包上游套件（v1.64.0）

按用户要求，插件包**直接包含**上游套件，用户无需另外下载：

- 来源：<https://celery-play-game.top/dl/sai2-plugin-suite-1.64.0.zip>（Celery 的 MIT fork，派生自 PainterAnkry/sai2-plugin-suite）
- 版本：v1.64.0（2026-11-17）
- 压缩包的 SHA-256：`24acd7214c153540573407ad63a20930d50bfe97af2d5051ef46563aa25edca5`
- 存放位置：`vendor/sai2-plugin-suite/`，原样解压，**未修改任何上游文件**
- 元数据与关键二进制校验值见 `vendor/sai2-plugin-suite/SOURCE.json`
- 随包包含 `sai2_bridge.exe`、`sai2_agent.dll`、`sai2_injector.exe`、`plugins/`、`添加白名单.bat` 等上游原文件
- 我们不声明这些二进制的所有权；其版权与许可仍归上游作者所有

### 算法移植来源对照

| 本插件文件 | 上游来源文件 |
| --- | --- |
| `algorithms/blur.js` | `plugins/blur/src/BlurKernels.h` |
| `algorithms/adjust.js` | `plugins/adjust/src/AdjustKernels.h` |
| `algorithms/filters.js` | `plugins/filter-gallery/src/{Filters,GalleryFilters,GalleryArtistic}.h` |
| `algorithms/liquify.js` | `plugins/liquify/src/{LiquifyCore,LiquifySession}.h` |
| `core/clipboard.js` | 布局规则参考 `docs/SAI2Injection.md` §八之二、`tools/bridge/ClipboardImage.cpp` 的说明 |
| `core/agent.js` | 协议参考 `docs/SAI2Injection.md` §4、`tools/bridge/AgentBridge.h` |

## 三、我们新增/自研的部分（非上游）

- sai2工作台插件适配层：`index.js`、`plugin.json`、浮窗与工作台的 IPC 消息桥
- 玻璃浮窗 UI 与配色（沿用 sai2工作台的主题变量体系）
- 面向工作台的动作注册：工具栏入口、`.sai2` 右键入口、状态上报

## 四、商标与免责

- 本插件为社区非官方作品，**未经 PainterAnkry 及小红书分享者授权或背书**。
- "SAI2""PaintTool SAI" 等名称归各自权利人所有。
- 注入类工具可能触发杀软告警；随包附带的注入器与使用手册均来自上游，请自行判断风险，必要时以管理员运行随包 `添加白名单.bat`。
- 按 MIT 许可，本软件"按原样"提供，不提供任何明示或暗示担保；使用风险由使用者自行承担。
