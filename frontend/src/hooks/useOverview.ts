import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { OverviewData } from '@/types/api'

interface Params {
  month: string
  store_id?: string
}

export function useOverview(params: Params) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.month) return
    setLoading(true)
    setError(null)
    analyticsApi.getOverview({ month: params.month, store_id: params.store_id })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.month, params.store_id])

  return { data, loading, error }
}
