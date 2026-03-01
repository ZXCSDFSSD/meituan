import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { CHANNEL_COLORS, getChartTheme } from '@/utils/chartTheme'
import { formatAxisAmount, formatAmountFull } from '@/utils/formatters'

interface DataPoint {
  label: string       // X 轴标签（月份或门店名）
  value: number
  channel?: string
}

interface RevenueBarChartProps {
  data: DataPoint[]
  title?: string
  height?: number
  horizontal?: boolean
  color?: string
}

export default function RevenueBarChart({
  data,
  title,
  height = 300,
  horizontal = false,
  color,
}: RevenueBarChartProps) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)

  const barColor = color ?? CHANNEL_COLORS['all']

  const option = {
    ...baseTheme,
    title: title
      ? {
          text: title,
          textStyle: { fontSize: 13, fontWeight: 600, color: theme === 'dark' ? '#E6EDF3' : '#1F2937' },
          top: 4, left: 0,
        }
      : undefined,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = (params as Array<{ name: string; value: number }>)[0]
        return `${p.name}<br/><strong>${formatAmountFull(p.value)}</strong>`
      },
    },
    grid: { top: title ? 36 : 12, bottom: 32, left: 56, right: horizontal ? 64 : 16, containLabel: false },
    xAxis: horizontal
      ? { type: 'value', axisLabel: { formatter: formatAxisAmount, ...(baseTheme.xAxis['axisLabel'] as Record<string, unknown>) } }
      : { type: 'category', data: data.map((d) => d.label), ...baseTheme.xAxis },
    yAxis: horizontal
      ? { type: 'category', data: data.map((d) => d.label), ...baseTheme.yAxis }
      : {
          type: 'value',
          axisLabel: { formatter: formatAxisAmount, ...(baseTheme.yAxis['axisLabel'] as Record<string, unknown>) },
        },
    series: [
      {
        type: 'bar',
        data: data.map((d) => d.value),
        itemStyle: { color: barColor, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
        barMaxWidth: 48,
        label: {
          show: true,
          position: horizontal ? 'right' : 'top',
          formatter: (p: { value: number }) => formatAxisAmount(p.value),
          fontSize: 11,
          color: theme === 'dark' ? '#8B949E' : '#6B7280',
        },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} notMerge />
}
