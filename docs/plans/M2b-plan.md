# M2b 组织与索引 · 开发计划

> 对应需求：**F5 标签 / F4 详情面板 / F21 项目归属 / F9 搜索**（本轮新增 F21、F22）
> 前置条件：M2a 已交付（索引、真缩略图、瀑布流、筛选工具条、手动刷新）
> 决策依据：`docs/plans/M2b-scaling-directions.md` §4（2026-11-17 定稿：5 千量级 / 时间+项目客户+标签 / 接受本地库 / 项目建模取 A / 标签取 A）
> 状态：**已确认并交付**（2026-11-17，实测与偏差见 `M2b-delivery.md`）
> 预估：**9 个工作日**（T3.1~T3.7，不含 P2 的时间视角与智能文件夹）

---

## 1. 目标（做完之后你能做什么）

1. **启动秒开**：5 千份稿件关掉程序再开，卡片在 **1 秒内**出来，不再每次全量 readdir + stat。
2. **给稿子归属项目**：建「春季海报」这类项目，可挂一个客户名；在详情面板给选中稿件指定项目，一个文件只属于一个项目。
3. **打标签**：建标签池（「线稿」「上色中」「已交付」），选中稿件回车即加；筛选条能按标签直接缩到几张。
4. **目录自动带标签**：配一条「`D:\稿件\客户A` → 客户A」，之后丢进这个目录的新稿自动带上该标签，手动改过以手动为准。
5. **改名、移动不丢标签**：在资源管理器里把 `A01.sai2` 改成 `A01-终稿.sai2`、或在同一磁盘里换目录，标签与项目归属跟着走，缩略图也不重新解码。
6. **按「项目 + 标签 + 时间」三件套筛**：筛选条新增两个下拉，与现有的类型 / 目录 / 时间 / 排序自由组合，命中数实时显示。
7. **误移出目录还能找回来**：把稿子暂时移出监听目录，7 天内移回来，标签仍在（不当作新文件）。

---

## 2. 交付物

### 新增（主进程）

| 文件 | 作用 |
|---|---|
| `src/main/db/index.ts` | 数据库生命周期：打开、pragma、`schema_version` 迁移、损坏自愈、优雅关闭 |
| `src/main/db/schema.ts` | DDL（`files` / `projects` / `tags` / `file_tags` / `auto_tag_rules` / `meta`）与索引 |
| `src/main/db/files.ts` | 文件行的批量 upsert、按 `(dev,ino)` 与 path 双路查找、软删除标记、过期清理 |
| `src/main/db/meta.ts` | 标签 / 项目 / 自动规则的 CRUD（纯 SQL 封装，不含业务判断） |
| `src/main/ipc/tags.ipc.ts` | 标签、项目、自动规则的 IPC；文件归属与打标签 |

### 新增（渲染层）

| 文件 | 作用 |
|---|---|
| `src/renderer/components/TagInput.tsx` | 标签输入（回车新增、`×` 删除、下拉补全已有标签） |
| `src/renderer/components/ProjectSelect.tsx` | 项目下拉（含「未归类」；选中项目后显示客户名） |
| `src/renderer/store/meta.ts` | 标签池 / 项目池的前端 store（一次拉取，变更后增量更新） |

### 修改

| 文件 | 改什么 |
|---|---|
| `src/main/files/scanner.ts` | `statFile` 改用 `stat(full, { bigint: true })` 取 `dev` / `ino`，随 `ProjectFile` 带出 |
| `src/main/files/index.ts` | 注入持久化依赖：`upsert` / `drop` 时批量落库；全量扫描改「比对模式」，内容未变不动库；`hydrate()` 从库灌内存 |
| `src/main/thumbs/key.ts` | 缓存键由 `version\|size\|mtime\|path` 改为 `version\|size\|mtime\|dev:ino`（取不到时退回 path） |
| `src/main/index.ts` | 启动顺序：开库 → `hydrate` → 推列表 → 后台 `apply()` 校验；退出时关库（checkpoint） |
| `src/main/ipc/files.ipc.ts` | `files:list` 返回值补 `tags` / `project`；新增 `files:set-tags`、`files:set-project` |
| `src/main/paths.ts` | 新增 `dbFile`（`data/index.db`） |
| `src/shared/types.ts` | `ProjectFile` 补 `dev`/`ino`/`tags`/`project`；新增 `Tag`、`Project`、`AutoTagRule` |
| `src/shared/channels.ts` | 新增 `tags:*`、`projects:*` 通道 |
| `src/preload/index.ts` + `index.d.ts` | 暴露 `meta.*`、`files.setTags`、`files.setProject` |
| `src/renderer/pages/FilesPage.tsx` | 工具条加「项目」「标签」两个下拉；卡片区不变 |
| `src/renderer/store/files.ts` | `FileFilters` 补 `projectId` / `tagId`；过滤逻辑扩展 |
| `src/renderer/components/DetailsPanel.tsx` | 从纯空态改为真详情：大图 + 元信息 + 项目 + 标签 + 在资源管理器定位 |
| `src/renderer/components/FileCard.tsx` | 卡片底部显示最多 2 个标签（超出显示 `+N`） |
| `src/renderer/pages/SettingsPage.tsx` | 新增「自动标签规则」卡片（目录 → 标签 的增删） |
| `package.json` | **无新增依赖**（`node:sqlite` 内置） |

