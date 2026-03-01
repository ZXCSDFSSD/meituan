import { useState, useEffect } from 'react'
import { analyticsApi } from '@/api'
import type { ProductsResponse } from '@/types/api'

interface Params {
  month: string
  store_id?: string
  category?: string
  limit?: number
}

export function useProducts(params: Params) {
  const [data, setData] = useState<ProductsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.month) return
    setLoading(true)
    setError(null)
    analyticsApi.getProducts({ month: params.month, store_id: params.store_id, category: params.category, limit: params.limit })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.month, params.store_id, params.category, params.limit])

  return { data, loading, error }
}
