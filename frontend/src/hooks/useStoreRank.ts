import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { StoreRankResponse, Channel } from '@/types/api'

interface Params {
  month: string
  channel?: Channel
}

export function useStoreRank(params: Params) {
  const [data, setData] = useState<StoreRankResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.month) return
    setLoading(true)
    setError(null)
    analyticsApi.getStoreRank({ month: params.month, channel: params.channel })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.month, params.channel])

  return { data, loading, error }
}