### 产出物

- 可运行程序：5 千份稿件下启动、打标签、改名回归全部可验。
- 自测报告 `docs/plans/M2b-delivery.md`（含 5 千实测数据与截图）。
- `tests/fixtures/make-5000.mjs`：批量生成 5000 个测试文件的脚本（复用现有 sai2/png 复制改名，不占额外空间）。

---

## 3. 技术定稿（这几条决定实现形状，先说明再动手）

### 3.1 数据库用内置 `node:sqlite`（已实测）

| 项 | 结论 |
|---|---|
| 运行时 | Electron 45.3.3 内置 **Node 24.22.3** |
| 可用性 | 实测 `require('node:sqlite')` + `DatabaseSync` 建表/插入/查询**全部 OK**，无需 `--experimental-sqlite` |
| 收益 | 不引 `better-sqlite3`：免原生编译、免 node-gyp、免 electron-rebuild，安装包不涨体积 |
| 降级 | 若 M4 打包后发现 asar 内不可用，退回 `better-sqlite3`（改动集中在 `db/index.ts`，不扩散） |

### 3.2 内存索引保留，数据库只做「持久化 + 身份」

**不改现有架构**：`FilesIndex` 的内存 `Map<path, ProjectFile>` 仍是运行时唯一真相（5 千条约占 2MB，完全可接受），数据库负责两件事：

1. 启动时把行灌回内存（省掉 readdir + stat）。
2. 记住「这个文件是谁」（`dev:ino`），让改名后还能认出它。

这样 M2a 的事件合并、扫描回放、`byThumb` 反查全部不动，改动面收敛在存取两端。

### 3.3 文件身份 = `dev:ino`，path 兜底

```text
扫描到一条 →
  ① 按 (dev, ino) 查：命中 → 认为同一文件被改名/移动，更新 path / dir / name，标签与项目保留
  ② 未命中 → 按 path 查：命中 → 认为跨盘复制或重装（ino 变了），更新 ino，标签保留
  ③ 都没有 → 新增行，走自动标签映射
```

- `ino` 用 `stat(..., { bigint: true })` 取，转字符串存 TEXT —— Node 的 `number` 版 `ino` 在 NTFS 上会丢精度，用它做键会出现"两个不同文件撞同一身份"。
- **`ino === 0` 或 `dev === 0`**（部分网络盘、FAT32、部分移动硬盘）：身份退化为 path，该类目录改名会丢标签，日志记一条 debug，文档标注该限制。
- 标签表按 `files.id`（自增主键）关联，**不是按 path** —— 这是「改名不丢」能成立的根本。

### 3.4 软删除：移出目录不当场清标签

全量扫描结束后，库里这次没扫到的行 → `missing_at = now`，列表不返回，但**不删行**。

- 7 天内移回来：`(dev,ino)` 或 path 命中 → 清空 `missing_at`，标签还在。
- 超过 30 天：后台清理（每次启动最多清一次），真正删行并级联删 `file_tags`。
- 收益：移动硬盘拔了、目录临时改配置、误拖动，都不会毁掉标签。

### 3.5 缩略图缓存键改用文件身份

```ts
// 之前：改名 = 新键 = 重新解码一次（虽然只要 50ms，但 5 千张批量改名就是 4 分钟）
thumbKey(version, size, mtime, path)
// 之后：改名/同盘移动，键不变，直接命中磁盘缓存
thumbKey(version, size, mtime, `${dev}:${ino}`)
```

`cache.thumbVersion` 语义不变（改解码逻辑时 +1 全量失效）。取不到身份时才退回 path。

### 3.6 过滤仍在渲染端

