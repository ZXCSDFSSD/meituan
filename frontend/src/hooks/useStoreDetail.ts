/**
 * useStoreDetail — 单店详情数据获取 Hook
 *
 * ════════════════════════════════════════════
 * 【Hook 是什么？】
 *   Hook 是 React 提供的特殊函数，以 "use" 开头命名。
 *   作用：让函数组件也能使用状态(state)、副作用(effect)等 React 能力。
 *   React 18 之前这些只能在 class 组件里用；Hook 出现后函数组件更简洁。
 *
 * 【自定义 Hook 的价值】
 *   这里我们把"发起 API 请求 → 存储结果 → 处理 loading/error"
 *   的逻辑封装成 useStoreDetail，好处：
 *   1. 页面组件变干净：只需 const { data, loading } = useStoreDetail(...)
 *   2. 可复用：多个地方需要单店数据时不用重复写
 *   3. 关注点分离：UI 逻辑和数据获取逻辑分开
 *
 * 【三状态模式（数据加载的标准套路）】
 *   data    = null    → 数据（初始为空，成功后填入）
 *   loading = false   → 是否正在加载（用于显示转圈 spinner）
 *   error   = null    → 错误信息（失败时填入，用于显示错误提示）
 * ════════════════════════════════════════════
 */

import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { StoreDetailResponse, Channel } from '@/types/api'

/**
 * Params — 这个 Hook 接受的参数类型
 *
 * 【TypeScript interface】
 *   描述调用方需要传什么进来。
 *   storeId 和 month 是必填项（没有 ?）；
 *   channel 后面加了 ? 表示可选（不传就是 undefined）。
 */
interface Params {
  storeId: string   // 门店 ID，如 'MD00001'
  month: string     // 月份，如 '2025-12'
  channel?: Channel // 渠道过滤（可选）
}

/**
 * useStoreDetail — 核心 Hook 函数
 *
 * 【函数签名说明】
 *   export function useStoreDetail(params: Params)
 *   ↑ export 表示其他文件可以 import 使用
 *   ↑ params: Params 是参数类型标注（TypeScript）
 *
 * 【返回值】
 *   { data, loading, error }
 *   调用方可以用解构赋值直接拿到这三个值：
 *   const { data, loading, error } = useStoreDetail({ storeId, month, channel })
 */
export function useStoreDetail(params: Params) {
  /**
   * useState<T>(初始值) — React 状态 Hook
   *
   * 【语法解读】
   *   const [data, setData] = useState<StoreDetailResponse | null>(null)
   *   └─ data    → 状态当前值（读取）
   *   └─ setData → 更新该状态的函数（调用后触发组件重新渲染）
   *   └─ null    → 初始值（还没获取数据时为 null）
   *
   * 【TypeScript 泛型 <StoreDetailResponse | null>】
   *   告诉 TypeScript 这个状态要么是 StoreDetailResponse 对象，要么是 null。
   *   这样 IDE 在你写 data.store 时能给出自动补全，写 data.xxx 时会报错。
   *
   * 【为什么 3 个 useState？】
   *   data/loading/error 代表数据获取的三种"时态"，分别独立管理：
   *   - loading=true  → 显示转圈动画
   *   - data≠null     → 显示图表和数据
   *   - error≠null    → 显示错误提示红框
   */
  const [data,    setData]    = useState<StoreDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  /**
   * useEffect — React 副作用 Hook
   *
   * 【副作用（Side Effect）是什么？】
   *   React 组件的核心任务是"把状态渲染成 UI"，
   *   除此之外的操作（网络请求、定时器、操作 DOM）都叫"副作用"。
   *   useEffect 就是 React 提供的"副作用容器"。
   *
   * 【语法：useEffect(函数, 依赖数组)】
   *   - 函数：副作用逻辑（这里是发请求）
   *   - 依赖数组 [params.storeId, params.month, params.channel]：
   *     只有这几个值"发生变化"时，才重新执行副作用函数。
   *     等价于"监听这三个值，有变化就重新发请求"。
   *
   * 【执行时机】
   *   1. 组件首次渲染后执行一次（相当于"挂载"）
   *   2. 依赖数组中任意值变化时再次执行（相当于"更新"）
   */
  useEffect(() => {
    /**
     * 早期退出（Guard Clause）：如果门店 ID 或月份为空，就不发请求。
     * 这是防御性编程的好习惯，避免发出无效的 API 请求。
     */
    if (!params.storeId || !params.month) return

    // 开始加载：重置 error，设置 loading=true
    setLoading(true)
    setError(null)

    /**
     * 链式调用（Promise Chain）：
     *
     * analyticsApi.getStoreDetail() 返回一个 Promise（异步操作的容器）。
     * Promise 有三种状态：pending（等待）→ fulfilled（成功）→ rejected（失败）
     *
     * .then(setData)
     *   成功时把返回值传给 setData，等价于 .then(data => setData(data))
     *   这会触发组件重新渲染，data 从 null 变成真实数据
     *
     * .catch((e: Error) => setError(e.message))
     *   失败时把错误信息存入 error 状态
     *   (e: Error) 是 TypeScript 类型标注，说明 e 是 Error 对象
     *
     * .finally(() => setLoading(false))
     *   无论成功还是失败，最终都把 loading 设为 false
     *   finally 保证 loading 不会永远卡在 true（即使出错也会关掉转圈）
     */
    analyticsApi.getStoreDetail(params.storeId, { month: params.month, channel: params.channel })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))

  }, [params.storeId, params.month, params.channel])
  //  ↑ 依赖数组：门店ID、月份、渠道任意一个改变时重新触发请求

  /**
   * 返回三状态供调用方使用
   *
   * 使用示例（在页面组件中）：
   *   const { data, loading, error } = useStoreDetail({ storeId: 'MD00001', month: '2025-12' })
   *   if (loading) return <Spin />
   *   if (error) return <Alert message={error} type="error" />
   *   return <div>{data?.store.store_name}</div>
   */
  return { data, loading, error }
}
