/**
 * TimeslotAreaChart — 24小时点单时段面积图
 *
 * ════════════════════════════════════════════
 * 【图表结构】
 *   - X 轴：24个小时（00:00 ~ 23:00）
 *   - Y 轴：订单数（TC）
 *   - 面积图（Area Chart）= 折线图 + 折线下方的渐变填充区域
 *
 * 【面积图 vs 柱状图的选择】
 *   时段数据是连续的时间序列，面积图能更好地展示趋势和波形，
 *   比柱状图更直观地看出"早高峰（11-12点）、晚高峰（17-18点）"的分布规律。
 *
 * 【渐变填充】
 *   面积区域使用从上到下渐变（不透明 → 几乎透明），
 *   视觉效果更现代，且不会遮挡底部的 X 轴标签。
 * ════════════════════════════════════════════
 */

import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { getChartTheme } from '@/utils/chartTheme'

/**
 * HourData — 单小时的时段数据
 *   从后端 /store-detail/:id 返回的 hours 数组中的每个元素
 */
interface HourData {
  hour: number  // 小时（0-23）
  tc: number    // 该小时的订单数
}

interface Props {
  data: HourData[]
  height?: number
}

export default function TimeslotAreaChart({ data, height = 200 }: Props) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)
  const isDark = theme === 'dark'

  /**
   * 构造 X 轴标签：['00:00', '01:00', ..., '23:00']
   *
   * Array.from({ length: 24 }, (_, i) => ...)
   *   创建长度为 24 的数组，用回调函数填充每个元素
   *   _ 是"忽略不用的第一个参数"的惯用占位符
   *   i 是索引（0-23）
   *
   * String(i).padStart(2, '0')
   *   把数字转字符串，并在左侧补零到2位：0→'00', 9→'09', 23→'23'
   */
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)

  /**
   * 把 data（可能乱序、可能缺少某些小时）转成完整的 24 小时 TC 数组
   *
   * Array(24).fill(0) → 创建 [0, 0, 0, ..., 0]（24个0）
   *
   * data.forEach((d) => { ... }) 遍历 API 返回的数据，
   * 把每小时的 TC 填入对应位置（tcByHour[3] = 11点的订单数，以此类推）
   *
   * 这样即使 data 中缺少某些小时（凌晨没有订单），tcByHour 中这些位置保持 0。
   */
  const tcByHour = Array(24).fill(0)
  data.forEach((d) => {
    if (d.hour >= 0 && d.hour < 24) tcByHour[d.hour] += d.tc
  })

  // 主题颜色：暗色用青绿，亮色用深蓝
  const mainColor = isDark ? '#4ECDC4' : '#0891B2'

  const option = {
    ...baseTheme,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        // params[0].name → 小时标签（如 '11:00'）
        // params[0].value → 该小时订单数
        const p = (params as Array<{ name: string; value: number }>)[0]
        return `${p.name}<br/><strong>${p.value} 单</strong>`
      },
    },

    // grid 内边距：紧凑布局，左侧留出刻度空间，底部留出 X 轴标签空间
    grid: { top: 8, bottom: 32, left: 36, right: 8 },

    /**
     * xAxis — 类目轴，显示 24 个小时标签
     *   boundaryGap: false → 折线/面积图从轴的边缘开始，不留空白间隙
     *   interval: 2 → 每隔2个显示一个标签（避免太密集）：00, 02, 04...
     */
    xAxis: {
      type: 'category',
      data: hours,
      boundaryGap: false,
      axisLabel: {
        interval: 2,
        fontSize: 10,
        color: isDark ? '#8B949E' : '#6B7280',
      },
      axisLine: { lineStyle: { color: isDark ? '#30363D' : '#E5E7EB' } },
      splitLine: { show: false },
    },

    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' },
      splitLine: { lineStyle: { color: isDark ? '#21262D' : '#F3F4F6' } },
    },

    series: [
      {
        type: 'line',
        data: tcByHour,
        smooth: true,         // 平滑曲线
        symbol: 'none',       // 不显示每个数据点的圆点（面积图通常不需要）
        lineStyle: { width: 2.5, color: mainColor },

        /**
         * areaStyle — 面积图填充配置
         *
         * color.type: 'linear' → 线性渐变（ECharts 内置渐变语法）
         * x: 0, y: 0, x2: 0, y2: 1 → 渐变方向：从上(0,0)到下(0,1)，垂直渐变
         * colorStops → 渐变色节点：
         *   offset: 0 → 顶部（70% 不透明，BB ≈ 75%）
         *   offset: 1 → 底部（极低透明度，11 ≈ 7%）
         *
         * 【十六进制颜色和透明度】
         *   颜色格式：#RRGGBBAA（最后两位是 Alpha 透明度）
         *   BB = 187/255 ≈ 73% 不透明；11 = 17/255 ≈ 7% 不透明
         */
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: mainColor + 'BB' },  // 顶部较不透明
              { offset: 1, color: mainColor + '11' },  // 底部几乎透明
            ],
          },
        },
        itemStyle: { color: mainColor },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} notMerge />
}
