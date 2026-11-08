// Shared state for the photo lightbox (PhotoLightbox.vue, mounted once in App.vue).
// A gallery photo opens it large with the card's other photos (dorsal, ventral) one
// arrow key away; closing returns focus to that photo.
import { reactive, computed } from 'vue'

const state = reactive({ open: false, photos: [], index: 0, returnFocus: null })

const current = computed(() => state.photos[state.index] || { src: '', alt: '', caption: '' })

export function usePhotoLightbox() {
  // photos: [{ src, alt, caption }]; a single { src, alt, caption } also works
  function openLightbox({ photos, index = 0, src, alt = '', caption = '' }) {
    const list = (photos && photos.length ? photos : [{ src, alt, caption }]).filter(p => p && p.src)
    if (!list.length) return
    state.returnFocus = typeof document !== 'undefined' ? document.activeElement : null
    Object.assign(state, { photos: list, index: Math.min(Math.max(index, 0), list.length - 1), open: true })
  }
  function step(delta) {
    const n = state.photos.length
    if (n > 1) state.index = (state.index + delta + n) % n
  }
  function closeLightbox() {
    if (!state.open) return
    state.open = false
    const el = state.returnFocus
    state.returnFocus = null
    el?.focus?.({ preventScroll: true })
  }
  return { state, current, openLightbox, step, closeLightbox }
}
