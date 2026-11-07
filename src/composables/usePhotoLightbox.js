// Shared state for the photo lightbox (PhotoLightbox.vue, mounted once in App.vue).
// A gallery photo opens it large; closing returns focus to that photo.
import { reactive } from 'vue'

const state = reactive({ open: false, src: '', alt: '', caption: '', returnFocus: null })

export function usePhotoLightbox() {
  function openLightbox({ src, alt = '', caption = '' }) {
    if (!src) return
    state.returnFocus = typeof document !== 'undefined' ? document.activeElement : null
    Object.assign(state, { src, alt, caption, open: true })
  }
  function closeLightbox() {
    if (!state.open) return
    state.open = false
    const el = state.returnFocus
    state.returnFocus = null
    el?.focus?.({ preventScroll: true })
  }
  return { state, openLightbox, closeLightbox }
}
