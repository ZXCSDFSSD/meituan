/**
 * 全局筛选状态管理（基于 Zustand）
 *
 * ════════════════════════════════════════════
 * 【Zustand 是什么？】
 *   Zustand 是一个轻量级 React 状态管理库（比 Redux 简单很多）。
 *   核心思想：用一个 store（仓库）保存全局状态，任何组件都可以读取和修改它。
 *
 *   类比理解：
 *   └─ 就像一家餐厅的"当班白板"，写着当前日期/选中的门店/主题模式，
 *      每个员工（组件）都能看到白板，也能更新白板。
 *
 * 【为什么用 Zustand 而不是 React useState？】
 *   useState 是"组件内部状态"，只属于一个组件。
 *   当多个页面（总览、趋势、单店详情）都需要共享同一个月份筛选时，
 *   用 useState 需要把状态提升到最顶层父组件再层层传递（prop drilling，费力且难维护）。
 *   Zustand 提供全局 store，任何组件直接调用 useGlobalFilter() 即可获取状态，无需传参。
 *
 * 【persist 中间件是什么？】
 *   persist 是 Zustand 的持久化中间件。
 *   作用：把 store 中的状态自动保存到浏览器的 localStorage 中，
 *         这样刷新页面后状态不会丢失（比如用户选的月份、主题还在）。
 *   类比：localStorage 就像浏览器的"便签本"，关掉网页再打开还能看到。
 * ════════════════════════════════════════════
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import dayjs from 'dayjs'
import type { Channel, StoreOption } from '@/types/api'

/**
 * 【TypeScript Interface - 接口/类型定义】
 *
 * interface 是 TypeScript 专有语法（纯 JS 没有），用来描述一个对象的"形状"（有哪些属性和方法）。
 * 相当于一份"合同"：凡是声明为 GlobalFilterState 类型的对象，必须有这些属性和方法。
 *
 * 好处：IDE 能在你写 store.month 时自动补全，写错了立即报红线。
 */
interface GlobalFilterState {
  // ── 当前筛选状态（这些是"数据"）──────────────────────────

  /** 当前选中月份，格式 YYYY-MM（如 '2025-12'），默认上个月 */
  month: string

  /** 当前选中的门店 ID（如 'MD00001'），空字符串表示"全区域" */
  selectedStoreId: string

  /**
   * 当前选中渠道
   * Channel 是 types/api.ts 中定义的联合类型：
   *   'all' | '堂食' | '外卖' | '美团外卖' | '饿了么' | '京东秒送'
   * 联合类型（Union Type）用 | 连接，表示"只能是其中一个值"
   */
  channel: Channel

  /** 对比基准月（趋势页用，默认前两个月） */
  compareMonth: string

  /**
   * 对比指标：'revenue'=营业额 | 'orders'=订单数 | 'ac'=客单价
   * 'revenue' | 'orders' | 'ac' 是字符串字面量联合类型，比 string 更精确
   */
  compareMetric: 'revenue' | 'orders' | 'ac'

  /** 当前主题：'dark' 暗色 | 'light' 亮色 */
  theme: 'dark' | 'light'

  /** 门店列表（从 /api/analytics/stores 获取），用于顶部下拉框 */
  storeOptions: StoreOption[]

  // ── Actions（这些是"修改状态的方法"）──────────────────────

  setMonth:         (m: string) => void
  setStoreId:       (id: string) => void
  setChannel:       (c: Channel) => void
  setCompareMonth:  (m: string) => void
  setCompareMetric: (metric: 'revenue' | 'orders' | 'ac') => void

  /** 切换暗色/亮色主题（toggle = 反转当前值） */
  toggleTheme: () => void

  /** 设置门店列表（App 启动时调用一次） */
  setStoreOptions: (opts: StoreOption[]) => void

  /**
   * 把当前筛选状态转为后端 API 参数对象
   * 规则：空字符串的 storeId 和 'all' 的 channel 不传给后端
   *
   * 示例：
   *   月份=2025-12，门店=MD00001，渠道=堂食
   *   → { month: '2025-12', storeId: 'MD00001', channel: '堂食' }
   *
   *   月份=2025-12，门店=''（全区域），渠道='all'
   *   → { month: '2025-12' }   // 后两个字段不包含
   */
  toParams: () => { month: string; storeId?: string; channel?: Channel }
}

