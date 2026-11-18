/**
 * IPC 通道常量。主进程与渲染进程共用一份，避免字符串手写出错。
 * 命名规则：域:动作。invoke=有返回，event=主进程单向推送。
 */
export const CH = {
  /** 运行环境信息（数据目录、是否支持毛玻璃等） */
  appRuntime: 'app:runtime',
  /** 窗口控制：最小化 / 最大化切换 / 关闭 / 悬浮窗 / 托盘 */
  appWindow: 'app:window',
  /** 主窗口进入 / 退出悬浮模式（主进程 → 渲染端） */
  windowFloatChanged: 'window:float-changed',
  /** 渲染端首次拉取悬浮状态（插件可能在页面加载前就切了模式） */
  appFloatState: 'app:float-state',
  /** 选一张本地图片作为窗口背景（先落到临时文件，等取景确认） */
  appPickBackground: 'app:pick-background',
  /** 按取景框内的区域裁出新背景（渲染端出 PNG 字节 → bg-*.png） */
  appApplyBackground: 'app:apply-background',
  /** 把临时图读成字节给取景框（自定义协议加载的图会污染 canvas，不能导出） */
  appReadBackground: 'app:read-background',
  /** 取消取景，删掉临时文件 */
  appCancelBackground: 'app:cancel-background',
  /** 清除自定义背景图（删文件 + 清配置由渲染端做） */
  appClearBackground: 'app:clear-background',
  /** 启动默认打开器（带 file 时用扩展名匹配的打开器） */
  appLaunch: 'app:launch',
  /** 当前所有打开器的状态（路径、是否可用、是否默认） */
  appOpeners: 'app:openers',
  /** 用指定打开器打开指定文件 */
  appOpenWith: 'app:open-with',
  /** 系统选择框：选可执行文件 / 目录 / 任意文件 */
  appPickFile: 'app:pick-file',

  /** 当前主题变量表（插件贡献 + 内核默认） */
  themeGet: 'theme:get',
  /** 主题变量变化推送（主进程 → 渲染端） */
  themeChanged: 'theme:changed',

  configGet: 'config:get',
  configSet: 'config:set',
  configChanged: 'config:changed',

  logHistory: 'log:history',
  logAppend: 'log:append',
  logClear: 'log:clear',
  logOpenFile: 'log:open-file',

  /** 文件列表查询（分页 + 可选目录/关键词过滤） */
  filesList: 'files:list',
  /** 变更推送（主进程 → 渲染端，已按 120ms 合并） */
  filesChanged: 'files:changed',
  /** 扫描进度推送 */
  filesProgress: 'files:progress',
  /** 添加监听目录（弹系统目录选择框，可多选） */
  filesAddDir: 'files:add-dir',
  /** 移除监听目录 */
  filesRemoveDir: 'files:remove-dir',
  /** 手动重扫（清索引重来，不动缓存文件） */
  filesRescan: 'files:rescan',
  /** 在资源管理器里定位文件 */
  filesReveal: 'files:reveal',
  /** 整体替换某个文件的标签集合（标签按名字传，主进程负责建不存在的） */
  filesSetTags: 'files:set-tags',
  /** 设置某个文件归属的项目（null = 未归类） */
  filesSetProject: 'files:set-project',
  /** 某个文件的标签 / 项目变了（主进程 → 渲染端，只更新那张卡） */
  filesMetaChanged: 'files:meta-changed',

  /** 标签池 */
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsRename: 'tags:rename',
  tagsDelete: 'tags:delete',
  /** 项目池 */
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsDelete: 'projects:delete',
  /** 自动标签规则（列出 / 新增 / 删除，用 action 区分） */
  metaRules: 'meta:rules',

  /** 缩略图缓存统计 */
  thumbsStats: 'thumbs:stats',
  /** 清空缩略图缓存 */
  thumbsClear: 'thumbs:clear',

  /** 插件清单（含状态与配置 schema） */
  pluginList: 'plugin:list',
  /** 从文件夹或 zip 安装插件，payload = { mode: 'folder' | 'zip' } */
  pluginInstall: 'plugin:install',
  /** 卸载用户插件 */
  pluginUninstall: 'plugin:uninstall',
  /** 启用 / 禁用插件 */
  pluginSetEnabled: 'plugin:set-enabled',
  /** 清缓存重新加载插件（开发时用） */
  pluginReload: 'plugin:reload',
  /** 读 / 写某个插件的配置 */
  pluginGetConfig: 'plugin:get-config',
  pluginSetConfig: 'plugin:set-config',
  /** 打开固定插件目录（无入参，主进程锁死为 pluginDir） */
  pluginOpenDir: 'plugin:open-dir',
  /** 按给定 zip 路径安装（校验后在 pluginDir 内，复用 zip 安装核心） */
  pluginInstallZipPath: 'plugin:install-zip-path',
  /** 发现新 zip 安装包（主进程 → 渲染端，payload = zip 绝对路径数组） */
  pluginZipFound: 'plugin:zip-found',
  /** 插件状态或贡献点变化（主进程 → 渲染端） */
  pluginChanged: 'plugin:changed',
  /** 触发插件注册的菜单 / 工具栏动作 */
  pluginRunAction: 'plugin:run-action',
  /** 插件浮窗 → 插件的消息（payload = { pluginId, message }） */
  pluginWindowMessage: 'plugin:window-message'
} as const

export type ChannelKey = keyof typeof CH
