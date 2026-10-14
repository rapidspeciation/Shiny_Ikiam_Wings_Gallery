import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { normalizeLifeStage, lifeStageNote, LIFE_STAGE_NOTES } from '../src/utils/lifeStage.js'

test('life-stage answers are validated and only flags give a note', () => {
  assert.equal(lifeStageNote(null), '')
  assert.equal(lifeStageNote({ flag: null, not_adult: 0.02 }), '')
  assert.equal(lifeStageNote({ flag: 'immature', not_adult: 0.97 }), LIFE_STAGE_NOTES.immature)
  assert.equal(lifeStageNote({ flag: 'label_or_preparation', not_adult: 0.99 }), LIFE_STAGE_NOTES.label_or_preparation)
  assert.equal(lifeStageNote({ flag: 'immature', not_adult: 'high' }), '')
  assert.equal(lifeStageNote({ flag: 'immature', not_adult: 1.5 }), '')
  assert.equal(lifeStageNote({ flag: 'nymph', not_adult: 0.9 }), '')
  assert.deepEqual(normalizeLifeStage({ flag: 'immature', not_adult: 0.8, probs: {} }), { flag: 'immature', notAdult: 0.8 })
})

test('life-stage notes are short, calm and free of em dashes', () => {
  assert.equal(LIFE_STAGE_NOTES.immature, 'This photo may show an immature stage; names are trained on adults and may be unreliable.')
  for (const note of Object.values(LIFE_STAGE_NOTES)) {
    assert.ok(note.length < 130, note)
    assert.doesNotMatch(note, /—|!|warning|error/i)
  }
})

test('the AI Identifier shows the note above the predictions and keeps it across mask switches', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const { descriptor, errors } = parse(source)
  assert.equal(errors.length, 0)
  compileScript(descriptor, { id: 'ai-identifier' })
  assert.match(descriptor.scriptSetup.content, /const lifeNote = computed\(\(\) => lifeStageNote\(active\.value\?\.lifeStage\)\)/)
  assert.match(descriptor.scriptSetup.content, /onResult: \(raw\) => \{[\s\S]*?r\.lifeStage = raw\.life_stage \|\| null/)
  assert.match(descriptor.template.content, /<div v-if="lifeNote" class="life-note" role="status">\{\{ lifeNote \}\}<\/div>\s*<div v-if="lowConfidence"/)
  assert.match(descriptor.template.content, /No wings detected, using the centre of the photo\./)
  const predict = readFileSync('src/utils/aiPredict.js', 'utf8')
  assert.match(predict, /life_stage: json\.mock \? null : normalizeLifeStage\(r\.life_stage\)/)
})
