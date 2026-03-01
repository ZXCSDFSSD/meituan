// ─── 通用 ─────────────────────────────────────────────────────────────────
export type Channel = 'all' | '堂食' | '美团外卖' | '饿了么' | '京东秒送' | '外卖'

// ─── GET /api/analytics/stores ────────────────────────────────────────────
export interface StoreOption {
  store_id: string
  store_name: string
  location_type: string | null
  has_partner: number   // 0 | 1
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────
export interface OverviewSummary {
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  avg_ac: number
}

export interface OverviewChannelStat {
  amount: number
  order_count: number
  ac: number
}

export interface PaymentMethodRow {
  payment_method: string
  total_amount: number
  total_income: number
  handling_fee: number
  payment_count: number
}

export interface OverviewData {
  month: string
  store_count: number
  summary: OverviewSummary
  channels: {
    dine_in:  OverviewChannelStat
    delivery: OverviewChannelStat
    meituan:  OverviewChannelStat
    eleme:    OverviewChannelStat
    jd:       OverviewChannelStat
  }
  channel_ratio: {
    dine_in:  number
    delivery: number
    meituan:  number
    eleme:    number
    jd:       number
  }
  payment_methods: PaymentMethodRow[]
}

// ─── GET /api/analytics/trend ─────────────────────────────────────────────
export interface TrendDataPoint {
  month: string
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  avg_ac: number
  mom_pct: number | null
}

export interface TrendResponse {
  channel: string
  store_id: string
  data: TrendDataPoint[]
}

// ─── GET /api/analytics/store-rank ───────────────────────────────────────
export interface StoreRankItem {
  rank: number
  store_id: string
  store_name: string
  location_type: string | null
  has_partner: boolean
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  avg_ac: number
  prev_amount: number | null
  mom_pct: number | null
}

export interface StoreRankResponse {
  month: string
  channel: string
  stores: StoreRankItem[]
}

// ─── GET /api/analytics/category-sales ───────────────────────────────────
export interface CategorySalesItem {
  category: string
  total_quantity: number
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  amount_ratio: number
}

export interface CategorySalesResponse {
  month: string
  store_id: string
  channel: string
  total_amount: number
  categories: CategorySalesItem[]
}

// ─── GET /api/analytics/timeslot ─────────────────────────────────────────
export interface TimeslotHour {
  hour: number
  label: string
  tc: number
  total_amount: number
  total_income: number
}

export interface TimeslotResponse {
  month: string
  store_id: string
  channel: string
  peak_hours: number[]
  hours: TimeslotHour[]
}

// ─── GET /api/analytics/monthly-compare ──────────────────────────────────
export interface MonthlyCompareMonth {
  month: string
  value: number | null
  yoy_pct: number | null
  mom_pct: number | null
  last_year_value: number | null
}

export interface MonthlyCompareStore {
  store_id: string
  store_name: string
  metric: string
  months: MonthlyCompareMonth[]
  year_total: number
}

export interface MonthlyCompareResponse {
  year: number
  channel: string
  metric: string
  stores: MonthlyCompareStore[]
}

// ─── GET /api/analytics/store-detail/:id ─────────────────────────────────
export interface StoreTrendPoint {
  month: string
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  avg_order_amount: number
}

export interface StoreChannelStat {
  channel: string
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  avg_order_amount: number
}

export interface StoreCategoryStat {
  category: string
  total_quantity: number
  total_amount: number
  order_count: number
}

export interface StoreHourStat {
  hour: number
  label: string
  tc: number
  total_amount: number
}

export interface StorePaymentStat {
  payment_method: string
  biz_sub_type: string | null
  total_amount: number
  total_income: number
  handling_fee: number
  payment_count: number
}

export interface StoreInfo {
  store_id: string
  store_name: string
  location_type: string | null
  has_partner: number   // INTEGER 0|1
}

export interface StoreDetailResponse {
  store: StoreInfo
  month: string
  channel: string
  trend: StoreTrendPoint[]
  channels: StoreChannelStat[]
  categories: StoreCategoryStat[]
  hours: StoreHourStat[]
  payments: StorePaymentStat[]
}

// ─── GET /api/analytics/products ─────────────────────────────────────────
export interface ProductItem {
  rank: number
  item_id: string
  item_name: string
  category: string
  total_quantity: number
  total_amount: number
  total_income: number
  total_discount: number
  order_count: number
  qty_ratio: number
  amount_ratio: number
}

export interface ProductsResponse {
  month: string
  store_id: string
  category: string
  total_items: number
  total_qty: number
  total_amount: number
  products: ProductItem[]
}

// ─── GET /api/analytics/channel-breakdown ────────────────────────────────
export interface ChannelBreakdownStore {
  store_id: string
  store_name: string
  channels: Record<string, {
    total_amount: number
    total_income: number
    total_discount: number
    order_count: number
    avg_ac: number
  }>
}

export interface ChannelBreakdownResponse {
  month: string
  stores: ChannelBreakdownStore[]
}
