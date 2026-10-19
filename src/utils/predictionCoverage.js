export const CURRENT_PREDICTION_FILES = {
  expanded: 'predictions_expanded_concat_dv',
  coverage: 'predictions_coverage_current',
  // the Database Manager's readings (update_data.yml downloads them); optional
  app: 'predictions_app',
  live: 'predictions_live_real'
}

export function mergeCurrentPredictionMaps({ expanded = {}, coverage = {}, app = {}, live = {} }) {
  return { ...live, ...app, ...coverage, ...expanded }
}

export async function loadCurrentPredictionMaps(loadFile, isMissingAsset = error => error?.status === 404) {
  const coverage = loadFile(CURRENT_PREDICTION_FILES.coverage).catch(error => {
    if (isMissingAsset(error)) return {}
    throw error
  })
  // Not published yet, or a copy that does not parse: the release alone still works.
  const app = loadFile(CURRENT_PREDICTION_FILES.app).catch(() => ({}))
  const [expanded, currentCoverage, appReadings, live] = await Promise.all([
    loadFile(CURRENT_PREDICTION_FILES.expanded),
    coverage,
    app,
    loadFile(CURRENT_PREDICTION_FILES.live)
  ])
  return mergeCurrentPredictionMaps({ expanded, coverage: currentCoverage, app: appReadings, live })
}
