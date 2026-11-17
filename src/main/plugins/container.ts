/**
 * 插件服务容器与依赖图工具。
 * 纯 TS、零 Electron 依赖 —— 这样单测能直接跑，不用起一个 Electron 进程。
 */

/** ctx.get 取不到服务时抛这个；加载器据此把插件标成「等待依赖」 */
export class MissingServiceError extends Error {
  readonly serviceName: string

  constructor(serviceName: string) {
    super(`缺少服务 ${serviceName}`)
    this.name = 'MissingServiceError'
    this.serviceName = serviceName
  }
}

/** 插件用 ctx.effect 注册的清理函数，卸载时逆序执行 */
export type DisposeEffect = () => void | Promise<void>

/**
 * 服务容器。
 *
 * 同名服务允许重复注册（缩略图提供者就是一对多），`getAll` 按注册顺序返回全部，
 * `get` 取最后一个注册者 —— 所以后装的实现会覆盖先装的实现。
 */
export class ServiceContainer {
  private readonly services = new Map<string, unknown[]>()
  private readonly effects = new Map<string, DisposeEffect[]>()

  provide<T>(name: string, service: T): void {
    const list = this.services.get(name)
    if (list) list.push(service)
    else this.services.set(name, [service])
  }

  get<T>(name: string): T {
    const list = this.services.get(name)
    if (!list || list.length === 0) throw new MissingServiceError(name)
    return list[list.length - 1] as T
  }

  getAll<T>(name: string): T[] {
    return [...(this.services.get(name) ?? [])] as T[]
  }

  has(name: string): boolean {
    return (this.services.get(name)?.length ?? 0) > 0
  }

  /** 注册一个清理函数，归属 scopeId（通常是插件 id） */
  effect(scopeId: string, fn: DisposeEffect): void {
    const list = this.effects.get(scopeId)
    if (list) list.push(fn)
    else this.effects.set(scopeId, [fn])
  }

  /**
   * 逆序执行某个 scope 的全部清理函数。
   * 单个 effect 抛错不阻断后续 —— 否则一个写坏的插件会让后面几个卸不干净。
   * 返回执行过程中收集到的错误，调用方负责写日志。
   */
  async disposeScope(scopeId: string): Promise<Error[]> {
    const list = this.effects.get(scopeId) ?? []
    this.effects.delete(scopeId)
    const errors: Error[] = []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      try {
        await list[i]!()
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }
    return errors
  }

  /** 该 scope 是否还有未执行的清理函数（测试与调试用） */
  hasScope(scopeId: string): boolean {
    return (this.effects.get(scopeId)?.length ?? 0) > 0
  }
}

export interface GraphNode {
  id: string
  /** 依赖的节点 id；指向不存在的 id 表示「等待外部服务」，不算环 */
  dependencies: string[]
}

export interface TopoResult<T extends GraphNode> {
  /** 可以按序激活的节点 */
  ordered: T[]
  /** 参与环的节点，加载器要把它们全部标 failed */
  cyclic: T[]
  /** 每条环的 id 路径，首尾同一个 id，如 ['a', 'b', 'a'] */
  cyclePaths: string[][]
}

/**
 * Kahn 拓扑排序。同层节点保持清单里的原顺序，保证插件启用顺序可预测。
 * 指向不存在节点的依赖被忽略（那是「等待服务」，由加载器单独判断）。
 */
export function topologicalSort<T extends GraphNode>(nodes: T[]): TopoResult<T> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const node of nodes) {
    const deps = [...new Set(node.dependencies.filter((d) => d !== node.id && byId.has(d)))]
    indegree.set(node.id, deps.length)
    for (const dep of deps) {
      const list = dependents.get(dep)
      if (list) list.push(node.id)
      else dependents.set(dep, [node.id])
    }
  }

  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const ordered: T[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(byId.get(id)!)
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  const cyclic = nodes.filter((n) => (indegree.get(n.id) ?? 0) > 0)
  return {
    ordered,
    cyclic,
    cyclePaths: cyclic.length > 0 ? findCycles(cyclic, byId) : []
  }
}

/** 在剩余子图上找一条具体的环路径，用于生成「循环依赖：a → b → a」 */
function findCycles<T extends GraphNode>(
  cyclic: T[],
  byId: Map<string, T>
): string[][] {
  const inCycle = new Set(cyclic.map((n) => n.id))
  const paths: string[][] = []
  const seen = new Set<string>()

  for (const start of cyclic) {
    const path: string[] = []
    const onPath = new Set<string>()
    let current: string | undefined = start.id

    while (current && inCycle.has(current)) {
      if (onPath.has(current)) {
        path.push(current)
        const signature = [...path].sort().join('|')
        if (!seen.has(signature)) {
          seen.add(signature)
          paths.push(path)
        }
        break
      }
      onPath.add(current)
      path.push(current)
      const node = byId.get(current)
      current = node?.dependencies.find((d) => inCycle.has(d))
    }
  }
  return paths
}
