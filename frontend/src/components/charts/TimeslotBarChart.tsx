import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { getChartTheme } from '@/utils/chartTheme'
// Accepts both TimeslotHour and StoreHourStat (both have .hour and .tc)
interface HourData {
  hour: number
  tc: number
}

interface TimeslotBarChartProps {
  data: HourData[]
  height?: number
}

export default function TimeslotBarChart({ data, height = 240 }: TimeslotBarChartProps) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)

  // 0-23 小时
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
  const ordersByHour = Array(24).fill(0)
  data.forEach((d) => {
    if (d.hour >= 0 && d.hour < 24) ordersByHour[d.hour] += d.tc
  })

  // 峰值着色
  const maxVal = Math.max(...ordersByHour)
  const itemColors = ordersByHour.map((v) =>
    v === maxVal ? '#FFB347' : (theme === 'dark' ? '#4ECDC4' : '#6EE7B7')
  )

  const option = {
    ...baseTheme,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = (params as Array<{ name: string; value: number }>)[0]
        return `${p.name}<br/><strong>${p.value} 单</strong>`
      },
    },
    grid: { top: 8, bottom: 32, left: 40, right: 8 },
    xAxis: {
      type: 'category',
      data: hours,
      axisLabel: {
        interval: 2,
        ...(baseTheme.xAxis['axisLabel'] as Record<string, unknown>),
      },
    },
    yAxis: { type: 'value', ...baseTheme.yAxis },
    series: [
      {
        type: 'bar',
        data: ordersByHour.map((v, i) => ({ value: v, itemStyle: { color: itemColors[i] } })),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} notMerge />
}
