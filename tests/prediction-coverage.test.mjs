import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_PREDICTION_FILES,
  loadCurrentPredictionMaps,
  mergeCurrentPredictionMaps
} from '../src/utils/predictionCoverage.js'

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
