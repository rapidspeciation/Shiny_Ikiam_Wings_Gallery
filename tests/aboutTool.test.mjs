import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
test('About shows current held-out results and dated history separately', () => {
  const about = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const current = about.split('<strong>Changelog</strong>')[0].split('About this tool')[1]
  assert.doesNotMatch(current, /<strong>\d{1,2} September 2026:<\/strong>/)
  for (const copy of ['3,829', 'Collection accuracy', 'AI Identifier accuracy',
    '<tr><td>Named subspecies</td><td>296</td><td>89.86%</td><td>98.65%</td></tr>',
    '<tr><td>Species</td><td>314</td><td>95.22%</td><td>99.04%</td></tr>',
    '<tr><td>Genus</td><td>314</td><td>98.09%</td><td>99.36%</td></tr>',
    '<tr><td>Species</td><td>4,566</td><td>85.74%</td><td>96.23%</td></tr>',
    '<tr><td>Genus</td><td>4,566</td><td>95.38%</td><td>98.45%</td></tr>',
    '12 February and 7 September 2026, after BioCLIP 2.5-H was released',
    'should not be compared with each other', 'may be slightly optimistic',
    '<strong>Sex prediction</strong>', 'Sex prediction is not yet supported for uploaded photos.',
    'single-photo head:', 'butterfly segmentation model</a>', 'collection attention model:',
    'href="https://huggingface.co/spaces/fr4nzzch/butterfly-id/blob/main/assets/wing_seg_v6.pt"',
    'href="https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/releases/tag/collection-attention-20260926"'
  ]) assert.ok(current.includes(copy), copy)
  assert.doesNotMatch(current, /Review candidates \(CSV\)|Taxon reliability \(CSV\)/)
  assert.doesNotMatch(current, /558 training-image taxon labels|first.publication|paired 95% interval/)
  for (const copy of ['<strong>26 September 2026:</strong>', '<strong>10 September 2026:</strong>', '(+0.85 pp, Top-5: 97.91%)',
    '(+0.87 pp, Top-5: 97.33%)', 'five-fold Sanger evaluation of 3,355 specimens', '<strong>9 September 2026:</strong>',
    'from 67.50% to 73.37% (+5.87 pp)', 'from 85.59% to 92.05% (+6.46 pp)', 'from 92.04% to 95.22% (+3.18 pp)',
    'from 73.37% to 73.92% (+0.55 pp)', 'from 73.92% to 85.15% (+11.23 pp)', 'Agraulis vanillae is now Dione vanillae']) assert.ok(about.includes(copy), copy)
})

test('About changelog has one entry per date and describes the spatial location prior', () => {
  const about = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const log = about.split('<strong>Changelog</strong>')[1]
  const dates = [...log.matchAll(/<strong>(\d{1,2} September 2026):<\/strong>/g)].map((m) => m[1])
  assert.equal(new Set(dates).size, dates.length, 'one changelog entry per date')
  assert.equal(dates[0], '27 September 2026')
  // reserved for model changes: no interface-only entries
  assert.doesNotMatch(log, /shared as links|Field photos now|tapping a collapsed|agreement filters|confidence sorting|zoom-to-wings/)
  const first = log.split('27 September 2026:</strong>')[1].split('26 September 2026:</strong>')[0].replace(/\s+/g, ' ')
  for (const copy of ['dated before 12 February 2026', '85.08% with no location', '87.87% with the country',
    '88.71% with coordinates', 'Costa, Sierra, Oriente, Galapagos', '3,694 field photos']) assert.ok(first.includes(copy), copy)
  assert.doesNotMatch(first, /—|licen[cs]e/i)
})

test('About text does not expose internal model names (links excluded)', () => {
  const about = readFileSync('src/components/AIIdTab.vue', 'utf8').split('About this tool')[1].replace(/href="[^"]*"/g, '')
  for (const internal of [/\bv6\b/i, /Wings-v\d/i, /wing_seg/i, /Candidate D/, /\bG1000\b|\bV1000\b|\bVF_DH_PARTS\b/]) assert.doesNotMatch(about, internal)
})
