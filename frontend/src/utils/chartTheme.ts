/** 渠道配色（统一，深色/浅色均可用） */
export const CHANNEL_COLORS: Record<string, string> = {
  '堂食': '#4ECDC4',
  '美团外卖': '#FFB347',
  '饿了么': '#5B9BD5',
  '京东秒送': '#E8524A',
  '外卖': '#A78BFA',
  'all': '#6EE7B7',
}

type ChartSection = Record<string, unknown>

/** 强类型 ECharts 主题配置（所有 key 必选以保证 spread 安全） */
export interface ChartThemeConfig extends Record<string, unknown> {
  backgroundColor: string
  textStyle: ChartSection
  tooltip: ChartSection
  xAxis: ChartSection
  yAxis: ChartSection
  legend: ChartSection
}

/** ECharts 深色主题基础配置 */
export const ECHARTS_DARK: ChartThemeConfig = {
  backgroundColor: 'transparent',
  textStyle: { color: '#C9D1D9' },
  tooltip: {
    backgroundColor: '#1C2333',
    borderColor: '#30363D',
    textStyle: { color: '#E6EDF3' },
  },
  xAxis: {
    axisLine: { lineStyle: { color: '#30363D' } },
    splitLine: { lineStyle: { color: '#21262D' } },
    axisLabel: { color: '#8B949E' },
  },
  yAxis: {
    axisLine: { lineStyle: { color: '#30363D' } },
    splitLine: { lineStyle: { color: '#21262D' } },
    axisLabel: { color: '#8B949E' },
  },
  legend: { textStyle: { color: '#8B949E' } },
}

/** ECharts 浅色主题基础配置 */
export const ECHARTS_LIGHT: ChartThemeConfig = {
  backgroundColor: 'transparent',
  textStyle: { color: '#1F2937' },
  tooltip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    textStyle: { color: '#374151' },
  },
  xAxis: {
    axisLine: { lineStyle: { color: '#E5E7EB' } },
    splitLine: { lineStyle: { color: '#F3F4F6' } },
    axisLabel: { color: '#6B7280' },
  },
  yAxis: {
    axisLine: { lineStyle: { color: '#E5E7EB' } },
    splitLine: { lineStyle: { color: '#F3F4F6' } },
    axisLabel: { color: '#6B7280' },
  },
  legend: { textStyle: { color: '#374151' } },
}

/** 根据主题返回 ECharts 基础配置 */
export function getChartTheme(theme: 'dark' | 'light'): ChartThemeConfig {
  return theme === 'dark' ? ECHARTS_DARK : ECHARTS_LIGHT
}
