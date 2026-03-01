/**
 * 营业额：≥10000 → "X.XX万"，否则 "¥X,XXX"
 */
export function formatAmount(v: number | null | undefined): string {
  if (v == null) return '--'
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(2)}万`
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

/**
 * 完整金额（用于 Tooltip），固定两位小数
 */
export function formatAmountFull(v: number | null | undefined): string {
  if (v == null) return '--'
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * TC（订单数）：整数 + 千分位
 */
export function formatTC(v: number | null | undefined): string {
  if (v == null) return '--'
  return Math.round(v).toLocaleString('zh-CN')
}

/**
 * AC（客单价）：¥XX.XX
 */
export function formatAC(v: number | null | undefined): string {
  if (v == null) return '--'
  return `¥${v.toFixed(2)}`
}

/**
 * 环比/同比百分比：+X.X% / -X.X%
 */
export function formatMom(v: number | null | undefined): string {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

/**
 * 获取环比方向
 */
export function getMomDirection(v: number | null | undefined): 'up' | 'down' | 'flat' | 'none' {
  if (v == null) return 'none'
  if (v > 0.5) return 'up'
  if (v < -0.5) return 'down'
  return 'flat'
}

/**
 * ECharts Y 轴刻度标签（简写）
 */
export function formatAxisAmount(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(0)}万`
  return `${v}`
}

/**
 * 占比格式：X.X%
 */
export function formatShare(v: number | null | undefined): string {
  if (v == null) return '--'
  return `${v.toFixed(1)}%`
}
