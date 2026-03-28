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

function _getCachedEntry(key) {
  if (!key) return null
  const entry = _cache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry
  return null
}

export function useApi(fetcher, deps = [], cacheKey = null) {
  const entry = _getCachedEntry(cacheKey)
  const [data,        setData]        = useState(entry?.data ?? null)
  const [loading,     setLoading]     = useState(entry === null)
  const [error,       setError]       = useState(null)
  const [lastUpdated, setLastUpdated] = useState(entry?.ts ?? null)

  const load = useCallback(async (force = false) => {
    const hit = _getCachedEntry(cacheKey)
    if (!force && hit !== null) { setData(hit.data); setLastUpdated(hit.ts); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      const ts = Date.now()
      if (cacheKey) _cache.set(cacheKey, { data: result, ts })
      setData(result)
      setLastUpdated(ts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => { load() }, [load])

  const refresh = useCallback(() => {
    if (cacheKey) _cache.delete(cacheKey)
    load(true)
  }, [cacheKey, load])

  return { data, loading, error, reload: load, refresh, lastUpdated }
}
