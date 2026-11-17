# SAI2 FX Studio · 非官方插件实施计划（待确认，零代码改动）

> 需求来源：用户希望把她那套 MIT 插件的 **UI 层与核心引擎**换成我们自己的实现，  
> 做成**独立分发的非官方插件**（用户单独下载导入，不进工作台发布包），  
> 并**完整声明源码来源与我们的魔改**。  
> 上游：<https://github.com/PainterAnkry/sai2-plugin-suite>（MIT）；  
> 分发源：小红书用户分享的 fork。本文先讲清边界与取舍，确认后再写代码。

---

## 一、她的套件实际是四层（决定我们能重做哪几层）

| 层      | 她的实现                                                | ours                     |
| ------ | --------------------------------------------------- | ------------------------ |
| ① UI 层 | Win32 GDI 自绘（`Ui.cpp` + 4 个功能窗口）                    | **重写**：玻璃质感面板            |
| ② 核心引擎 | `BridgeCore`（C++，无界面）：抓图→调算法→回贴、参数/预览/撤销/多窗口会话      | **重写**：JS 版编排引擎          |
| ③ 算法层  | 5 个 C++ DLL（模糊/滤镜/调整/液化/hello，header-only kernel）   | **移植**：C++ 算法 → JS（理由见下） |
| ④ 注入层  | `sai2_agent.dll`（IAT hook 读图层）+ `sai2_injector.exe` | **原样使用她的二进制**，我们不分发      |

### 一个必须先讲透的技术死结

她的 ②③ 层是 **C++ 虚表接口**（`LoadLibrary(sai2_CreatePlugin)` → `IPlugin*` → vtable 调 `Execute()`），  
JS 主进程**无法直接调用 C++ 虚表 DLL**。有两条路：

- **路线 A（推荐）**：连 ③ 一起移植成 JS —— 算法源码是 C++ 头文件（`BlurKernels.h` /  
  `AdjustKernels.h` / `Filters.h` / `LiquifyCore.h`），纯像素运算，逻辑可逐行搬。  
  这样核心引擎自己就能跑算法，**完全不依赖她的 DLL**，插件是自洽的。  
  代价：液化（置换场、逐笔累积）在 JS 下大画布会慢，需要降采样预览兜底。
- **路线 B**：保留她的 DLL，另写一个 C++ headless 桥接进程供 JS 驱动 ——  
  需要 zig/MSVC 工具链（本机**一个都没有**），且要随插件分发她编译的 exe/dll，  
  与"插件自包含、只重做 UI+核心"的初衷冲突。**不推荐**。

**因此本计划默认走 A**：注入层（④）用她的二进制，其余三层都是我们的代码。  
"重做核心引擎"要能真正跑起来，算法层 JS 化是绕不开的一部分——这点请你确认。

---

## 二、运行时架构与数据流

```
用户工作台（Electron 主进程）
  └─ 插件 sai2-fx-studio（CJS，可信本地代码）
       ├─ ① UI：独立浮窗（内核新增受控窗口能力 + 玻璃质感）
       │        模糊 / 滤镜 / 调整 / 液化 四个功能页 + 图层列表 + 参数
       ├─ ② 核心引擎 core.js
       │        会话/参数/预览(降采样)/撤销栈/流程编排/多窗口状态
       ├─ ③ 算法 algorithms/*.js（从她的 C++ kernel 移植）
       │        blur / adjust / filter-gallery / liquify
       ├─ agent-client.js ── 命名管道 \\.\pipe\sai2agent（单行 JSON）
       │        命令：ping / layers / set.plugins / take.request / canvas.*
       └─ desktop.js ── 抓图与回贴
               剪贴板 CF_DIBV5 读写 + SendInput 菜单点击（PowerShell P/Invoke）
                     ▲
                     │ 注入（用户手动，插件只提供按钮与说明）
              sai2_agent.dll（她的，注入在 SAI2 进程内）
```

