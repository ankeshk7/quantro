import { useState, useEffect, useCallback } from 'react'

const _cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function invalidateCache(key) {
  if (key) _cache.delete(key)
}

/**
 * Fire-and-forget background fetch to warm the cache.
 * useApi() will find the data instantly when the tab mounts.
 */
export function prefetch(key, fetcher) {
  if (_cache.has(key)) return  // already cached
  fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now() })
  }).catch(() => {})  // silent — tab will retry on mount
}

function _getCached(key) {
  if (!key) return null
  const entry = _cache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data
  return null
}

export function useApi(fetcher, deps = [], cacheKey = null) {
  const cached = _getCached(cacheKey)
  const [data,    setData]    = useState(cached)
  const [loading, setLoading] = useState(cached === null)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    const hit = _getCached(cacheKey)
    if (hit !== null) { setData(hit); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      if (cacheKey) _cache.set(cacheKey, { data: result, ts: Date.now() })
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load }
}