5 千条全量 JSON 约 1.5MB（加标签后约 1.8MB），本地 filter 约 2ms。P1 不做 SQL 查询下推、不做分页窗口 —— 与方向文档的结论一致，避免为不存在的量级付复杂度。

---

## 4. 任务分解

顺序即依赖顺序，每完成一项都给你可运行状态。

### T3.1 数据库层（1.5 天）

- `db/schema.ts` 建表（`pragma user_version = 1` 记录版本）：

```sql
create table files (
  id integer primary key,
  path text not null unique,
  dir text not null, name text not null, ext text not null,
  size integer not null, mtime integer not null,
  dev text, ino text,
  width integer, height integer,
  thumb_key text,
  project_id integer references projects(id) on delete set null,
  first_seen integer not null, last_seen integer not null,
  missing_at integer
);
create index files_ident on files(dev, ino);
create index files_mtime on files(mtime desc);
create table projects (id integer primary key, name text not null unique,
  client text not null default '', color text, archived integer not null default 0);
create table tags (id integer primary key, name text not null unique, color text);
create table file_tags (
  file_id integer not null references files(id) on delete cascade,
  tag_id  integer not null references tags(id)  on delete cascade,
  source  text not null default 'manual',   -- 'manual' | 'auto'
  primary key (file_id, tag_id)
);
create table auto_tag_rules (prefix text primary key, tag_id integer not null references tags(id) on delete cascade);
```

- `db/index.ts`：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`；启动 `quick_check`（5 千行 <20ms），失败则把 `index.db` 改名 `index.db.broken-<ts>` 重建并 warn 一条。
- 语句缓存：`prepare` 结果按 SQL 文本缓存（同一批插入复用，避免每行编译）。
- 批量事务：`upsertBatch` 每 200 行一次 `BEGIN/COMMIT`，单行不各自提交。
- `app.on('will-quit')` 里 `close()`（WAL checkpoint），否则留下 `-wal` / `-shm`。

**验收**
- 空库插入 5000 行 ≤ 400ms；全表读出（含 tags join）≤ 120ms。
- `kill -9` 进程后重开：数据完整，无 `database is locked`。
- 把 `index.db` 用文本编辑器改成垃圾：启动自动备份 + 重建，界面照常，日志 1 条 warn。
- `data/` 里只多 `index.db`（`-wal`/`-shm` 退出后消失）。

### T3.2 文件身份与改名追踪（1 天）

- `scanner.ts`：`statFile` 返回 `{ size, mtimeMs, dev, ino }`（BigInt 转字符串）；`ProjectFile` 补 `dev`/`ino`。
- `db/files.ts` 实现 §3.3 的三步匹配，`upsertBatch` 返回 `{ id, path, renamedFrom? }`。
- 改名后要**沿用旧行的 id 与元数据**，不能"删旧行 + 插新行"（后者会级联删掉 `file_tags`）。
- 全量扫描结束：`files` 表中本次 `last_seen` 未更新的行 → `missing_at`；已被更新的清空 `missing_at`。

**验收**
- 同一目录改名（`A01.sai2` → `A01-终稿.sai2`）：标签、项目、缩略图（不重新解码，看缓存 mtime 未变）全部保留。
- 同盘移动到另一个子目录：同上。
- 跨盘复制（`dev` 变）：走 path 匹配失败 → 新行，标签不跟（预期行为，移动硬盘场景说明在文档里）。
- 移出监听目录 5 分钟再移回：标签仍在（`missing_at` 未过期）。
- `ino` 为 0 的模拟（把一个目录配到不支持 ino 的路径）：退回 path 匹配，不崩、不重复插行。

### T3.3 索引落盘接线（1.5 天）

- `FilesIndexDeps` 增加 `store`（DB 门面）：`upsertBatch` / `removeMissing` / `listAll`。
- `upsert()` 不再直接写库（逐条写会打爆 IO），改为进 `pendingPersist` 队列，由 120ms 定时器刷一次（与 IPC 合并节奏一致）。
- 新增 `hydrate()`：`store.listAll()` → 填 `files` / `byThumb` → `onChange({ reset, adds })`。
- `main/index.ts` 启动顺序改为：

```text
openDb → hydrate（同步，≤300ms）→ 窗口 load → 后台 apply()（全量 stat 比对）
                                               ↓
                                   有差异才 upsert / missing，推增量
