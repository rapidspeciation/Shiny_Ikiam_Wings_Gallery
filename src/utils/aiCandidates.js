// Small helpers for the AI Identifier results view, built from rankLeaves()
// output (so they already reflect the current geographic re-rank). The tree
// itself lives in taxonTree.js. Unit tested in tests/ai-candidates.test.mjs.

// Below this top-species probability the results show the "Uncertain" banner.
export const LOW_CONFIDENCE = 0.5

export function fmtPct(p) {
  if (typeof p !== 'number' || Number.isNaN(p)) return ''
  if (p > 0 && p < 0.005) return '<1%'
  return `${Math.round(p * 100)}%`
}

// Probability + off-region flag of a genus, species or subspecies in the ranked prediction.
export function taxonInfo(pred, taxon) {
  if (!pred || !taxon) return null
  for (const [sp, p, oor, subs] of pred.species || []) {
    if (sp === taxon) return { taxon, prob: p, oor: !!oor, rank: 'species' }
    for (const [ss, sp2, o2] of subs || []) if (ss === taxon) return { taxon, prob: sp2, oor: !!o2, rank: 'subspecies' }
  }
  for (const [ss, p, oor] of pred.subspecies_all || pred.subspecies || []) if (ss === taxon) return { taxon, prob: p, oor: !!oor, rank: 'subspecies' }
  for (const [sp, p, oor] of pred.species_all || []) if (sp === taxon) return { taxon, prob: p, oor: !!oor, rank: 'species' }
  for (const [g, p, oor] of pred.genus_all || pred.genus || []) if (g === taxon) return { taxon, prob: p, oor: !!oor, rank: 'genus' }
  return null
}

// Banner text when the top species is a weak call ('' when it is not).
export function lowConfidenceMessage(pred, hasLocation = false) {
  const top = pred?.species?.[0]
  if (!top || typeof top[1] !== 'number' || !(top[1] < LOW_CONFIDENCE)) return ''
  let msg = `Uncertain: the top guess is only ${fmtPct(top[1])}. Compare the candidates below before trusting it.`
  if (!hasLocation) msg += ' Selecting where the photo was taken can help.'
  return msg
}
