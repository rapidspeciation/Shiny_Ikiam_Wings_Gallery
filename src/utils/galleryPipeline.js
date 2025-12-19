export function hasAnyPhoto(item) {
  const hasLegacy = item.URLd || item.URLv
  const hasList = item.all_photos && item.all_photos.length > 0
  return Boolean(hasLegacy || hasList)
}

export function applyOnePerSubspeciesSex(items) {
  const seen = new Set()
  return items.filter(item => {
    const key = `${item.Subspecies_Form || 'None'}|${item.Sex || 'Unknown'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function sortItems(items, sortBy, sortOrder) {
  if (sortBy === 'Row Number') return items

  return items.slice().sort((a, b) => {
    let valA
    let valB

    if (sortBy === 'Preservation_date') {
      valA = new Date(a.Preservation_date_formatted || 0)
      valB = new Date(b.Preservation_date_formatted || 0)
    } else {
      valA = a[sortBy] || ''
      valB = b[sortBy] || ''
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1
    return 0
  })
}

export function applyGlobalPipeline(items, options) {
  let results = items

  if (options.onlyPhotos) {
    results = results.filter(hasAnyPhoto)
  }

  if (options.onePerSubspecies) {
    results = applyOnePerSubspeciesSex(results)
  }

  return sortItems(results, options.sortBy, options.sortOrder)
}