```

- `apply()` 的全量扫描变成「比对模式」：`size` 与取整 `mtime` 都相同 → 只更新 `last_seen`，**不动 `thumb_key`、不推 upsert**；否则才更新并推。

**验收**
- 5 千条：冷启动到出卡片 ≤ 1s（日志打点 `hydrate 完成 Xms` + 首帧）。
- 二次启动：日志出现 `比对完成：5124 条，变更 3 条`，缩略图零重写（对比 `cache/thumbs` 目录 mtime）。
- 启动后立刻点刷新：不重复写库（`upsertBatch` 调用 0 次）。
- 在 SAI2 里覆盖保存一张稿：`mtime` 变 → 该行更新 + 缩略图重新生成（缓存键含 mtime）。

### T3.4 标签 / 项目 / 自动映射（1.5 天）

- `db/meta.ts`：CRUD + 约束（标签名去重、项目名去重、删标签级联清 `file_tags`、删项目把 `project_id` 置 null）。
- `ipc/tags.ipc.ts`：
  - `tags:list` / `tags:create` / `tags:rename` / `tags:delete`
  - `projects:list` / `projects:create` / `projects:update` / `projects:delete`
  - `files:set-tags`（整体替换该文件的标签集合，`source` 由调用方给）
  - `files:set-project`
  - `meta:rules`（列出/新增/删除自动标签规则）
- 自动映射：新行入库时按 `auto_tag_rules.prefix` 做**最长前缀匹配**（`dir` 小写后 `startsWith`），命中的写 `source='auto'`。
- `files:list` 返回的 `ProjectFile` 补：

```ts
tags?: Array<{ id: number; name: string; color?: string }>
project?: { id: number; name: string; client?: string }
```

- 变更后广播 `files:meta-changed`（`{ path }`），渲染端只更新那一张卡片的标签，不重排瀑布流。

**验收**
- 建 3 个标签、2 个项目：重启程序后仍在（配置与索引分开，标签不随 `thumbVersion` 清缓存丢失）。
- 给一张稿打 3 个标签：卡片与详情面板都更新，滚动位置不动。
- 删掉一个项目：归属该项目的文件变「未归类」，文件本身不动。
- 配规则 `D:\稿件\客户A → 客户A`，丢入新稿：自动带标签，卡片上有标记；手动改后自动记录被手动覆盖，不再回弹。
- 删标签：`file_tags` 里对应行级联消失，无孤儿行（`select count(*) from file_tags where tag_id not in (select id from tags)` = 0）。

### T3.5 详情面板（1.5 天）

- 选中文件后展示：大图（`sai2img://thumb/<key>`，512 已够 264px 宽面板）、文件名、后缀、画布尺寸、大小、修改时间、完整路径。
- 操作区：**项目下拉**（含「未归类」）、**客户**（随项目带出，只读）、**标签输入**（回车加、`×` 删、下拉补全已有标签）、「在资源管理器中定位」。
- 未选中时保留现有空态与运行环境卡片。
- 面板宽度固定（`ui.splitterRight`），标签多时换行不撑高整栏。

**验收**
- 点卡片 → 大图与信息 200ms 内出现（缩略图已缓存时无明显加载感）。
- 打标签 / 改项目 → 立刻落库（重启仍在），卡片角标同步。
- 选中项被筛掉 / 被删除 → 面板回空态，不留幽灵数据。
- 面板在 264px 与 400px 两种宽度下都不溢出、不换行错位。

### T3.6 筛选接入与卡片标签（1 天）

- `FileFilters` 补 `projectId: number | 0`（0 = 全部）、`tagId: number | 0`（0 = 全部），另设 `untagged: boolean` 与「未归类」选项。
- 工具条插入两个下拉，位置在「目录」之后、「修改时间」之前；选项来自 `meta` store。
- 过滤逻辑：`projectId` / `tagId` 命中判断放在现有 `applyFilters` 里，与关键词、类型、时间并列为 AND。
- 卡片底部渲染最多 2 个标签（小 chip，颜色用标签色），超出显示 `+N`；信息卡不显示标签。
- 设置页「自动标签规则」卡片：列出 `目录前缀 → 标签`，可增删（从已选目录里挑前缀，避免手打路径）。

**验收**
- 「项目 = 春季海报 + 标签 = 线稿 + 今年」命中数与 SQL 手查一致（用 `sqlite3` 或日志核对）。
- 标签 chip 在 96px 卡片宽度下不撑破布局（截断成 `…`）。
- 清除筛选后恢复全量，滚动回顶（沿用现有行为）。
- 5 千条下切下拉：列表更新 ≤ 60ms。

### T3.7 自测与 5 千基线（1 天）

