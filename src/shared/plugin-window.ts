/**
 * 插件浮窗 preload 的初始化参数解析。
 *
 * 主进程通过 loadFile(..., { query: { pluginId } }) 把插件 ID 带进浮窗；
 * 早期版本用过 additionalArguments（--plugin-id=...），这里保留回退读取，
 * 避免旧构建或手工注入的参数失效。
 */
export function readPluginId(search: string, argv: readonly string[] = []): string {
  try {
    const fromQuery = new URLSearchParams(search).get('pluginId')
    if (fromQuery) return fromQuery
  } catch {
    // 非法 search 直接走 argv 回退，不让 preload 初始化失败
  }

  const fromArgv = argv.find((arg) => arg.startsWith('--plugin-id='))
  return fromArgv ? fromArgv.slice('--plugin-id='.length) : ''
}
