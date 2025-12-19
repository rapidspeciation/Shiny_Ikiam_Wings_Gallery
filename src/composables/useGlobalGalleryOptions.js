import { reactive, toRefs } from 'vue'

const state = reactive({
  columns: 'Auto',
  sortBy: 'Preservation_date',
  sortOrder: 'desc',
  side: 'Dorsal and Ventral',
  onlyPhotos: true,
  onePerSubspecies: false
})

export function useGlobalGalleryOptions() {
  return toRefs(state)
}
