import { ref, shallowRef } from 'vue'
import { loadOutlines } from './useCurationData.js'

// The wing-outlines map, shared by every card. Fetched the first time the toggle
// is turned on; kept in a shallowRef so Vue never walks its ~12,000 photos.
const outlinePhotos = shallowRef(null)
// idle | loading | ready | empty (not published yet) | error
const outlineStatus = ref('idle')

export function ensureOutlines() {
  if (outlineStatus.value === 'loading' || outlineStatus.value === 'ready' || outlineStatus.value === 'empty') return
  outlineStatus.value = 'loading'
  loadOutlines()
    .then(photos => {
      outlinePhotos.value = photos
      outlineStatus.value = Object.keys(photos).length ? 'ready' : 'empty'
    })
    .catch(() => { outlineStatus.value = 'error' })
}

export function useWingOutlines() {
  return { outlinePhotos, outlineStatus, ensureOutlines }
}