/**
 * dayjs().subtract(1, 'month').format('YYYY-MM')
 *
 * dayjs 是一个日期处理库（类似原生 Date，但更好用）：
 *   dayjs()            → 当前时间
 *   .subtract(1, 'month') → 减去1个月（即"上个月"）
 *   .format('YYYY-MM') → 格式化成字符串，如 '2025-12'
 *
 * 这里在模块初始化时计算一次"上个月"，作为默认月份。
 */
const lastMonth = dayjs().subtract(1, 'month').format('YYYY-MM')

/**
 * create<GlobalFilterState>()( ... )
 *
 * Zustand 的 create 函数创建一个 store（状态仓库）。
 * 它接受一个函数，该函数接收 set 和 get 两个参数：
 *   - set(partial): 更新 store 中的状态（类似 setState）
 *   - get():        读取 store 当前状态
 *
 * 外层加了 persist() 中间件包裹，使状态自动持久化到 localStorage。
 *
 * 【TypeScript 泛型语法】
 *   create<GlobalFilterState>() — 尖括号 <> 里是类型参数，
 *   相当于告诉 TypeScript："这个 store 的形状是 GlobalFilterState"，
 *   这样 IDE 才能在 useGlobalFilter().month 时给出正确的类型提示。
 */
export const useGlobalFilter = create<GlobalFilterState>()(
  persist(
    /**
     * 这个函数的参数 (set, get) 由 Zustand 框架传入。
     * 返回值是一个对象，包含所有"状态值"和"action方法"。
     */
    (set, get) => ({
      // ── 初始状态（默认值）──────────────────────────────────

      month:         lastMonth,                                          // 默认上个月
      selectedStoreId: '',                                               // 默认全区域
      channel:       'all',                                              // 默认全渠道
      compareMonth:  dayjs().subtract(2, 'month').format('YYYY-MM'),     // 默认两个月前
      compareMetric: 'revenue',                                          // 默认对比营业额
      theme:         'light',                                            // 默认亮色主题
      storeOptions:  [],                                                 // 初始空列表

      // ── Action 方法（更新状态）────────────────────────────

      /**
       * set({ key: value }) 是 Zustand 的状态更新方法。
       * 只需要传入"要改变的字段"，Zustand 会自动合并（不像 useState 需要展开原有状态）。
       */
      setMonth:         (m)      => set({ month: m }),
      setStoreId:       (id)     => set({ selectedStoreId: id }),
      setChannel:       (c)      => set({ channel: c }),
      setCompareMonth:  (m)      => set({ compareMonth: m }),
      setCompareMetric: (metric) => set({ compareMetric: metric }),

      /**
       * toggleTheme 使用了 set 的函数形式：set(prevState => newState)
       * 当新状态依赖旧状态时，用函数形式可以安全地读取最新值。
       * 这里 s 就是当前 store 状态，根据 s.theme 决定切换到哪个主题。
       */
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      setStoreOptions: (opts) => set({ storeOptions: opts }),

      /**
       * toParams 使用 get() 读取当前状态（在 action 内部无法用 this）。
       *
       * 【解构赋值语法】
       *   const { month, selectedStoreId, channel } = get()
       *   等价于：
       *   const state = get()
       *   const month = state.month
       *   const selectedStoreId = state.selectedStoreId
       *   const channel = state.channel
       *
       * 【展开运算符条件拼接】
       *   ...(selectedStoreId ? { storeId: selectedStoreId } : {})
       *   如果 selectedStoreId 不为空，则展开 { storeId: selectedStoreId }；
       *   否则展开空对象 {}（相当于什么都不加）。
       *   这是 JS 中"条件性添加字段"的常用惯用法。
       */
      toParams: () => {
        const { month, selectedStoreId, channel } = get()
        return {
          month,
          ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
          ...(channel !== 'all' ? { channel } : {}),
        }
      },
    }),

    /**
     * persist 中间件配置：
     *   name:       localStorage 中的存储 key 名称
     *   partialize: 指定"只持久化哪些字段"（storeOptions 不保存，因为每次从 API 拉取最新数据）
     *
     * 【TypeScript 语法：(s) => ({...})】
     *   箭头函数返回对象字面量时，外层需要加括号，否则 {} 会被解析为"函数体"而非"对象"。
     */
    {
      name: 'mxyw-global-filter',
      partialize: (s) => ({
        month:         s.month,
        selectedStoreId: s.selectedStoreId,
        channel:       s.channel,
        compareMonth:  s.compareMonth,
        compareMetric: s.compareMetric,
        theme:         s.theme,
        // storeOptions 不持久化（每次启动从 API 重新加载最新门店列表）
      }),
    }
  )
)
