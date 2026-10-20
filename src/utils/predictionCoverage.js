export const CURRENT_PREDICTION_FILES = {
  // out-of-fold rows of predictions.json (scripts/build-oof-predictions.mjs)
  oof: 'predictions_oof',
  expanded: 'predictions_expanded_concat_dv',
  coverage: 'predictions_coverage_current',
  // the Database Manager's readings (update_data.yml downloads them); optional
  app: 'predictions_app',
  live: 'predictions_live_real'
}

// Rows of the paired head (expanded) that it never trained on: its test, dev and calibration
// specimens and those absent from its training manifest. "train" rows and the production head's
// rows (no role) are in-sample.
const EXPANDED_HELD_OUT = new Set(['test', 'dev', 'cal', 'absent_from_attention_training_manifest'])

// How a row was scored: 'oof' (a model that never trained on the specimen) or 'final_fit' (the
// final head; the specimen may have been in its training). Coverage and live rows are final-fit
// heads whose training sets are not recorded per specimen, so they count as final-fit.
export function predictionFit(file, pred) {
  if (!pred) return null
  if (file === 'oof') return 'oof'
  if (file === 'expanded') return EXPANDED_HELD_OUT.has(pred.model_meta?.attention_training_role) ? 'oof' : 'final_fit'
  if (file === 'app') return pred.model_meta?.oof === true ? 'oof' : 'final_fit'
  return 'final_fit'
}

// Per specimen, the first row in this order: out-of-fold predictions before any final-fit one,
// so a specimen keeps a prediction whenever any file has one.
//   out-of-fold: predictions.json's (candidate D) > the paired head's held-out rows > the Database Manager's
//   final-fit:   the paired head's > current coverage > the Database Manager's > live released inference
export const PREDICTION_ORDER = [
  ['oof', 'oof'], ['expanded', 'oof'], ['app', 'oof'],
  ['expanded', 'final_fit'], ['coverage', 'final_fit'], ['app', 'final_fit'], ['live', 'final_fit']
]

// Which file and fit each chosen row came from (rows are the loaded files' own objects).
const provenance = new WeakMap()
export function predictionProvenance(pred) {
  return (pred && typeof pred === 'object' && provenance.get(pred)) || null
}

export function mergeCurrentPredictionMaps({ oof = {}, expanded = {}, coverage = {}, app = {}, live = {} }) {
  const maps = { oof, expanded, coverage, app, live }
  const out = {}
  for (const [file, fit] of PREDICTION_ORDER) {
    for (const [camid, pred] of Object.entries(maps[file] || {})) {
      if (out[camid] || !pred || predictionFit(file, pred) !== fit) continue
      out[camid] = pred
      if (typeof pred === 'object') provenance.set(pred, { file, fit })
    }
  }
  return out
}

export async function loadCurrentPredictionMaps(loadFile, isMissingAsset = error => error?.status === 404) {
  const optional = name => loadFile(name).catch(error => {
    if (isMissingAsset(error)) return {}
    throw error
  })
  // Not published yet, or a copy that does not parse: the release alone still works.
  const app = loadFile(CURRENT_PREDICTION_FILES.app).catch(() => ({}))
  const [oof, expanded, currentCoverage, appReadings, live] = await Promise.all([
    optional(CURRENT_PREDICTION_FILES.oof),
    loadFile(CURRENT_PREDICTION_FILES.expanded),
    optional(CURRENT_PREDICTION_FILES.coverage),
    app,
    loadFile(CURRENT_PREDICTION_FILES.live)
  ])
  return mergeCurrentPredictionMaps({ oof, expanded, coverage: currentCoverage, app: appReadings, live })
}

export const PREDICTION_FILE_LABELS = {
  oof: 'Corrected taxonomic classifier, out-of-fold',
  expanded: 'Current taxonomic classifier · paired dorsal/ventral',
  coverage: 'Current classifier coverage',
  app: 'Database Manager photo readings',
  live: 'Live released inference'
}

// The panel's header tooltip and badge for a chosen row: honest about how it was scored.
export function predictionFitNote(pred) {
  const p = predictionProvenance(pred)
  if (!p) return { title: 'Model predictions.', badge: '' }
  const source = PREDICTION_FILE_LABELS[p.file] || p.file
  return p.fit === 'oof'
    ? { title: `Out-of-fold model predictions: this specimen was scored by a model that never trained on it. Source: ${source}.`, badge: '' }
    : { title: `Final-fit model predictions: this specimen may have been in the model's training, so its scores can look surer than they are. No out-of-fold prediction exists for it. Source: ${source}.`, badge: 'final fit' }
}
