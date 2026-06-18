import { reactive, toRefs } from 'vue'

const state = reactive({
  columns: 'Auto',
  sortBy: 'Preservation_date',
  sortOrder: 'desc',
  side: 'Dorsal and Ventral',
  onlyPhotos: true,
  onePerSubspecies: false,
  // --- Curation tools (off by default; compact-by-default UI) ---
  showBoxes: false,        // Feature 1: wing-box SVG overlays
  zoomWings: false,        // Feature 1: zoom each image to its wings
  showPredictions: false   // Feature 2: model predictions panel
})

export function useGlobalGalleryOptions() {
  return toRefs(state)
}
