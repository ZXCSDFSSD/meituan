import ReactECharts from 'echarts-for-react'
import { useGlobalFilter } from '@/stores/globalFilter'
import { CHANNEL_COLORS, getChartTheme } from '@/utils/chartTheme'
import { formatAmountFull, formatShare } from '@/utils/formatters'

interface DonutItem {
  name: string
  value: number
}

interface DonutChartProps {
  data: DonutItem[]
  title?: string
  height?: number
  colorKey?: 'channel' | 'auto'
}

const AUTO_COLORS = ['#4ECDC4', '#FFB347', '#5B9BD5', '#E8524A', '#A78BFA', '#6EE7B7', '#FDE68A']

export default function DonutChart({ data, title, height = 280, colorKey = 'channel' }: DonutChartProps) {
  const { theme } = useGlobalFilter()
  const baseTheme = getChartTheme(theme)
  const isDark = theme === 'dark'

  const colors = data.map((d, i) =>
    colorKey === 'channel'
      ? (CHANNEL_COLORS[d.name] ?? AUTO_COLORS[i % AUTO_COLORS.length])
      : AUTO_COLORS[i % AUTO_COLORS.length]
  )

  const option = {
    ...baseTheme,
    color: colors,
    tooltip: {
      ...baseTheme.tooltip,
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/><strong>${formatAmountFull(p.value)}</strong><br/>${formatShare(p.percent)}`,
    },
    legend: {
      ...baseTheme.legend,
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        label: {
          show: true,
          position: 'inside',
          formatter: (p: { percent: number }) => p.percent >= 5 ? `${p.percent.toFixed(0)}%` : '',
          fontSize: 11,
          color: '#fff',
          fontWeight: '600',
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 'bold',
            formatter: (p: { name: string; percent: number }) => `${p.name}\n${formatShare(p.percent)}`,
          },
        },
        data,
      },
    ],
    title: title
      ? {
          text: title,
          textStyle: { fontSize: 13, fontWeight: 600, color: isDark ? '#E6EDF3' : '#1F2937' },
          top: 4, left: 0,
        }
      : undefined,
  }

  return <ReactECharts option={option} style={{ height }} notMerge />
}
