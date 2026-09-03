// Shared taxonomy comparison rules for candidate-D review.  The immutable
// recorded fields and model fields stay separate; this module only supplies
// canonical labels for comparison and display.

export const REVIEW_RANKS = ['genus', 'species', 'subspecies']
export const AUDIT_RANKS = ['family', 'subfamily', 'tribe', ...REVIEW_RANKS]

export const TAXON_ALIASES = Object.freeze({
  'vanessa brasiliensis': 'Vanessa braziliensis',
  'oleria onega jaranilla': 'Oleria onega janarilla'
})

function clean(value) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim().replace(/\s+/g, ' ')
  return ['', 'na', 'none', 'null'].includes(text.toLowerCase()) ? '' : text
}

export function canonicalTaxon(value) {
  const text = clean(value)
  return TAXON_ALIASES[text.toLowerCase()] || text
}

function firstValue(item, ...keys) {
  for (const key of keys) {
    const value = clean(item?.[key])
    if (value) return value
  }
  return ''
}

// Collection, insectary, and CRISPR rows use slightly different field names.
// This fallback is intentionally record-only: it never reads model truth.
export function recordedTaxonomy(item = {}) {
  const full = firstValue(item, 'SPECIES', 'Stock_of_origin')
  const fullParts = full.split(/\s+/)
  let species = firstValue(item, 'Species')
  let subspecies = firstValue(item, 'Subspecies_Form')
  if (!species && fullParts.length >= 2) species = fullParts.slice(0, 2).join(' ')
  if (!subspecies && fullParts.length >= 3) subspecies = fullParts.slice(2).join(' ')
  let genus = firstValue(item, 'Genus') || species.split(/\s+/)[0] || fullParts[0] || ''
  genus = canonicalTaxon(genus)
  species = canonicalTaxon(species)
  subspecies = canonicalTaxon(subspecies)
  if (species && genus && species.toLowerCase().startsWith(`${genus.toLowerCase()} `)) {
    species = `${genus} ${species.slice(genus.length + 1).trim()}`
  }
  if (subspecies && species && !subspecies.toLowerCase().startsWith(`${species.toLowerCase()} `)) {
    subspecies = `${species} ${subspecies}`
  }
  // Apply full-name overlays after expanding a bare recorded epithet.
  subspecies = canonicalTaxon(subspecies)
  return {
    family: canonicalTaxon(firstValue(item, 'Family', ' Family')),
    subfamily: canonicalTaxon(firstValue(item, 'Subfamily')),
    tribe: canonicalTaxon(firstValue(item, 'Tribe')),
    genus,
    species,
    subspecies
  }
}

export function predictionRank(pred, rank) {
  if (!pred) return null
  const verified = pred.rank_predictions?.[rank]
  if (verified && typeof verified === 'object' && !Array.isArray(verified)) {
    return {
      label: canonicalTaxon(verified.prediction),
      rawLabel: clean(verified.prediction),
      confidence: typeof verified.confidence === 'number' ? verified.confidence : null,
      top5Correct: verified.top5_correct === true,
      top5Available: verified.top5_available === true,
      top5LabelsAvailable: verified.top5_labels_available === true
    }
  }
  const row = Array.isArray(pred[rank]) ? pred[rank][0] : null
  if (!Array.isArray(row) || !row[0]) return null
  return {
    label: canonicalTaxon(row[0]),
    rawLabel: clean(row[0]),
    confidence: typeof row[1] === 'number' ? row[1] : null,
    top5Correct: null,
    top5Available: false,
    top5LabelsAvailable: false
  }
}

function recordedFromPrediction(pred) {
  if (pred?.recorded_taxonomy?.canonical) return pred.recorded_taxonomy.canonical
  if (pred?.rec) {
    return {
      genus: canonicalTaxon(pred.rec.genus),
      species: canonicalTaxon(pred.rec.species),
      subspecies: canonicalTaxon(pred.rec.subsp)
    }
  }
  return null
}

export function rankComparison(item, pred, rank) {
  const itemRecorded = recordedTaxonomy(item)
  const predRecorded = recordedFromPrediction(pred)
  const recorded = canonicalTaxon(predRecorded?.[rank] || itemRecorded[rank])
  let recordedRaw = clean(pred?.recorded_taxonomy?.raw?.[rank]) || recorded
  // The source records often store a bare subspecies epithet while the frozen
  // model call is a full trinomial.  Expand that formatting variant before
  // deciding whether a difference is a true synonym-only change.
  if (rank === 'subspecies' && recordedRaw && recordedRaw.split(/\s+/).length < 3) {
    const species = predRecorded?.species || itemRecorded.species
    if (species && !recordedRaw.toLowerCase().startsWith(`${species.toLowerCase()} `)) {
      recordedRaw = `${species} ${recordedRaw}`
    }
  }
  const model = predictionRank(pred, rank)
  if (!model || !recorded) {
    return {
      rank,
      recorded,
      recordedRaw,
      predicted: model?.label || '',
      predictedRaw: model?.rawLabel || '',
      confidence: model?.confidence ?? null,
      top5Correct: model?.top5Correct ?? null,
      top5Available: model?.top5Available ?? false,
      top5LabelsAvailable: model?.top5LabelsAvailable ?? false,
      status: 'missing',
      canonicalEqual: false,
      synonymOnly: false
    }
  }
  const canonicalEqual = model.label.toLowerCase() === recorded.toLowerCase()
  const synonymOnly = canonicalEqual && model.rawLabel.toLowerCase() !== recordedRaw.toLowerCase()
  return {
    rank,
    recorded,
    recordedRaw,
    predicted: model.label,
    predictedRaw: model.rawLabel,
    confidence: model.confidence,
    top5Correct: model.top5Correct,
    top5Available: model.top5Available,
    top5LabelsAvailable: model.top5LabelsAvailable,
    status: synonymOnly ? 'synonym-only' : (canonicalEqual ? 'agreement' : 'disagreement'),
    canonicalEqual,
    synonymOnly
  }
}

export function predictionDiffers(item, pred, rank = 'species') {
  return rankComparison(item, pred, rank).status === 'disagreement'
}

export function modelLabel(pred, rank = 'species') {
  return predictionRank(pred, rank)?.label || ''
}
