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

// Model's top-species confidence for a row, or -1 if it has no prediction.
// Pairs with the "Differs" filter: sort desc to surface the model's most
// confident disagreements (the clearest mislabel candidates) first.
function modelConfidence(item, predictions) {
  const pred = predictions && predictions[item.CAM_ID]
  const top = pred && pred.species && pred.species[0]
  return (top && typeof top[1] === 'number') ? top[1] : -1
}

export function sortItems(items, sortBy, sortOrder, predictions) {
  if (sortBy === 'Row Number') return items

  if (sortBy === 'ModelConfidence') {
    if (!predictions) return items   // map not loaded -> leave order untouched
    return items.slice().sort((a, b) => {
      const d = modelConfidence(a, predictions) - modelConfidence(b, predictions)
      return sortOrder === 'asc' ? d : -d
    })
  }

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

  return sortItems(results, options.sortBy, options.sortOrder, options.predictions)
}
