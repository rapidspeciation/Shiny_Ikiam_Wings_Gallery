export const CURRENT_PREDICTION_FILES = {
  expanded: 'predictions_expanded_concat_dv',
  coverage: 'predictions_coverage_current',
  live: 'predictions_live_real'
}

export function mergeCurrentPredictionMaps({ expanded = {}, coverage = {}, live = {} }) {
  return { ...live, ...coverage, ...expanded }
}

export async function loadCurrentPredictionMaps(loadFile, isMissingAsset = error => error?.status === 404) {
  const coverage = loadFile(CURRENT_PREDICTION_FILES.coverage).catch(error => {
    if (isMissingAsset(error)) return {}
    throw error
  })
  const [expanded, currentCoverage, live] = await Promise.all([
    loadFile(CURRENT_PREDICTION_FILES.expanded),
    coverage,
    loadFile(CURRENT_PREDICTION_FILES.live)
  ])
  return mergeCurrentPredictionMaps({ expanded, coverage: currentCoverage, live })
}
