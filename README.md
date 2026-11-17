# sai2工作台

把电脑里的 SAI2 / PSD / 图片工程集中管起来的免安装浏览器与启动台。双击就能用，不写注册表，不联网，拷走整个文件夹就能换电脑。

## 一、开始使用

### 解压即用

1. 下载 `sai2工作台-0.1.0-win-x64.zip`，解压到任意文件夹（例如 `D:\sai2工作台\`）。
2. 双击文件夹里的 `sai2工作台.exe`。首次启动会在 exe 同级建 `data\` 和 `plugins\` 两个文件夹。
3. 不需要安装、不需要管理员权限。

> **数据放哪**：默认就放在 exe 同级的 `data\`（便携模式），整个文件夹拷走数据跟着走。如果程序放在 `C:\Program Files` 这类不可写的位置，数据会自动改放到 `%APPDATA%\sai2-workbench\`，设置页「运行环境」会如实显示当前用的是哪种。内置插件始终随程序自带，不受这个切换影响。

### 三步上手

1. **加监听目录**：设置 → 监听目录 → 添加你的稿件文件夹。默认只在启动时扫一次，之后到文件页点「刷新」重新扫描。
2. **填画图程序路径**：设置 → 画图程序路径，给 SAI2 / PS / CSP 填上 exe 路径（有「自动查找」），并选一个默认打开器。
3. **开始找图**：文件页用关键词、类型、时间、项目、标签筛选；双击卡片用默认程序打开，右键有更多操作。

缩略图无需任何额外配置：SAI2 的自带预览、PSD、png/jpg 都是内置解析，不依赖 SaiThumbs 之类的系统扩展。

## 二、功能一览

- **看图**：真缩略图（SAI2 / PSD / 图片）、瀑布流、缩略图缓存；坏文件显示信息卡，不白屏。
- **找图**：关键词（文件名/目录，空格多词 AND）、类型、修改时间、项目、标签、排序组合筛选。
- **组织**：给文件打标签、归到项目（带客户字段），目录自动映射标签；改名不丢标签。
- **启动**：一个按钮拉起画图程序，可按配置连带启动参考图/录屏软件；默认打开器可切 SAI2 / PS / CSP。
- **外观**：玻璃 / 简约两套主题、明暗与背景（含自定义图片与背景清晰度）。
- **插件**：插件中心可装卸，配置表单自动生成，内置插件即示例。

## 三、插件开发

> **SAI2 FX Studio 已独立成单独项目**：`C:\Users\11421\Documents\sai2-fx-studio\`，有自己的源码、文档、构建与发版。本工作台只维护插件 API 与插件中心，不再承载任何具体插件的细节。

插件是一段本地可信代码，主进程直接加载（**安装即授权**，无进程级沙箱——只装你信任的插件）。

### 最小结构

```
plugins/<你的插件>/
├─ plugin.json     # 清单
└─ index.js        # 入口，CommonJS
```

`plugin.json` 示例（`configSchema` 写在入口 `index.js` 里，不是清单里）：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "一句话说明",
  "entry": "index.js",
  "system": false,
  "permissions": ["写插件自身数据目录"]
}
```

`index.js` 示例（`apply` 的第二个参数就是这份插件的配置）：

```js
module.exports = {
  // 配置表单自动生成：key 即配置字段
  configSchema: {
    greeting: { type: 'string', label: '问候语', default: '你好' }
  },

  apply(ctx, config) {
    ctx.log.info(String(config.greeting) + '，插件已加载')
    // 右键菜单贡献一项，只对图片显示
    ctx.addFileAction({
      id: 'demo',
      label: '示例：看看这个文件',
      exts: ['.png', '.jpg', '.psd', '.sai2'],
      run(payload) { ctx.log.info('选中：' + String(payload || '')) }
    })
    // 插件停用时清理定时器/监听
    ctx.effect(() => { /* 清理逻辑 */ })
  }
}
```

配置字段类型支持 `string` / `bool` / `int` / `float` / `enum` / `path` / `list` 七种。完整可运行示例见随程序附带的 `hello-world` 插件。

### 能扩展的地方

右键菜单动作、工具栏动作、侧栏页面（交一段 HTML 用隔离 iframe 渲染）、主题 CSS 变量、事件订阅、状态栏提示、打开器与缩略图提供者。完整示例见随程序附带的 `hello-world`、`theme-demo`、`opener-*` 等内置插件源码（位于 `resources/builtin-plugins\`）。

开发模式下改 `index.js` 后会自动热重载，不用重启。

## 四、常见问题

- **双击 exe 没反应 / 被杀毒拦截**：本程序是 Electron 应用，未做代码签名，部分杀软可能误报；添加信任即可。发布者信息见 THIRD-PARTY-NOTICES。
- **某个文件不出缩略图**：损坏或版本异常的 SAI2 文件会降级到同名 png 封面 → 手动封面 → 信息卡，属正常兜底。
- **想换电脑用**：关掉程序，把整个文件夹（含 `data\` 与 `plugins\`）拷走即可。

## 五、许可

本项目 MIT 许可证，见 `LICENSE`。第三方组件与参考算法声明见 `THIRD-PARTY-NOTICES`。
