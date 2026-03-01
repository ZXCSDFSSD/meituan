/**
 * CategoryBarChart — 品类销售 Top N 横向条形图
 *
 * ════════════════════════════════════════════
 * 【图表结构】
 *   横向条形图（Horizontal Bar Chart）
 *   - Y 轴（纵）：品类名称（类目轴）
 *   - X 轴（横）：营业额数值轴
 *   - 条形从左向右延伸，代表该品类的销售额
 *   - 右侧有标签显示具体金额
 *
 * 【为什么用横向条形图而非普通柱状图？】
 *   品类名称（如"炒饭类"、"汤粉面"）文字较长，
 *   纵向柱状图 X 轴会拥挤，横向条形图的 Y 轴可以完整显示品类名。
 *   品类比较数量 Top 8 也适合从上到下排列阅读。
 * ════════════════════════════════════════════
 */

import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { getChartTheme } from '@/utils/chartTheme'
import { formatAmount } from '@/utils/formatters'
import type { StoreCategoryStat } from '@/types/api'

/**
 * Props — 组件属性类型
 *
 * data: StoreCategoryStat[]
 *   每个元素包含 { category, total_amount, total_quantity, order_count }
 *   来自 useStoreDetail 返回的 detail.categories
 *
 * topN?: number
 *   显示前几名，默认 8（Top 8 最常见）
 *
 * height?: number
 *   图表高度（px），默认 240
 */
interface Props {
  data: StoreCategoryStat[]
  topN?: number
  height?: number
}

export default function CategoryBarChart({ data, topN = 8, height = 240 }: Props) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)
  const isDark = theme === 'dark'

  /**
   * 数据处理：排序、截取、反转
   *
   * 步骤1: [...data] — 展开原数组创建副本
   *   直接对 data.sort() 会修改原数组（副作用），
   *   用展开运算符 [...data] 先复制一份再排序，保护原数据不变。
   *
   * 步骤2: .sort((a, b) => b.total_amount - a.total_amount)
   *   按营业额降序排列（b - a = 降序，a - b = 升序）
   *   sort 接受一个"比较函数"：返回负数则 a 在前，正数则 b 在前。
   *
   * 步骤3: .slice(0, topN)
   *   取前 topN 个（默认前 8 个）
   *
   * 步骤4: .reverse()
   *   反转顺序，使最大值显示在图表最上方。
   *   ECharts 横向条形图的 Y 轴从下往上渲染，
   *   反转后数组第一个元素（最小值）在最下，最后一个（最大值）在最上，符合阅读习惯。
   */
  const topData = [...data]
    .sort((a, b) => b.total_amount - a.total_amount)
    .slice(0, topN)
    .reverse()

  // 从处理后的数据中提取品类名和金额，分别作为 Y 轴标签和 X 轴数据
  const categories = topData.map((d) => d.category)
  const amounts    = topData.map((d) => d.total_amount)

  const option = {
    ...baseTheme,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },  // 触发提示时显示阴影高亮背景

      /**
       * formatter — 自定义 tooltip（悬停提示框）内容
       * params[0].name  → 品类名（Y 轴标签）
       * params[0].value → 该品类营业额数字
       * params[0].marker → ECharts 自动生成的色块 HTML（小方块，表示系列颜色）
       */
      formatter: (params: unknown[]) => {
        const p = (params as Array<{ name: string; value: number; marker: string }>)[0]
        return `${p.marker} ${p.name}: <strong>${formatAmount(p.value)}</strong>`
      },
    },

    /**
     * grid — 图表内边距
     *   containLabel: true → 自动将 axisLabel 的空间计入 grid，
     *   防止品类名字被裁切（品类名可能较长）
     *   right: 64 → 右侧留出空间显示条形末端的金额标签
     */
    grid: { top: 8, bottom: 8, left: 8, right: 64, containLabel: true },

    /**
     * xAxis — 数值轴（横向，显示金额）
     *   type: 'value' → 连续数值轴
     *   formatter → 把大数字格式化（如 85000 → '8.5万'）
     */
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => formatAmount(v),
        fontSize: 10,
        color: isDark ? '#8B949E' : '#6B7280',
      },
      splitLine: { lineStyle: { color: isDark ? '#21262D' : '#F3F4F6' } },
    },

    /**
     * yAxis — 类目轴（纵向，显示品类名）
     *   type: 'category' → 离散的字符串标签
     *   data: categories → 品类名数组（已按倒序排列）
     *   overflow: 'truncate' → 名字太长时截断显示（加 ...）
     *   width: 64 → 最大宽度限制
     */
    yAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        color: isDark ? '#8B949E' : '#6B7280',
        fontSize: 11,
        width: 64,
        overflow: 'truncate',
      },
      axisLine: { lineStyle: { color: isDark ? '#30363D' : '#E5E7EB' } },
    },

    /**
     * series — 数据系列
     *   type: 'bar'          → 条形图
     *   data: amounts        → 每个品类对应的营业额
     *   label.show: true     → 在条形末端显示数值标签
     *   label.position: 'right' → 标签位置在条形右侧
     *   itemStyle.color      → 条形颜色（统一蓝色）
     *   itemStyle.borderRadius → 末端（右端）圆角 [右上, 右下]（横向条形只有右端有圆角）
     *   barMaxWidth: 22      → 条形最大粗细（防止数据少时条形变得很粗）
     */
    series: [
      {
        type: 'bar',
        data: amounts,
        label: {
          show: true,
          position: 'right',
          formatter: (p: { value: number }) => formatAmount(p.value),
          fontSize: 11,
          color: isDark ? '#8B949E' : '#6B7280',
        },
        itemStyle: { color: '#5B9BD5', borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 22,
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} notMerge />
}
