import { ref, computed, watch } from 'vue'
import { applyGlobalPipeline } from '../utils/galleryPipeline.js'

const PAGE_SIZE = 200

export function useGallery(rawData, options) {
  // --- State ---
  const isFiltered = ref(false)      // Has "Show Photos" been clicked?
  const allMatches = ref([])         // All items matching filters
  const displayedCount = ref(PAGE_SIZE)    // How many are currently rendered
  const lastFilterFn = ref(null)

  const { sortBy, sortOrder, side, onlyPhotos, onePerSubspecies } = options

  // --- Actions ---

  // 1. Filter & Sort Trigger
  const applyFilters = (filterFn) => {
    lastFilterFn.value = filterFn
    // A. Run the specific filter function provided by the Tab
    let results = rawData.value.filter(item => filterFn(item))
    results = applyGlobalPipeline(results, {
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      onlyPhotos: onlyPhotos.value,
      onePerSubspecies: onePerSubspecies.value
    })

    // B. Reset Pagination and Update State
    allMatches.value = results
    displayedCount.value = PAGE_SIZE
    isFiltered.value = true
  }

  // 2. Pagination Trigger
  const loadMore = () => {
    displayedCount.value += PAGE_SIZE
  }

  // --- Computed ---

  // Returns only the slice of data we should render
  const paginatedData = computed(() => {
    return allMatches.value.slice(0, displayedCount.value)
  })

  const hasMore = computed(() => {
    return displayedCount.value < allMatches.value.length
  })

  watch(
    () => [sortBy.value, sortOrder.value, onlyPhotos.value, onePerSubspecies.value],
    () => {
      if (isFiltered.value && lastFilterFn.value) {
        applyFilters(lastFilterFn.value)
      }
    }
  )

  return {
    isFiltered,
    allMatches,
    paginatedData,
    hasMore,
    loadMore,
    applyFilters
  }
}
