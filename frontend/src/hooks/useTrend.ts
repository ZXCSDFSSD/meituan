import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { TrendResponse, Channel } from '@/types/api'

interface Params {
  month: string          // 当前筛选月（用于计算 end_month）
  store_id?: string
  channel?: Channel
  rangeMonths?: number   // 最近 N 月，默认 6
}

export function useTrend(params: Params) {
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.month) return
    setLoading(true)
    setError(null)
    const limit = params.rangeMonths ?? 6
    analyticsApi.getTrend({
      store_id: params.store_id,
      channel: params.channel,
      end_month: params.month,
      limit,
    })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.month, params.store_id, params.channel, params.rangeMonths])

  return { data, loading, error }
}
