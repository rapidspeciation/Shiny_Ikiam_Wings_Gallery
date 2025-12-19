import { ref } from 'vue'

const cache = new Map()

export function useDataset(key, url) {
  if (!cache.has(key)) {
    cache.set(key, {
      dataRef: ref([]),
      loadingRef: ref(false),
      errorRef: ref(null),
      promise: null,
      loaded: false,
      url
    })
  }

  const entry = cache.get(key)

  const ensureLoaded = async () => {
    if (entry.loaded) return entry.dataRef.value
    if (entry.promise) return entry.promise

    entry.loadingRef.value = true
    entry.errorRef.value = null
    entry.promise = fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load data')
        return res.json()
      })
      .then(data => {
        entry.dataRef.value = data
        entry.loaded = true
        return data
      })
      .catch(() => {
        entry.errorRef.value = 'Error loading data.'
        throw new Error('Failed to load dataset')
      })
      .finally(() => {
        entry.loadingRef.value = false
        entry.promise = null
      })

    return entry.promise
  }

  return {
    data: entry.dataRef,
    loading: entry.loadingRef,
    error: entry.errorRef,
    ensureLoaded
  }
}
