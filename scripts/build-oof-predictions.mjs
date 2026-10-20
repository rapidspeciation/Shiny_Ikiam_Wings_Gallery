// predictions_oof.json: the out-of-fold rows of predictions.json (candidate D, group-safe Sanger folds: each
// specimen scored by a head that never trained on it), with only the fields the gallery reads, so the browser
// does not fetch predictions.json's 49 MB. The gallery shows these before any final-fit prediction
// (src/utils/predictionCoverage.js). Run again whenever predictions.json changes:
//   node scripts/build-oof-predictions.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'public', 'data')
const RANK_FIELDS = ['prediction', 'confidence', 'top5_available', 'top5_correct', 'top5_labels_available']
const round = x => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)
const roundRows = rows => (Array.isArray(rows) ? rows.map(r => (Array.isArray(r) ? r.map(v => (Array.isArray(v) ? roundRows(v) : round(v))) : r)) : rows)

export function oofRows(predictions) {
  const out = {}
  for (const camid of Object.keys(predictions).sort()) {
    const p = predictions[camid]
    if (p?.oof !== 1 && p?.oof !== true) continue
    const ranks = {}
    for (const [rank, r] of Object.entries(p.rank_predictions || {})) {
      if (r && typeof r === 'object') ranks[rank] = Object.fromEntries(RANK_FIELDS.filter(k => k in r).map(k => [k, round(r[k])]))
    }
    const rec = p.rec ? Object.fromEntries(Object.entries(p.rec).map(([k, v]) => [k, round(v)])) : undefined
    out[camid] = {
      species: roundRows(p.species),
      species_all: roundRows(p.species_all),
      subspecies: roundRows(p.subspecies),
      genus: roundRows(p.genus),
      rank_predictions: ranks,
      ...(rec ? { rec } : {}),
      side: p.side || '',
      n_views: p.n_views || 2,
      oof: 1,
      mode: 'oof',
      model_meta: {
        source: p.source || 'candidate_d',
        build_identity: p.model_meta?.build_identity || null,
        checkpoint_sha256: p.model_meta?.checkpoint_sha256 || null,
        oof: true,
        prediction_kind: 'out-of-fold: group-safe Sanger folds, the specimen held out of the head that scored it'
      }
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = oofRows(JSON.parse(readFileSync(resolve(root, 'predictions.json'), 'utf8')))
  writeFileSync(resolve(root, 'predictions_oof.json'), JSON.stringify(rows))
  console.log(`predictions_oof.json: ${Object.keys(rows).length} out-of-fold specimens`)
}
