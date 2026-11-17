# M1 计划：骨架可跑（三栏窗口 + 三套主题 + 日志页）

> 对应需求：v1.10 · 交付计划 M1
> 状态：**已交付（2026-11-17）** —— 交付说明见 `docs/plans/M1-delivery.md`
> 预计产出：能 `npm run dev` 看到界面的可运行工程

---

## 1. 目标（这个阶段结束时你能做什么）

1. 打开程序，看到一个三栏窗口：左边导航、中间内容区、右边详情面板，中间的竖线可以拖动改宽度。
2. 点导航能切换五个页面：启动 / 文件管理 / 运行日志 / 插件中心 / 设置。
3. 在设置页能切三套主题（浅色 / 深色 / 亚克力透明），**点下去立刻变**，关掉再开还是上次那套。
4. 日志页能看到程序自己吐的日志，能按级别过滤、能暂停、能清空、能弹成独立窗口。
5. 左侧底部有一个蓝色大按钮「启动 SAI2」（本阶段点它只会提示"还没配置路径"，真正的启动在 M3b 接上）。

**一句话**：这一步交付的是「壳」，你能判断观感对不对 —— 毛玻璃、配色、间距、字体、布局比例。看不对现在改，比后面改便宜十倍。

---

## 2. 交付物（会新增哪些文件）

```
package.json                        依赖与脚本（dev / build / typecheck）
electron.vite.config.ts             三端构建配置 + @main/@renderer 别名
tsconfig.json / .node.json / .web.json
.gitignore                          node_modules / dist / data / plugins / out
src/shared/types.ts                 AppConfig / LogEntry / ThemeName
src/shared/channels.ts              IPC 通道常量
src/preload/index.ts                contextBridge 暴露 window.api（仅 config/log/theme 三类）
src/main/index.ts                   入口：单实例锁、启动顺序、注册 IPC
src/main/window.ts                  窗口创建、毛玻璃、尺寸/位置记忆
src/main/paths.ts                   便携路径解析 + 可写探测 + APPDATA 回退
src/main/config.ts                  配置读写（原子写、默认值合并、损坏自愈）
src/main/logger.ts                  滚动文件 + 环形缓冲 + 推送渲染进程
src/main/ipc/config.ipc.ts          配置读写 + 主题变量下发
src/main/ipc/log.ipc.ts             日志历史 + 订阅
src/main/theme.ts                   三套主题变量表（生成 CSS 变量对象）
src/renderer/index.html
src/renderer/main.tsx / App.tsx
src/renderer/styles/base.css        重置 + 布局骨架 + 滚动条
src/renderer/styles/glass.css       毛玻璃层与降级
src/renderer/store/ui.ts            当前页 / 主题 / 分栏宽度 / 选中项
src/renderer/components/Sidebar.tsx
src/renderer/components/TitleBar.tsx        自定义标题栏（可拖拽区 + 窗口按钮）
src/renderer/components/DetailsPanel.tsx    本阶段只有空态文案
src/renderer/components/StatusBar.tsx
src/renderer/pages/LaunchPage.tsx           占位：启动按钮 + 状态
src/renderer/pages/FilesPage.tsx            占位：空网格 + 「还没添加监听目录」
src/renderer/pages/LogPage.tsx              真实日志流 + 过滤/暂停/清空/弹窗
src/renderer/pages/PluginPage.tsx           占位：空列表 + 说明
src/renderer/pages/SettingsPage.tsx         主题/透明度/缩略图大小三项可用，其余占位
docs/plans/M1-plan.md                       本文件
```

---

## 3. 任务分解

