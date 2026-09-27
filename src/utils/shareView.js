export const VIEW_DEFAULTS = {
  columns: 'Auto', sortBy: 'Preservation_date', sortOrder: 'desc',
  side: 'Dorsal and Ventral', onlyPhotos: true, onePerSubspecies: false,
  showBoxes: false, zoomWings: false, expandPredictions: false
}
const choices = {
  columns: ['Auto', '1', '2', '3'],
  sortBy: ['Preservation_date', 'CAM_ID', 'Row Number', 'ModelConfidence', 'SexConfidence'],
  sortOrder: ['asc', 'desc'], side: ['Dorsal', 'Ventral', 'Dorsal and Ventral'],
  sex: ['male and female', 'male', 'female'],
  mutant: ['All', 'Yes', 'No', 'Check', 'NA'],
  modelVsRecorded: ['All', 'Differs', 'Matches', 'No prediction', 'Sex differs', 'Sex matches', 'No sex prediction']
}
export function readView(search, defaults) {
  const params = new URLSearchParams(search)
  const values = structuredClone(defaults)
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!params.has(key)) continue
    const value = params.get(key)
    if (Array.isArray(fallback)) values[key] = params.getAll(key).filter(Boolean)
    else if (typeof fallback === 'boolean') {
      if (['1', '0', 'true', 'false'].includes(value)) values[key] = value === '1' || value === 'true'
    } else if (!choices[key] || choices[key].includes(value)) values[key] = value || fallback
  }
  return values
}
export function writeView(url, values, defaults) {
  const result = new URL(url)
  result.search = ''
  result.searchParams.set('view', '1')
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = values[key]
    if (JSON.stringify(value) === JSON.stringify(fallback) || value == null) continue
    if (Array.isArray(value)) value.forEach(item => result.searchParams.append(key, item))
    else result.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : value)
  }
  return result.href
}
