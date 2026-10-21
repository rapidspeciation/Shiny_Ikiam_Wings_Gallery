import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('published sex release uses the androconial-strip CNN OOF scores and states upload limitation',()=>{
 const rows=JSON.parse(read('public/data/sex_predictions.json'))
 assert.equal(Object.keys(rows).length,3809)
 assert.ok(Object.values(rows).every(r=>r.model_arm.startsWith('release_20261019 cnn_strips4')))
 assert.equal(Object.values(rows).filter(r=>r.oof).length,3462)
 assert.equal(Object.values(rows).filter(r=>r.supported).length,1828)
 assert.equal(rows.CAM077376.sex,'female')
 assert.equal(rows.CAM070978.sex,'female')
 assert.equal(rows.CAM070978.supported,true)
 assert.equal(Object.values(rows).filter(r=>r.evaluation_provenance.partition==='unlabelled_target').length,347)
  const about=read('src/components/AIIdTab.vue')
 assert.match(about,/Sex prediction is not yet supported for uploaded photos\./)
 assert.match(about,/94\.0%/)
 assert.match(about,/3,462/)
 assert.doesNotMatch(about,/Review candidates \(CSV\)|Taxon reliability \(CSV\)/)
})
