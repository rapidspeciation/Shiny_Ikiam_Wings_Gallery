import { ref, computed } from 'vue'

export function useGallery(rawData) {
  // --- State ---
  const isFiltered = ref(false)      // Has "Show Photos" been clicked?
  const allMatches = ref([])         // All items matching filters
  const displayedCount = ref(200)    // How many are currently rendered

  // Options
  const sortBy = ref('Preservation_date')
  const sortOrder = ref('desc')
  const side = ref('Dorsal and Ventral')
  const onlyPhotos = ref(true)
  const onePerSubspecies = ref(false)

  // --- Actions ---

  // 1. Filter & Sort Trigger
  const applyFilters = (filterFn) => {
    // A. Run the specific filter function provided by the Tab
    let results = rawData.value.filter(item => {
      
      // Global check: Only Photos
      if (onlyPhotos.value) {
        // Check for legacy D/V links OR the new list of all photos
        const hasLegacy = item.URLd || item.URLv
        const hasList = item.all_photos && item.all_photos.length > 0
        
        // If neither exists, filter this item out
        if (!hasLegacy && !hasList) return false
      }

      // Run specific tab logic
      return filterFn(item)
    })

    // B. Apply "One Per Subspecies"
    if (onePerSubspecies.value) {
      const seen = new Set()
      results = results.filter(item => {
        // Create a unique key based on Subspecies + Sex
        const key = `${item.Subspecies_Form || 'None'}|${item.Sex || 'Unknown'}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    // C. Sort
    results.sort((a, b) => {
      let valA, valB

      if (sortBy.value === 'Row Number') return 0

      if (sortBy.value === 'Preservation_date') {
        // Parse dates (handling potential formats)
        // We default to 0 (epoch) if date is missing so they drop to bottom/top
        valA = new Date(a.Preservation_date_formatted || 0)
        valB = new Date(b.Preservation_date_formatted || 0)
      } else {
        // String sort (CAM_ID, etc)
        valA = a[sortBy.value] || ''
        valB = b[sortBy.value] || ''
      }

      if (valA < valB) return sortOrder.value === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder.value === 'asc' ? 1 : -1
      return 0
    })

    // D. Reset Pagination and Update State
    allMatches.value = results
    displayedCount.value = 200
    isFiltered.value = true
  }

  // 2. Pagination Trigger
  const loadMore = () => {
    displayedCount.value += 200
  }

  // --- Computed ---

  // Returns only the slice of data we should render
  const paginatedData = computed(() => {
    return allMatches.value.slice(0, displayedCount.value)
  })

  const hasMore = computed(() => {
    return displayedCount.value < allMatches.value.length
  })

  return {
    isFiltered,
    allMatches,
    paginatedData,
    hasMore,
    loadMore,
    applyFilters,
    // Options exposed for UI binding
    sortBy,
    sortOrder,
    side,
    onlyPhotos,
    onePerSubspecies
  }
}