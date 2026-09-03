import { predictionRank } from './taxonomy.js'

export function hasAnyPhoto(item) {
  const hasLegacy = item.URLd || item.URLv
  const hasList = item.all_photos && item.all_photos.length > 0
  return Boolean(hasLegacy || hasList)
}

export function resolveCamid(item) {
  const explicit = String(item?.CAM_ID || '').trim()
  if (explicit) return explicit
  const names = (item?.all_photos || []).map(photo => photo?.Name)
  if (item?.Photo_dorsal) names.push(item.Photo_dorsal)
  if (item?.Photo_ventral) names.push(item.Photo_ventral)
  for (const name of names) {
    const match = String(name || '').match(/^(CAM\d+)/i)
    if (match) return match[1].toUpperCase()
  }
  return null
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
export function modelConfidence(item, predictions, rank = 'species') {
  const pred = predictions && predictions[resolveCamid(item)]
  const top = predictionRank(pred, rank)
  return (top && typeof top.confidence === 'number') ? top.confidence : -1
}

export function sortItems(items, sortBy, sortOrder, predictions, reviewRank = 'species') {
  if (sortBy === 'Row Number') return items

  if (sortBy === 'ModelConfidence') {
    if (!predictions) return items   // map not loaded -> leave order untouched
    return items.slice().sort((a, b) => {
      const d = modelConfidence(a, predictions, reviewRank) - modelConfidence(b, predictions, reviewRank)
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

  return sortItems(results, options.sortBy, options.sortOrder, options.predictions, options.reviewRank)
}