| 编号 | 任务 | 主要文件 | 验收方式 |
|---|---|---|---|
| **T1.0** | 环境准备：`npm i` 装依赖；Electron 二进制下载若中断，切 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重试 | `package.json` | `npx electron -v` 打印版本 |
| **T1.1** | 脚手架：electron-vite + React + TS，三端能各自编译，`npm run dev` 出空白窗口 | 配置四个文件 + `main/index.ts` + `renderer/main.tsx` | 窗口打开，控制台无报错 |
| **T1.2** | `paths` / `config` / `logger` 三件套 | 三个 ts 文件 | 首次启动生成 `data/config.json`；手改配置能读回；把 json 改坏后启动不崩、自动备份重建；日志文件按天生成 |
| **T1.3** | 窗口：无边框自定义标题栏、`backgroundMaterial:'acrylic'` 实测、失败转 CSS `backdrop-filter`、再失败降级纯色 | `window.ts` / `TitleBar.tsx` / `glass.css` | 窗口能拖动、能最大化、能关闭；毛玻璃效果截图确认；Win10 场景手动模拟（关掉材质开关）不崩 |
| **T1.4** | 三栏布局 + 分栏拖拽 + 宽度持久化 + 五页路由 + 状态栏 | `App.tsx` / `Sidebar.tsx` / `store/ui.ts` | 拖动分隔条；重启后宽度不变；点五个页面都正常 |
| **T1.5** | 主题系统：CSS 变量注入 + 三套变量表 + 亚克力透明度滑块。**亚克力为默认主题**，按开发文档 §3.1 三条硬指标做（对比度 ≥4.5:1、卡片不透明底、模糊不进滚动区） | `theme.ts` / `config.ipc.ts` / `SettingsPage.tsx` / `themes.css` | 三套来回切十次无闪烁无残留；透明度 30%~95% 即时生效；默认启动是亚克力；Win10 降级路径不崩 |
| **T1.6** | 日志页：订阅实时日志、级别过滤、关键字过滤、暂停、清空、打开日志文件、弹出独立窗口 | `LogPage.tsx` / `log.ipc.ts` | 触发 error 立刻出现在列表并标红；暂停后新日志不插队；弹窗关闭后主窗口日志仍继续 |
| **T1.7** | 自测（第 10 章清单里本阶段相关项）+ 指标初测（启动耗时/内存）+ 写交付说明 | — | 截图 + 数字一起给你 |

执行顺序：T1.0 → T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6 → T1.7。T1.3 的结论会影响 T1.5（亚克力主题怎么做），所以先做。

---

## 4. 本阶段明确不做

| 不做 | 原因 / 何时做 |
|---|---|
| 监听文件夹、索引文件 | M2a |
| 缩略图（含 sai2 解码） | M2a（解码算法已经在 `tools/jssf_probe.py` 验证过，M2a 直接移植） |
| 详情面板的真实内容 | M2b（本阶段只有空态） |
| 标签、搜索、文件操作 | M2b |
| 插件加载与管理 | M3a（插件页只有空列表） |
| 启动 SAI2 / 联动软件 | M3b（按钮先占位，点击给引导文案） |
| 设置页除主题外的一切 | M3/M4 |
| 打包 exe | M4 |
| 快捷键（除 Ctrl+F 外） | M2b |

---

## 5. 风险与未知

| # | 风险 | 影响 | 处理方式 |
|---|---|---|---|
| R1 | **毛玻璃做不出来** | 你的核心视觉要求落空 | 三级降级：`backgroundMaterial:'acrylic'`（系统级）→ `transparent + CSS backdrop-filter`（自绘）→ 纯色。T1.3 当天出结论，**先给你截图再继续**，不会闷头做完才发现不对 |
| R2 | Electron 二进制下载中断 | 整个工程装不起来 | 已实测 npm registry 与两个下载源都可达；失败则切 npmmirror 镜像 + 手动指定本地缓存 |
| R3 | 我看不到渲染结果 | 观感只能靠描述，容易偏差 | 交付时我会自动截图（DevTools 协议 `capturePage`）；截不到就明确请你截图给我 |
| R4 | 亚克力是默认主题，一旦做砸影响第一印象 | 用户日常就看到它，不是"可选特效" | 按 §3.1 三条硬指标验收：对比度 4.5:1 实测、卡片区不透明底兜住偏色、模糊层不放在滚动容器里。T1.5 出三套主题的对比截图给你挑 |
| R5 | 自定义标题栏导致窗口拖不动 / 双击不最大化 | 基础体验坏了 | 标题栏设 `-webkit-app-region: drag`，按钮区设 `no-drag`；自测里专门测这两条 |
| R6 | 内存基线偏高 | 后期 480MB 上限吃紧 | T1.7 先测一次空壳内存，超 300MB 就调整（关 hardware acceleration 的某些特性 / 减少透明层） |
| R7 | 无边框 + 透明窗口在部分显卡驱动下闪黑边 | 观感瑕疵 | 记录到已知问题，提供设置项「关闭透明效果」作为逃生门 |

---

## 6. 确认结果（2026-11-17）

| 项 | 结论 |
|---|---|
| 计划本身 | **通过**，按 T1.0 → T1.7 顺序执行，中途不扩大范围 |
| 验收方式 | 我截图 → 你指出「配色/间距/圆角」问题 → 我改，来回 2~3 轮属正常 |
| 亚克力定位 | **升为默认主主题**（需求 v1.10），按主主题标准打磨 |
| SaiThumbs | **只提供下载链接**，安装/卸载命令与安装脚本已移除 |

---

**开工顺序**：T1.0 → T1.7。T1.3（毛玻璃）与 T1.6（日志页）各给一次截图，其余合并交付。
