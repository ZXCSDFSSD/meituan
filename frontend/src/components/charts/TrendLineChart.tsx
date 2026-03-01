import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { CHANNEL_COLORS, getChartTheme } from '@/utils/chartTheme'
import { formatAxisAmount, formatAmountFull, formatTC, formatAC } from '@/utils/formatters'

type Metric = 'revenue' | 'orders' | 'ac'

interface Series {
  name: string
  channel: string
  data: Array<{ month: string; value: number }>
}

interface TrendLineChartProps {
  seriesList: Series[]
  metric: Metric
  height?: number
}

const METRIC_LABELS: Record<Metric, string> = {
  revenue: '营业额',
  orders: '订单数 (TC)',
  ac: '客单价 (AC)',
}

export default function TrendLineChart({ seriesList, metric, height = 320 }: TrendLineChartProps) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)

  const months = seriesList[0]?.data.map((d) => d.month) ?? []

  const formatter = metric === 'revenue'
    ? (v: number) => formatAmountFull(v)
    : metric === 'orders'
    ? (v: number) => formatTC(v) + ' 单'
    : (v: number) => formatAC(v)

  const axisFormatter = metric === 'revenue'
    ? formatAxisAmount
    : metric === 'orders'
    ? (v: number) => `${v}`
    : (v: number) => `¥${v}`

  const option = {
    ...baseTheme,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const ps = params as Array<{ seriesName: string; value: number; marker: string }>
        const month = (params as Array<{ name: string }>)[0].name
        return (
          `<div style="font-weight:600;margin-bottom:4px">${month}</div>` +
          ps.map((p) => `${p.marker} ${p.seriesName}: <strong>${formatter(p.value)}</strong>`).join('<br/>')
        )
      },
    },
    legend: {
      ...baseTheme.legend,
      bottom: 0,
    },
    grid: { top: 16, bottom: 48, left: 60, right: 16, containLabel: false },
    xAxis: {
      type: 'category',
      data: months,
      ...baseTheme.xAxis,
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: axisFormatter,
        ...(baseTheme.yAxis['axisLabel'] as Record<string, unknown>),
      },
    },
    series: seriesList.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.data.map((d) => d.value),
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      itemStyle: { color: CHANNEL_COLORS[s.channel] ?? '#6EE7B7' },
      lineStyle: { width: 2.5, color: CHANNEL_COLORS[s.channel] ?? '#6EE7B7' },
      label: {
        show: true,
        position: 'top',
        formatter: (p: { value: number }) => axisFormatter(p.value),
        fontSize: 10,
        color: theme === 'dark' ? '#8B949E' : '#6B7280',
      },
    })),
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: theme === 'dark' ? '#8B949E' : '#6B7280', marginBottom: 4 }}>
        {METRIC_LABELS[metric]} 趋势
      </div>
      <ReactECharts option={option} style={{ height }} notMerge />
    </div>
  )
}
