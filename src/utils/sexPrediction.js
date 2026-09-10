const VALID_SEXES = new Set(['male', 'female'])

export function normalizeSex(value) {
  const sex = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_SEXES.has(sex) ? sex : null
}

export function normalizeSexPrediction(value) {
  if (!value || typeof value !== 'object') return null
  const sex = normalizeSex(value.sex)
  const confidence = value.confidence
  if (!sex || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  const species = typeof value.species === 'string' && value.species.trim()
    ? value.species.trim()
    : null
  return { sex, confidence, supported: value.supported === true && confidence >= 0.8, species }
}

export function sexComparison(item, prediction) {
  const predicted = normalizeSexPrediction(prediction)
  if (!predicted) return 'no-prediction'
  const recorded = normalizeSex(item?.Sex)
  if (!recorded) return 'uncomparable'
  return predicted.sex === recorded ? 'matches' : 'differs'
}

export function matchesSexFilter(item, prediction, filter) {
  const comparison = sexComparison(item, prediction)
  if (filter === 'Sex matches') return comparison === 'matches'
  if (filter === 'Sex differs') return comparison === 'differs'
  if (filter === 'No sex prediction') return comparison === 'no-prediction'
  return true
}

function comparableSpecies(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : ''
}

export function formatSexPrediction(value, recordedSpecies = '') {
  const prediction = normalizeSexPrediction(value)
  if (!prediction) return null
  const sex = prediction.sex[0].toUpperCase() + prediction.sex.slice(1)
  const confidence = `${Math.round(prediction.confidence * 100)}%`
  const recorded = comparableSpecies(recordedSpecies)
  const conditioned = comparableSpecies(prediction.species)
  const speciesStillMatches = !conditioned || recorded === conditioned
  const supported = prediction.supported && speciesStillMatches
  const evidence = supported ? 'Supported' : 'Uncertain'
  return { ...prediction, supported, text: `Predicted sex: ${sex} · ${confidence} · ${evidence}` }
}
