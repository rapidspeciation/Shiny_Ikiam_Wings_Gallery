import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('published sex release uses verified wing-part OOF scores and states upload limitation',()=>{
 const rows=JSON.parse(read('public/data/sex_predictions.json'))
 assert.equal(Object.keys(rows).length,1220)
 assert.ok(Object.values(rows).every(r=>r.oof && r.model_arm==='VF_DH_PARTS'))
 assert.equal(Object.values(rows).filter(r=>r.supported).length,274)
 assert.equal(rows.CAM077376.sex,'female')
 const about=read('src/components/AIIdTab.vue')
 assert.match(about,/Sex prediction is not yet supported in AI Identifier\./)
 assert.match(about,/89\.7%/)
 assert.match(about,/1,220/)
 assert.doesNotMatch(about,/Review candidates \(CSV\)|Taxon reliability \(CSV\)/)
})