**关键点**：她的 agent 协议（`docs/SAI2Injection.md` §4）是**公开的 JSON 管道**，  
`AgentClient.h` 里连管道名和字段格式都写明了。JS 用 `node:net` 连  
`\\.\pipe\sai2agent` 即可，不需要她的任何代码。

---

## 三、分发方式（按你的要求）

- **独立 zip**：`sai2-fx-studio-0.1.0.zip`，作为 GitHub Release 的**单独附件**  
  （和主程序 zip 并列），**不进工作台发布包**。
- **导入方式**：用户解压到工作台的 `plugins/` 目录（便携模式在程序同级，  
  回退模式在 `%APPDATA%/sai2-workbench/plugins/`），重启后在插件中心看到它。
- **她的套件由用户自己下载**：插件配置里有一个 `path` 字段指向她的套件目录，  
  插件用它定位 `sai2_injector.exe`（注入按钮）与 `agent.dll`。我们的包里**不含她的二进制**。
- 插件 `system: false`（可禁用/可卸载），`inject: []`（不依赖内核服务，自洽）。

插件包目录：

```
sai2-fx-studio/
  plugin.json            # id/name/version/apiVersion=1/permissions
  index.js               # 注册工具栏动作/侧栏页/状态，启动本地服务
  core/                  # ② 核心引擎
    engine.js  session.js  pipeline.js  clipboard.js  agent.js
  algorithms/            # ③ 移植算法
    blur.js  adjust.js  filters.js  liquify.js  image.js
  ui/
    panel.html           # ① 玻璃质感面板（内联 CSS/JS，srcDoc 渲染）
  LICENSE-UPSTREAM       # 她的 MIT 原文
  THIRD-PARTY-NOTICES.md # 来源 + 魔改清单（见第五节）
  README.md              # 安装/使用/风险说明
```

---

## 四、任务分解（确认后执行）

| 任务    | 内容                                                                                                                                       | 产出                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| T7.1  | 插件骨架：`plugin.json` + `index.js`，configSchema（套件路径、自动注入、默认效果），`setStatus` 校验套件路径                                                          | 插件在工作台显示 running                      |
| T7.2  | **来源与魔改声明**：`LICENSE-UPSTREAM`、`THIRD-PARTY-NOTICES.md`、README 的致谢段                                                                      | 合规文件齐全                                |
| T7.3a | **内核改动**：新增受控插件浮窗能力（IPC + 独立 BrowserWindow，沿用主题变量），仅对声明该能力的插件开放 | 内核能力 + 单测 |
| T7.3b | ① UI 浮窗：玻璃质感样式（沿用工作台 CSS 变量/半透明/圆角），四功能页 + 图层列表 + 参数控件 + 快捷键提示 | `ui/*.html/js` |
| T7.4  | ④ agent 客户端：`node:net` 连命名管道，实现 `ping/layers/set.plugins/take.request`，断线重连与短预算                                                          | `core/agent.js` + 单测                  |
| T7.5  | ② 核心引擎：图像模型（RGBA8）、会话/参数/预览降采样/撤销栈/流程编排                                                                                                  | `core/*.js` + 单测                      |
| T7.6  | ③ 算法移植：先 blur + adjust（纯卷积/点运算，风险低），再 filter-gallery（10 个），最后 liquify（置换场，性能风险最高）                                                        | `algorithms/*.js` + 对照测试              |
| T7.7  | 抓图/回贴：`clipboard.js` 写 CF_DIBV5（124 头 + 掩码布局）、`desktop.js` 用 PowerShell 调 SendInput 走菜单点击；画布补边（读 .sai2 头 magic `SAI-CANVAS-TYPE0` 取精确尺寸） | `core/clipboard.js` `core/desktop.js` |
| T7.8  | 装配：工具栏「打开 FX Studio」、右键 .sai2「用 FX Studio 处理」、启动 SAI2 时可选自动注入；浮窗 ↔ 核心引擎消息桥                                                              | 端到端串通                                 |
| T7.9  | 验证：typecheck/test/build 全绿；用她仓库的 FakeHost/selftest 思路做算法与协议单测；本机 SAI2 做真机抓图/回贴/注入实测                                                       | 测试记录                                  |
| T7.10 | 打包独立 zip，上传为 Release 附件（不改主程序包）；文档版本递增                                                                                                   | 可下载插件包                                |

