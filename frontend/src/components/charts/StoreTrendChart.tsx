/**
 * StoreTrendChart — 营业额趋势 + 环比折线图（双 Y 轴）
 *
 * ════════════════════════════════════════════
 * 【图表结构】
 *   - 主 Y 轴（左）：营业额，柱状图（bar）
 *   - 副 Y 轴（右）：环比增长率（%），折线图（line）
 *   - X 轴：月份（如 2025-01, 2025-02 ...）
 *
 * 【双 Y 轴的意义】
 *   营业额（万元级别）和环比%（±20%左右）数量级差异太大，
 *   如果共用一个 Y 轴，环比线会被压扁成一条水平线，看不出变化。
 *   双 Y 轴各自独立刻度，两者都能清晰展示。
 *
 * 【ECharts 是什么？】
 *   ECharts 是百度开源的图表库（现为 Apache 项目），功能非常强大。
 *   我们使用 echarts-for-react 作为 React 封装版，
 *   通过传入 option 对象（大型 JSON 配置）来描述图表样式和数据。
 * ════════════════════════════════════════════
 */

import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { getChartTheme } from '@/utils/chartTheme'
import { formatAmount } from '@/utils/formatters'
import type { StoreTrendPoint } from '@/types/api'

/**
 * Props — 组件接受的属性类型（TypeScript interface）
 *
 * 【React Props 是什么？】
 *   Props（属性）是父组件传给子组件的数据，类似函数的参数。
 *   每次 props 改变，组件会重新渲染（更新图表）。
 *
 * data: StoreTrendPoint[]
 *   StoreTrendPoint 是 types/api.ts 中定义的类型，包含：
 *   { month, total_amount, order_count, avg_order_amount, total_discount, ... }
 *   [] 表示"数组"，即多个月份的数据点列表。
 *
 * height?: number
 *   ? 表示"可选"，不传时使用默认值 240（下面函数签名中的 = 240）
 */
interface Props {
  data: StoreTrendPoint[]
  height?: number
}

/**
 * StoreTrendChart — 组件函数
 *
 * 【React 函数组件语法】
 *   export default function Xxx({ prop1, prop2 = defaultValue }: Props) { ... }
 *   └─ { data, height = 240 } 是"解构赋值" + "默认值"的组合写法
 *   └─ 等价于: function Xxx(props: Props) { const data = props.data; const height = props.height ?? 240; }
 */
