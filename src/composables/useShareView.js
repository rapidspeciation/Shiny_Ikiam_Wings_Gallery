import { onActivated, onDeactivated, onUnmounted, watch, toRaw } from 'vue'
import { useGlobalGalleryOptions } from './useGlobalGalleryOptions.js'
import { VIEW_DEFAULTS, readView, writeView } from '../utils/shareView.js'

// Each kept-alive tab owns its query while active. History navigation restores
// both filters and global controls before applying the shared result set.
export function useShareView({ slug, filters, ensureLoaded, apply }) {
  const globals = useGlobalGalleryOptions()
  const defaults = { ...VIEW_DEFAULTS, ...structuredClone(toRaw(filters.value)) }
  let active = false
  let restoring = false
  const ownsPath = () => {
    const path = window.location.pathname.replace(/\/$/, '')
    return path.endsWith('/' + slug) || (slug === 'collection' && path === import.meta.env.BASE_URL.replace(/\/$/, ''))
  }
  const values = () => ({ ...Object.fromEntries(Object.keys(VIEW_DEFAULTS).map(k => [k, globals[k].value])), ...filters.value })
  const shareUrl = () => {
    const url = writeView(window.location.href, values(), defaults)
    window.history.replaceState(window.history.state, '', url)
    return url
  }
  const restore = async (event) => {
    if (!active || !ownsPath()) return
    restoring = true
    const search = window.location.search
    try {
      const params = new URLSearchParams(search)
      const shared = event?.type === 'popstate' || params.has('view') || Object.keys(defaults).some(k => params.has(k))
      if (shared) {
        const restored = readView(search, defaults)
        if (slug !== 'collection' && ['ModelConfidence', 'SexConfidence'].includes(restored.sortBy)) restored.sortBy = VIEW_DEFAULTS.sortBy
        for (const key of Object.keys(VIEW_DEFAULTS)) globals[key].value = restored[key]
        for (const key of Object.keys(filters.value)) filters.value[key] = restored[key]
      }
      await ensureLoaded()
      if (active && ownsPath() && window.location.search === search && shared) await apply()
      if (active && ownsPath() && !shared && JSON.stringify(values()) !== JSON.stringify(defaults)) shareUrl()
    } catch {
      // Dataset components display their own load errors; leave the shared URL intact for retry.
    } finally { restoring = false }
  }
  watch(values, () => {
    if (active && !restoring && ownsPath()) shareUrl()
  }, { deep: true, flush: 'post' })
  onActivated(() => { active = true; restore() })
  onDeactivated(() => { active = false })
  window.addEventListener('popstate', restore)
  onUnmounted(() => window.removeEventListener('popstate', restore))
  return { shareUrl }
}