`tests/fixtures/make-5000.mjs` 生成 5000 个文件（复制现有 6 个真实文件改名，约 500MB 以内），按 §6 表逐项验，另加回归：

| 场景 | 判据 |
|---|---|
| 冷启动 5000 条 | 出卡片 ≤ 1s；`hydrate` ≤ 300ms |
| 二次启动 | 变更 0 条时缩略图零重写、库零写入 |
| 全量重扫 5000 条 | ≤ 3s，界面可操作 |
| 批量改名 100 个 | 标签 100% 保留、缩略图零重解 |
| 索引损坏 | 自动重建，标签不丢（标签在独立表，重建按 path 回填） |
| 拔移动硬盘 | 1 条 warn，`missing_at` 生效，卡片消失不崩 |
| M2a 回归 | 缩略图三种降级、瀑布流 1000 条零长任务、筛选、刷新、外观四组合 |

**为什么"索引重建不丢标签"要单独验**：重建走的是「删表 → 重新扫」，若标签按 `path` 回填写错，用户会一次性丢掉所有标签 —— 这是本阶段唯一不可接受的数据损失。

---

## 5. 不做的事（本阶段明确不碰）

- **时间视角**（按年月分组、时间轴刻度）、**智能文件夹**、`Ctrl+F`、收藏置顶 → P2。
- **标签多选筛选、父子标签、按文件名猜标签** → 决策已定「不做」。
- **缩略图分级**（128 / 512）、缓存按访问淘汰、worker 过滤 → P3。
- **改名 / 复制 / 移动 / 删除 / 打开器联动** → 独立阶段（涉及磁盘写操作与撤销，单独设计）。
- **搜索下推主进程、分页窗口、文件名倒排** → 5 千不需要（方向文档已论证）。
- 多选批量打标签 → P2（先保证单张操作顺畅）。

---

## 6. 风险与未知

| # | 风险 | 概率 | 降级方案 |
|---|---|---|---|
| 1 | `node:sqlite` 在**打包后**（asar）不可用 | 低（dev 已实测） | 退回 `better-sqlite3`，接口不变；M4 打包阶段必须复验一次 |
| 2 | `ino` 在部分文件系统上为 0 或不稳定 | 中 | 身份退化 path 匹配；该类目录改名会丢标签，设置页日志里说明 |
| 3 | 同步 SQLite 阻塞主进程（批量写） | 中 | 200 行/事务 + 后台执行 + 启动进度提示；实测 5000 行 ≤ 400ms，若超 1s 改 `utilityProcess` |
| 4 | 用户整体搬迁 `data/` 到另一台机器（ino 全变） | 中 | path 匹配兜底，标签不丢；重建后 `dev:ino` 刷新 |
| 5 | WAL 残留 / 断电导致库损坏 | 低 | `synchronous=NORMAL` + 退出 checkpoint + 启动 `quick_check` + 损坏自动备份重建 |
| 6 | 表格结构后续要改（P2 加智能文件夹） | 确定 | `pragma user_version` 版本号 + 迁移函数；只增列不删列 |
| 7 | 标签输入交互做重（下拉补全抢焦点、回车冲突） | 中 | 先做「输入框 + 回车 + ×」，补全下拉用原生 `<datalist>` 保底 |
| 8 | 5 千条 `files:list` JSON 变大（带 tags/project） | 低 | 实测体积；若 >3MB，改为「列表不带 tags，详情面板单查」 |

---

## 7. 需要你先点头的四件事

1. **时间与批次**：按 §4 走 9 天。也可以拆两批先看效果 —— **T3.1~T3.4（后端 5.5 天）** 做完你能用 SQL 验证标签落库，但界面还看不到；**T3.5~T3.7（界面 + 验收 3.5 天）** 才可见。建议一次做完，中间态对你没有价值。
2. **标签筛选先做单选**（一个标签 + 一个项目）。多选留 P2，理由：日常「项目 + 一个标签 + 今年」已经能缩到个位数，多选会让工具条变成一排 chips，反而更慢。
3. **卡片上显示标签**（最多 2 个 + `+N`）要不要？好处是不点开也能看出状态；代价是卡片底部多一行、瀑布流略密。不做的话标签只在详情面板可见。
4. **自动标签规则默认是空的**，需要你在设置页自己配「哪个目录 → 哪个标签」。我不猜你的目录结构；如果你希望「加监听目录时顺手让它成为一条规则」，告诉我，我把它并进添加流程（+0.5 天）。

确认后我从 T3.1 开始，每完成一项给你可运行状态与实测数据。
