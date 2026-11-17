# SAI2 FX Studio · 交付说明（T7.1~T7.10）

> 需求：把她那套 MIT 插件的 UI 与核心换成我们自己的，做成**独立分发的非官方插件**，
> 不进工作台发布包，完整声明来源与魔改。计划见 `sai2-fx-studio-plan.md`。

## 一、交付物

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 独立插件源码 | `contrib/sai2-fx-studio/` | 不在工作台主程序包内 |
| 可安装插件 zip | `dist/sai2-fx-studio-0.1.0.zip`（3.05 MB，含上游套件） | 用户在插件中心「从 zip 安装」，安装即用 |
| 内核浮窗能力 | `src/main/plugins/windows.ts`、`window-factory.ts`、`src/preload/plugin-window.ts` | 通用、受控，仅声明 `capabilities:['window']` 的插件可用 |
| GitHub Release 附件 | `v0.1.0`：`sai2-workbench-0.1.0-win-x64.zip`（修复版）+ `sai2-fx-studio-0.1.0.zip` + `sai2-workbench-0.1.0-patch-win.zip`（增量升级包） | 已上传并回读确认 |
| 增量升级包 | `dist/sai2工作台-0.1.0-增量升级包.zip`（2.4 MB） | 只含 `resources/app.asar` + 说明 + 校验值，旧 exe 无需替换（实测通过）；适用于从上一修复版升级到「右键菜单修复版」 |

## 二、分层实现（对照计划）

| 层 | 实现 | 文件 |
| --- | --- | --- |
| ① UI | HTML/CSS 玻璃浮窗，四功能页 + 图层列表 + 参数控件 + 预览 canvas | `ui/panel.html` |
| ② 核心引擎 | RGBA8 图像模型、会话/参数/降采样预览/撤销栈、流程编排 | `core/image.js`、`core/session.js`、`index.js` |
| ③ 算法 | blur(4)/adjust(5)/filters(10)/liquify(置换场) 全部 JS 移植 | `algorithms/*.js` |
| ④ 注入层 | **未修改、原样随包分发**（`vendor/sai2-plugin-suite/`，v1.64.0 Celery MIT fork），默认自动注入；插件经命名管道对接 | `core/agent.js`（协议）+ `core/desktop.js`（注入器启动 / 提权白名单） |
| 剪贴板 | CF_DIBV5 精确编解码（124 头 + 12 掩码 + BGRA，只写 CF_DIBV5） | `core/clipboard.js`、`core/clipboard-win.js` |
| 桌面自动化 | SendInput 合成 Ctrl+A/C/V、屏幕坐标点击、SAI2 窗口聚焦 | `core/desktop.js` |

## 三、来源与声明（用户明确要求）

- `LICENSE-UPSTREAM`：PainterAnkry/sai2-plugin-suite 的 MIT 全文（Copyright (c) 2026 PainterAnkry）
- `THIRD-PARTY-NOTICES.md`：逐层魔改清单（UI 完全重写 / 核心完全重写 / 算法移植 / 注入层未修改 / 协议沿用），
  算法文件与上游来源文件一一对照，明确非官方、无背书、风险自负
- `README.md`：首页即声明非官方与备份提醒；插件面板「关于」页也放摘要

## 四、验证记录

- **typecheck**：`npm run typecheck` 通过（0 错误）
- **单测**：91 条全绿（13 个测试文件），其中本插件相关 66 条：
  - `plugin-windows.test.ts` 7 条（浮窗注册表、路径越界、消息路由、关闭清理）
  - `plugin-window-init.test.ts` 5 条（preload 从 query / argv 解析 pluginId）
  - `fx-agent.test.ts` 7 条（管道协议、重试、图层解析、菜单推送）
  - `fx-core.test.ts` 8 条（图像模型、PNG 无关、会话/撤销、SAI2 头解析）
  - `fx-algorithms.test.ts` 11 条 + `fx-filters-liquify.test.ts` 10 条（全部算法）
  - `fx-clipboard-desktop.test.ts` 11 条（DIBV5 往返、只写 CF_DIBV5、SendInput 映射、提权白名单）
  - `fx-plugin.test.ts` 7 条（清单、configSchema、随包套件、贡献点、浮窗打开、消息路由）
  - 注：当前环境的默认 worker 池会让 Vitest 5 丢失 runner 上下文，`vitest.config.mts`
    固定为 `pool: 'vmThreads'` 后全部通过。
