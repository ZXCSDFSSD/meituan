/**
 * Analytics API 调用层
 *
 * 【职责】
 *   把所有对后端 /api/analytics/* 的 HTTP 请求，封装成有类型的函数。
 *   页面和 hook 只调用这里的函数，不直接写 URL 字符串。
 *
 * 【TypeScript 泛型语法说明】
 *   client.get<never, XxxResponse>(url, { params })
 *   第一个泛型参数 never：表示"请求体类型"（GET 没有请求体，用 never 占位）
 *   第二个泛型参数 XxxResponse：表示"响应数据类型"，TypeScript 会自动推断返回值类型
 *   这样 IDE 就能在写代码时给出自动补全提示
 *
 * 【参数传递方式】
 *   { params } → Axios 会把这个对象转成 URL 查询字符串（Query String）
 *   例如：getOverview({ month: '2025-12', store_id: 'MD00001' })
 *   最终请求：GET /api/analytics/overview?month=2025-12&store_id=MD00001
 */

import client from './client'
import type {
  OverviewData,          // 总览数据结构
  TrendResponse,         // 趋势数据结构
  StoreRankResponse,     // 门店排名数据结构
  CategorySalesResponse, // 品类销售数据结构
  TimeslotResponse,      // 时段数据结构
  MonthlyCompareResponse, // 月度同比环比数据结构
  StoreDetailResponse,   // 单店详情数据结构
  ProductsResponse,      // 品项排行数据结构
  ChannelBreakdownResponse, // 渠道分解数据结构
  StoreOption,           // 门店选项（下拉列表用）
  Channel,               // 渠道类型（字符串联合类型）
} from '@/types/api'

/**
 * analyticsApi — 所有分析相关接口的集合对象
 *
 * 使用方式（在 hook 或组件中）：
 *   import { analyticsApi } from '@/api'
 *   analyticsApi.getOverview({ month: '2025-12' }).then(data => ...)
 */
export const analyticsApi = {
  /**
   * 总览接口：返回指定月份所有门店的汇总 KPI
   * 对应后端：GET /api/analytics/overview
   *
   * @param month    月份，格式 YYYY-MM，不传则用最新月
   * @param store_id 门店ID，不传则汇总全部门店
   * @returns OverviewData { month, store_count, summary, channels, channel_ratio, payment_methods }
   */
  getOverview: (params: { month?: string; store_id?: string }) =>
    client.get<never, OverviewData>('/analytics/overview', { params }),

  /**
   * 趋势接口：返回连续多个月的营业额趋势（含环比 MoM）
   * 对应后端：GET /api/analytics/trend
   *
   * @param channel      渠道过滤，不传则 'all'
   * @param store_id     门店过滤，不传则汇总
   * @param start_month  起始月份
   * @param end_month    结束月份（默认最新月）
   * @param limit        最多返回多少个月（最大 60）
   * @returns TrendResponse { channel, store_id, data: TrendDataPoint[] }
   */
  getTrend: (params: {
    channel?: Channel
    store_id?: string
    start_month?: string
    end_month?: string
    limit?: number
  }) =>
    client.get<never, TrendResponse>('/analytics/trend', { params }),

  /**
   * 门店排名接口：指定月份各门店营业额排名（含环比）
   * 对应后端：GET /api/analytics/store-rank
   */
  getStoreRank: (params: { month?: string; channel?: Channel }) =>
    client.get<never, StoreRankResponse>('/analytics/store-rank', { params }),

  /**
   * 渠道分解接口：按门店×渠道展开详细数据
   * 对应后端：GET /api/analytics/channel-breakdown
   */
  getChannelBreakdown: (params: { month?: string; store_id?: string }) =>
    client.get<never, ChannelBreakdownResponse>('/analytics/channel-breakdown', { params }),

  /**
   * 品类销售接口：指定月份品类维度销售汇总
   * 对应后端：GET /api/analytics/category-sales
   */
  getCategorySales: (params: { month?: string; store_id?: string; channel?: Channel; limit?: number }) =>
    client.get<never, CategorySalesResponse>('/analytics/category-sales', { params }),

  /**
   * 时段分析接口：24小时点单时段分布
   * 对应后端：GET /api/analytics/timeslot
   */
  getTimeslot: (params: { month?: string; store_id?: string; channel?: Channel }) =>
    client.get<never, TimeslotResponse>('/analytics/timeslot', { params }),

  /**
   * 月度同比环比接口：按门店逐月同比/环比
   * 对应后端：GET /api/analytics/monthly-compare
   *
   * @param metric 'amount'(营业额) | 'tc'(订单数) | 'ac'(客单价)
   */
  getMonthlyCompare: (params: { year?: number; store_id?: string; channel?: Channel; metric?: string }) =>
    client.get<never, MonthlyCompareResponse>('/analytics/monthly-compare', { params }),

  /**
   * 单店详情接口：注意是"路径参数"而非查询参数
   * 对应后端：GET /api/analytics/store-detail/:id
   *
   * 【路径参数 vs 查询参数的区别】
   *   路径参数：/analytics/store-detail/MD00001   → storeId 在 URL 路径里
   *   查询参数：/analytics/overview?store_id=MD00001 → storeId 在 ? 后面
   *
   * @param storeId 门店ID，如 'MD00001'
   * @param params  { month, channel } 通过查询参数传递
   */
  getStoreDetail: (storeId: string, params: { month?: string; channel?: Channel }) =>
    client.get<never, StoreDetailResponse>(`/analytics/store-detail/${storeId}`, { params }),

  /**
   * 品项排行接口：指定月份品项销量 Top N
   * 对应后端：GET /api/analytics/products
   */
  getProducts: (params: { month?: string; store_id?: string; category?: string; limit?: number }) =>
    client.get<never, ProductsResponse>('/analytics/products', { params }),

  /**
   * 门店列表接口：用于顶部筛选栏的门店下拉选项
   * 对应后端：GET /api/analytics/stores
   * @returns StoreOption[] 门店数组
   */
  getStores: () =>
    client.get<never, StoreOption[]>('/analytics/stores'),
}