export default function StoreTrendChart({ data, height = 240 }: Props) {
  /**
   * useGlobalFilter() — 从 Zustand 全局 store 读取当前主题
   * theme 值为 'dark' 或 'light'
   */
  const { theme } = useGlobalFilter()

  /**
   * getChartTheme(theme) — 返回对应主题的基础配置对象
   * 包含：backgroundColor、tooltip样式、xAxis颜色、yAxis颜色、legend颜色等
   * 这样所有图表保持一致的主题风格，不用每个图表单独设颜色
   */
  const baseTheme = getChartTheme(theme)
  const isDark = theme === 'dark'

  /**
   * 【Array.map 数据转换】
   *   data 是 StoreTrendPoint[]，我们需要把它"转换"成 ECharts 需要的格式。
   *
   *   data.map((d) => d.month)
   *   → 遍历数组每个元素 d，返回 d.month，收集成新数组
   *   → 如 ['2025-01', '2025-02', '2025-03', ...]
   *
   *   data.map((d) => d.total_amount)
   *   → 如 [85000, 92000, 78000, ...]  （每月营业额数字）
   */
  const months  = data.map((d) => d.month)
  const amounts = data.map((d) => d.total_amount)

  /**
   * 在组件内计算环比（MoM = Month-on-Month）
   *
   * 【为什么在前端计算？】
   *   后端 /trend 接口也会返回 mom_pct，但 /store-detail/:id 的 trend 字段
   *   可能不包含 mom_pct。这里在组件内重新计算，更稳健。
   *
   * 【计算逻辑】
   *   环比% = (本月 - 上月) / 上月 × 100
   *   第一个月（i=0）没有上月，返回 null（ECharts 会断开折线不连接）
   *   .toFixed(1) 保留1位小数，+ 将字符串转回数字（"+3.14" === 3.14）
   *
   * 【Array.map 中用 i 做下标】
   *   data.map((d, i) => { ... })
   *   i 是当前元素的下标（索引），从 0 开始。
   *   data[i - 1] 就是"上一个元素"（上月数据）。
   */
  const momPcts = data.map((d, i) => {
    if (i === 0) return null                              // 第一个月没有环比
    const prev = data[i - 1].total_amount
    if (!prev) return null                               // 上月营业额为0，不计算（防除0）
    return +((d.total_amount - prev) / prev * 100).toFixed(1)
  })

  /**
   * ECharts option 配置对象
   *
   * 【展开运算符 ...baseTheme】
   *   把 baseTheme 的所有属性"展开"到这里，
   *   等价于把 baseTheme 的每个 key-value 都复制进来。
   *   后面再写的属性会"覆盖" baseTheme 中同名的属性。
   *
   * 【完整结构】
   *   tooltip   → 悬停提示框
   *   legend    → 图例（左上角标注哪条线是什么）
   *   grid      → 图表内边距（top/bottom/left/right）
   *   xAxis     → X 轴配置
   *   yAxis     → 数组，支持多个 Y 轴（这里是双 Y 轴）
   *   series    → 数据系列（这里是柱状图+折线图两个系列）
   */
  const option = {
    ...baseTheme,   // 应用主题基础配置（背景色、字体颜色等）
    tooltip: {
      ...baseTheme.tooltip,  // 继承基础 tooltip 样式
      trigger: 'axis',       // 触发方式：鼠标移到 X 轴某列时触发（而非单个数据点）

      /**
       * formatter — 自定义 tooltip 内容（返回 HTML 字符串）
       *
       * params 是 ECharts 传入的参数数组，每个系列对应一个元素。
       * 这里有 2 个系列（营业额柱 + 环比折），所以 params 长度最多为 2。
       *
       * 【TypeScript 类型断言】
       *   (params as Array<{...}>)
       *   因为 ECharts 的 formatter 参数类型是 unknown，
       *   我们明确告诉 TypeScript "我知道它的实际类型是..."
       */
      formatter: (params: unknown[]) => {
        const ps = params as Array<{ seriesName: string; value: number | null; marker: string; name: string }>
        const month = ps[0]?.name ?? ''  // 月份标签（如 '2025-12'）

        // ?? 是"空值合并运算符"：ps[0]?.name 如果是 undefined 就用 '' 代替
        // ?. 是"可选链"：ps[0] 如果是 undefined 就不报错，直接返回 undefined

        let html = `<div style="font-weight:600;margin-bottom:4px">${month}</div>`
        ps.forEach((p) => {
          if (p.seriesName === '营业额') {
            // 调用 formatAmount 格式化大金额（如 85000 → '8.5万'）
            html += `${p.marker} 营业额: <strong>${formatAmount(p.value ?? 0)}</strong><br/>`
          } else if (p.value != null) {
            // 环比系列：绿色正值、红色负值
            const v    = p.value as number
            const sign  = v >= 0 ? '+' : ''           // 正数加 + 号
            const color = v >= 0 ? '#52C41A' : '#FF4D4F'  // 绿/红
            html += `${p.marker} 环比: <strong style="color:${color}">${sign}${v}%</strong><br/>`
          }
        })
        return html  // ECharts 会把这个 HTML 字符串渲染到 tooltip 里
      },
    },

    legend: { ...baseTheme.legend, bottom: 0 },   // 图例放底部，继承主题颜色

    /**
     * grid — 图表绘制区域的内边距（单位: px）
     *   top:  为标题留出空间
     *   bottom: 为 legend（底部图例）留出空间
     *   left/right: 为 Y 轴刻度标签留出空间（两侧都有 Y 轴，各需要约 56px）
     */
    grid: { top: 16, bottom: 48, left: 56, right: 56 },

    /**
     * xAxis — X 轴配置
     *   type: 'category' → 类目轴（使用离散的字符串标签，如月份名称）
     *   data: months     → 标签数组（['2025-01', '2025-02', ...]）
     *   ...baseTheme.xAxis → 应用主题中的颜色配置
     */
    xAxis: {
      type: 'category',
      data: months,
      ...baseTheme.xAxis,
    },

    /**
     * yAxis — Y 轴配置（数组表示多个 Y 轴）
     *
     * yAxis[0] → 主 Y 轴（左侧），显示营业额
     * yAxis[1] → 副 Y 轴（右侧），显示环比%
     *
     * 每个数据系列通过 yAxisIndex: 0 或 1 绑定到对应的 Y 轴。
     */
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          /**
           * formatter 函数：把数字转成带"万"的缩写显示
           * (v: number) => formatAmount(v)
           * 箭头函数：v 是 Y 轴刻度值，formatAmount 把它格式化
           */
          formatter: (v: number) => formatAmount(v),
          color: isDark ? '#8B949E' : '#6B7280',
          fontSize: 11,
        },
        splitLine: { lineStyle: { color: isDark ? '#21262D' : '#F3F4F6' } },
      },
      {
        type: 'value',
        name: '环比%',
        nameTextStyle: { color: isDark ? '#8B949E' : '#9CA3AF', fontSize: 10 },
        axisLabel: {
          // 正数加 + 号（如 +5.3%），负数自带 - 号
          formatter: (v: number) => `${v > 0 ? '+' : ''}${v}%`,
          color: isDark ? '#8B949E' : '#6B7280',
          fontSize: 10,
        },
        splitLine: { show: false },  // 副 Y 轴不显示网格线（避免视觉混乱）
      },
    ],

    /**
     * series — 数据系列（数组，每个元素代表一条线/一组柱）
     *
     * series[0]: 营业额柱状图
     *   type: 'bar'       → 柱状图
     *   yAxisIndex: 0     → 绑定到左侧主 Y 轴
     *   itemStyle.borderRadius → 柱子顶部圆角 [左上, 右上, 右下, 左下]
     *   barMaxWidth: 40   → 柱子最大宽度（月数少时不会太胖）
     *
     * series[1]: 环比折线图
     *   type: 'line'      → 折线图
     *   yAxisIndex: 1     → 绑定到右侧副 Y 轴
     *   smooth: true      → 平滑曲线（而非折角）
     *   connectNulls: false → 第一个月 null 时折线断开（不连到下一个点）
     */
    series: [
      {
        name: '营业额',
        type: 'bar',
        data: amounts,
        yAxisIndex: 0,
        itemStyle: { color: '#4ECDC4', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 40,
      },
      {
        name: '环比',
        type: 'line',
        data: momPcts,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',      // 数据点标记形状：实心圆
        symbolSize: 5,         // 数据点大小
        lineStyle: { width: 2, color: '#FFB347' },
        itemStyle: { color: '#FFB347' },
        connectNulls: false,   // null 值处断开折线（不跨空连线）
      },
    ],
  }

  /**
   * ReactECharts — echarts-for-react 提供的 React 组件
   *
   * option  → 完整的图表配置对象
   * style   → CSS 样式（这里控制高度）
   * notMerge → true 时每次 option 变化都完全替换（而非合并）
   *            避免旧数据残留影响新渲染
   */
  return <ReactECharts option={option} style={{ height }} notMerge />
}