---

## 五、来源与魔改声明（你要求的重点）

`THIRD-PARTY-NOTICES.md` 将逐项列明：

1. **上游**：PainterAnkry/sai2-plugin-suite，MIT License，附 `LICENSE-UPSTREAM` 原文与版权行；  
   注明本插件经小红书用户分享的 fork 了解到该项目。
2. **逐层魔改清单**：
   - UI 层：**完全重写**（Win32 GDI 自绘 → HTML/CSS 玻璃质感），未使用 her `Ui.cpp` 的任何绘制代码；
   - 核心引擎：**完全重写**（C++ `BridgeCore` → JS，会话/撤销/预览/流程自行实现），未使用她的 C++ 核心代码；
   - 算法层：**移植**（C++ 头文件 kernel 的算法逻辑 → JS 实现），列出每个算法的来源文件；
   - 注入层：**未修改**，由用户自行下载她的 `sai2_agent.dll` / `sai2_injector.exe`，我们不分发、不声明所有权；
   - 协议：沿用她公开的命名管道 JSON 协议（`docs/SAI2Injection.md`），注明协议出处。
3. **商标与背书**：明确声明非官方、与上游作者及小红书用户无关联、不提供担保。
4. 插件 README 首页与面板「关于」页都放这段声明的摘要和链接。

---

## 六、风险与缺口（必须提前讲清）

1. **真机 SAI2 已具备（已按你的批注修正）**：本机有 `C:\Program Files\sai2\sai2.exe`，
   已核实为 **x64**（满足插件的 64 位前提），抓图/回贴/注入**可以做真机端到端验证**。  
   注意：该目录含 `sai2.exe.bak` 与第三方修改补丁，exe 版本与上游测试环境（Preview.2023.04.05）可能不同，
   注入兼容性结果仅供参考；我们只对接现有安装，不参与、不分发任何破解文件。
2. **剪贴板 CF_DIBV5**：她的文档（§八之二）说明 SAI2 只认特定布局，写错会"粘贴背景变黑"。  
   JS + PowerShell 精确复刻这个布局是本计划**最大技术风险**，需要单独攻关与真机验证。
3. **液化性能**：JS 逐笔置换场在 5000×5000 上可能明显卡；对策是降采样预览 + 提交时全分辨率，  
   与她的做法一致，但 JS 绝对速度仍不如 C++。
4. **UI 承载形式：采用独立浮窗（已按你的批注修正）**：v1 插件的 `addPage` 只能在侧栏 iframe 渲染，
   开不了独立窗口。**需要给内核加一个受控的「插件浮窗」能力**（新增一条 IPC + 一个 BrowserWindow 工厂，
   只对声明了该能力的插件开放），这是本计划里唯一的内核改动。  
   该能力通用、可复用，不影响 M1~M4 已定版的行为；浮窗沿用工作台的主题变量与玻璃质感。
5. **注入前提不变**：仍需管理员权限 + 杀软白名单 + 64 位 SAI2，UI 改造解决不了这些。

---

## 七、确认状态

1. ✅ **UI 用独立浮窗**（你已批注）：新增内核受控窗口能力，T7.3a 承担。
2. ✅ **真机 SAI2 可用**（你已批注）：本机 x64 安装，T7.9 做端到端实测。
3. ⏳ **算法层一并 JS 化**（路线 A）：本计划默认采用，若你要保留她的 C++ DLL 请告知（需工具链，不推荐）。
4. ⏳ **她的套件由你自行下载**、插件只填路径：本计划默认采用，若要把二进制打进插件包请告知。

以上两项默认按计划执行；如无异议，我按 T7.1 → T7.10 顺序开始实现。这一轮只改了计划文档，未动代码。