- **build**：`npm run build` 通过，`out/preload/plugin-window.js` 正常产出
- **真机 Electron**（本机 SAI2 x64 环境）：
  - 插件被发现并 `running`，日志 `sai2-fx-studio 已加载/已启用`
  - EVAL 回读：`found:true, status:running, toolbar:[...,"fx-open"], fileActions:2`
  - 触发 `fx-open` 动作：浮窗成功创建并加载页面，日志 `浮窗页面已加载：sai2-fx-studio`
  - 通过 CDP 读浮窗确认 `pluginBridge.pluginId === 'sai2-fx-studio'`；从浮窗发
    `{type:'undo'}` 后收到插件回包 `{type:'status', text:'没有可撤销的操作'}`，
    UI → 插件 → UI 双向消息路由已打通。
  - 随包套件版再次真机回读：`status:"running"`，日志 `sai2-fx-studio 已加载/已启用`
- **插件 zip**：45 个条目（含 `vendor/sai2-plugin-suite/` 上游套件），顶层单目录 `sai2-fx-studio/`（安装器 `findManifestDir` 可识别）
- **随包套件校验**：下载 zip 的 SHA-256 与上游页面一致：`24acd721…25edca5`；关键二进制校验值记录在 `vendor/sai2-plugin-suite/SOURCE.json`

### 踩坑记录（供后续参考）

1. Electron 45 在本机用 `loadFile` 加载**含中文路径**会拼出未编码的 `file:///C:\...` 而 `ERR_FAILED`；
   解法：把自包含 HTML 复制到纯 ASCII 的临时目录再加载。
2. `SAIGUI_EVAL` 触发开窗后其 `.finally(app.quit())` 会在导航完成前关窗，造成"加载失败"假象；
   验证浮窗需用返回永不 resolve 的 Promise 让进程存活。
3. 测试用插件副本放在 `plugins/` 会被热重载监听；验证完需删除，避免与 zip 安装冲突。
4. 早期 preload 从 `process.argv` 读 `pluginId`，但浮窗工厂为排错移除了 `additionalArguments`，
   导致 UI 消息带空 ID 被主进程拒绝；改为 `loadFile(..., { query: { pluginId } })`，
   preload 用共享的 `readPluginId()` 先读 query、再回退 argv，已端到端验证。

## 五、已知限制（与计划一致）

- **画布补边未做**：当前"抓到多大贴多大"，复杂文档可能 1~15px 落位偏差；精确补边需对接 agent 的
  `canvas.arm/state/save` 协议（读 `.sai2` 头取精确画布尺寸），列为后续增强。
- **液化性能**：JS 位移场在大画布明显慢于 C++；预览降采样、提交全分辨率。
- **合成键**：依赖 SAI2 响应 Ctrl+A/C/V（上游 2023.04.05 版实测有效）。
- **本机 SAI2 为修改版**（目录含 `.bak` 与第三方补丁），注入兼容性可能与上游正版环境不同；
  我们只对接现有安装，不参与、不分发任何破解文件。
- 真机"抓图→处理→贴回"的完整闭环需在有正版 SAI2 + 上游注入器的环境由用户实测；
  本交付在算法/协议/剪贴板/桌面自动化各层均已单测覆盖。

## 六、文档版本

需求文档 v1.26 → **v1.27**；开发文档 v1.13 → **v1.14**。
