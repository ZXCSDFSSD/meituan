import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { TimeslotResponse, Channel } from '@/types/api'

interface Params {
  month: string
  store_id?: string
  channel?: Channel
}

export function useTimeslot(params: Params) {
  const [data, setData] = useState<TimeslotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.month) return
    setLoading(true)
    setError(null)
    analyticsApi.getTimeslot({ month: params.month, store_id: params.store_id, channel: params.channel })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.month, params.store_id, params.channel])

  return { data, loading, error }
}
