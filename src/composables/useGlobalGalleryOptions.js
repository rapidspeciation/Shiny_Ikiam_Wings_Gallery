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
  expandPredictions: false // Feature 2: open + fully expand every prediction panel
  // (predictions panel is always present per card, collapsed by default — no toggle)
})

export function useGlobalGalleryOptions() {
  return toRefs(state)
}
