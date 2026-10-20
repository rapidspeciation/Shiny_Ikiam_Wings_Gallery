import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CURRENT_PREDICTION_FILES,
  loadCurrentPredictionMaps,
  mergeCurrentPredictionMaps,
  predictionFitNote,
  predictionProvenance
} from '../src/utils/predictionCoverage.js'
import { oofRows } from '../scripts/build-oof-predictions.mjs'

test('current prediction maps prefer expanded rows, then coverage, then live inference', () => {
  const merged = mergeCurrentPredictionMaps({
    expanded: { CAM1: { source: 'expanded' } },
    coverage: { CAM1: { source: 'coverage' }, CAM2: { source: 'coverage' } },
    live: {
      CAM1: { source: 'live' },
      CAM2: { source: 'live' },
      CAM3: { source: 'live' }
    }
  })

  assert.deepEqual(merged, {
    CAM1: { source: 'expanded' },
    CAM2: { source: 'coverage' },
    CAM3: { source: 'live' }
  })
})

test('the Database Manager readings fill specimens below the release, above live inference', () => {
  const merged = mergeCurrentPredictionMaps({
    expanded: { CAM1: { source: 'expanded' } },
    coverage: { CAM2: { source: 'coverage' } },
    app: { CAM1: { source: 'app' }, CAM2: { source: 'app' }, CAM3: { source: 'app' }, CAM4: { source: 'app' } },
    live: { CAM3: { source: 'live' }, CAM5: { source: 'live' } }
  })
  assert.deepEqual(merged, {
    CAM1: { source: 'expanded' },
    CAM2: { source: 'coverage' },
    CAM3: { source: 'app' },
    CAM4: { source: 'app' },
    CAM5: { source: 'live' }
  })
})

test('a missing or broken readings file leaves the release predictions', async () => {
  for (const failure of [Object.assign(new Error('missing'), { status: 404 }), new SyntaxError('Unexpected token <')]) {
    const load = async name => {
      if (name === CURRENT_PREDICTION_FILES.app) throw failure
      if (name === CURRENT_PREDICTION_FILES.expanded) return { CAM1: { source: 'expanded' } }
      return {}
    }
    assert.deepEqual(await loadCurrentPredictionMaps(load), { CAM1: { source: 'expanded' } })
  }
})

test('missing optional coverage asset does not fall back to predictions.json', async () => {
  const requested = []
  const maps = {
    [CURRENT_PREDICTION_FILES.expanded]: { CAM1: { source: 'expanded' } },
    [CURRENT_PREDICTION_FILES.live]: { CAM2: { source: 'live' } }
  }
  const load = async name => {
    requested.push(name)
    if (name === CURRENT_PREDICTION_FILES.coverage) throw Object.assign(new Error('missing'), { status: 404 })
    return maps[name]
  }

  assert.deepEqual(await loadCurrentPredictionMaps(load), {
    CAM1: { source: 'expanded' },
    CAM2: { source: 'live' }
  })
  assert.deepEqual(new Set(requested), new Set(Object.values(CURRENT_PREDICTION_FILES)))
  assert.equal(requested.includes('predictions'), false)
})

test('prediction loading rejects network failures instead of producing a false empty map', async () => {
  const load = async name => {
    if (name === CURRENT_PREDICTION_FILES.expanded) throw new TypeError('network failed')
    return {}
  }

  await assert.rejects(loadCurrentPredictionMaps(load), /network failed/)
})

const role = r => ({ model_meta: { attention_training_role: r, oof: false }, oof: 0 })

test('out-of-fold predictions win over in-sample ones, per specimen, without losing coverage', () => {
  const trainRow = role('train')
  const testRow = role('test')
  const oofRow = { source: 'oof', oof: 1 }
  const appOof = { model_meta: { oof: true } }
  const appFinal = { model_meta: { oof: false } }
  const merged = mergeCurrentPredictionMaps({
    oof: { CAM1: oofRow },
    expanded: { CAM1: trainRow, CAM2: trainRow, CAM3: testRow, CAM4: trainRow },
    coverage: { CAM5: { model_meta: { oof: false } } },
    app: { CAM2: appOof, CAM3: appOof, CAM5: appOof, CAM6: appFinal, CAM7: appFinal },
    live: { CAM7: { mode: 'live_real' }, CAM8: { mode: 'live_real' } }
  })
  // an in-sample paired row loses to predictions.json's out-of-fold row, and to the app's out-of-fold readings
  assert.equal(merged.CAM1, oofRow)
  assert.equal(merged.CAM2, appOof)
  // the paired head's held-out rows come before the app's
  assert.equal(merged.CAM3, testRow)
  // a specimen with only an in-sample row keeps it
  assert.equal(merged.CAM4, trainRow)
  assert.equal(merged.CAM5, appOof)
  assert.equal(merged.CAM6, appFinal)
  assert.equal(merged.CAM7, appFinal)
  assert.deepEqual(Object.keys(merged).sort(), ['CAM1', 'CAM2', 'CAM3', 'CAM4', 'CAM5', 'CAM6', 'CAM7', 'CAM8'])
  assert.deepEqual(predictionProvenance(merged.CAM1), { file: 'oof', fit: 'oof' })
  assert.deepEqual(predictionProvenance(merged.CAM4), { file: 'expanded', fit: 'final_fit' })
  assert.equal(predictionFitNote(merged.CAM1).badge, '')
  assert.match(predictionFitNote(merged.CAM1).title, /^Out-of-fold/)
  assert.equal(predictionFitNote(merged.CAM4).badge, 'final fit')
  assert.equal(predictionFitNote(null).badge, '')
})

test('a missing out-of-fold file leaves the other files in their order', async () => {
  const load = async name => {
    if (name === CURRENT_PREDICTION_FILES.oof) throw Object.assign(new Error('missing'), { status: 404 })
    if (name === CURRENT_PREDICTION_FILES.expanded) return { CAM1: role('train') }
    return {}
  }
  assert.deepEqual(Object.keys(await loadCurrentPredictionMaps(load)), ['CAM1'])
})

test('predictions_oof.json holds exactly the out-of-fold rows of predictions.json, with what the panel reads', () => {
  const full = JSON.parse(readFileSync('public/data/predictions.json', 'utf8'))
  const slim = JSON.parse(readFileSync('public/data/predictions_oof.json', 'utf8'))
  const want = Object.keys(full).filter(c => full[c].oof === 1).sort()
  assert.deepEqual(Object.keys(slim).sort(), want)
  assert.deepEqual(slim, oofRows(full))
  for (const camid of want.slice(0, 50)) {
    const a = full[camid], b = slim[camid]
    assert.equal(b.species[0][0], a.species[0][0])
    assert.equal(b.subspecies[0][0], a.subspecies[0][0])
    assert.equal(b.rank_predictions.species.prediction, a.rank_predictions.species.prediction)
    assert.equal(b.model_meta.oof, true)
  }
})
