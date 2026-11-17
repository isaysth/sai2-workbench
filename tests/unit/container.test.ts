import { describe, expect, it } from 'vitest'
import {
  MissingServiceError,
  ServiceContainer,
  topologicalSort,
  type GraphNode
} from '../../src/main/plugins/container'

describe('ServiceContainer', () => {
  it('清理函数按注册的逆序执行', async () => {
    const c = new ServiceContainer()
    const order: number[] = []
    c.effect('demo', () => void order.push(1))
    c.effect('demo', () => void order.push(2))
    c.effect('demo', () => void order.push(3))
    await c.disposeScope('demo')
    expect(order).toEqual([3, 2, 1])
    expect(c.hasScope('demo')).toBe(false)
  })

  it('单个清理函数抛错不阻断后续', async () => {
    const c = new ServiceContainer()
    const order: number[] = []
    c.effect('demo', () => void order.push(1))
    c.effect('demo', () => {
      throw new Error('故意失败')
    })
    c.effect('demo', () => void order.push(3))
    const errors = await c.disposeScope('demo')
    expect(order).toEqual([3, 1])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('故意失败')
  })

  it('取缺失的服务抛带名字的特定错误', () => {
    const c = new ServiceContainer()
    expect(() => c.get('launcher')).toThrow(MissingServiceError)
    expect(() => c.get('launcher')).toThrow('缺少服务 launcher')
    expect(c.getAll<string>('launcher')).toEqual([])
  })

  it('同名服务可重复注册，get 取最后一个，getAll 保留全部', () => {
    const c = new ServiceContainer()
    c.provide('thumb-provider', { id: 'image' })
    c.provide('thumb-provider', { id: 'psd' })
    c.provide('launcher', { id: 'first' })
    c.provide('launcher', { id: 'second' })
    expect(c.get<{ id: string }>('launcher').id).toBe('second')
    expect(c.getAll<{ id: string }>('thumb-provider').map((p) => p.id)).toEqual(['image', 'psd'])
    expect(c.has('launcher')).toBe(true)
  })
})

describe('topologicalSort', () => {
  it('按依赖顺序输出，同层保持原顺序', () => {
    const nodes: GraphNode[] = [
      { id: 'c', dependencies: ['a'] },
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: [] }
    ]
    expect(topologicalSort(nodes).ordered.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('指向不存在节点的依赖视为等待，不算环', () => {
    const nodes: GraphNode[] = [{ id: 'x', dependencies: ['not-provided'] }]
    const result = topologicalSort(nodes)
    expect(result.ordered.map((n) => n.id)).toEqual(['x'])
    expect(result.cyclic).toEqual([])
  })

  it('循环依赖全部标出，并给出可读路径', () => {
    const nodes: GraphNode[] = [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['c'] },
      { id: 'c', dependencies: ['a'] },
      { id: 'ok', dependencies: [] }
    ]
    const result = topologicalSort(nodes)
    expect(result.ordered.map((n) => n.id)).toEqual(['ok'])
    expect(result.cyclic.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(result.cyclePaths[0]?.[0]).toBe(result.cyclePaths[0]?.at(-1))
  })
})
