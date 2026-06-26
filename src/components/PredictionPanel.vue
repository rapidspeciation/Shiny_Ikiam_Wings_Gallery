<script setup>
// Hierarchical model-predictions panel (curation aid): Genus ▸ Species ▸ Subspecies
// tree built from the prediction's own trinomial entries, with optional
// region-checklist "show all" browsing. Compact: one line per row
// (name · % · oor flag · source chips). British spelling throughout.
import { ref, reactive, computed, watch } from 'vue'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import {
  getPredictions, getFormPrediction, getLinks, predictionDiffers,
  regionSubspeciesOf, regionSpeciesOf,
  SOURCE_KEYS, SOURCE_LABELS, SOURCE_FULL_NAMES
} from '../composables/useCurationData.js'

// `item` drives the existing CAMID-based curation flow (Collection tab).
// `prediction` lets the AI ID tab pass a model result directly (no CAMID, no
// recorded taxon) and reuse this exact tree renderer.
const props = defineProps({
  item: { type: Object, default: () => ({}) },
  prediction: { type: Object, default: null },
  startOpen: { type: Boolean, default: false },
})

const { expandPredictions } = useGlobalGalleryOptions()

const state = ref('loading')   // 'loading' | 'ready' | 'none' | 'error'
const pred = ref(null)
const formPred = ref(null)     // model FORM prediction (polymorphic morph), or null
const open = ref(props.startOpen || expandPredictions.value)   // compact by default; "Show predictions" opens all
const linksCache = ref({})     // taxon -> { boa, sangay, noreste, cotacachi }

const camid = computed(() => props.item && props.item.CAM_ID)

const clean = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return (!s || s === 'NA' || s === 'None') ? '' : s
}
const recordedSpecies = computed(() => clean(props.item && props.item.Species))
const recordedSubsp = computed(() => clean(props.item && props.item.Subspecies_Form))
const recordedTaxon = computed(() => {
  const sp = recordedSpecies.value, ssp = recordedSubsp.value
  if (sp && ssp) return ssp.startsWith(sp) ? ssp : `${sp} ${ssp}`
  return sp
})
const hasRecordedSubsp = computed(() => !!recordedSubsp.value)

// mark where the database (recorded) taxon sits in the model's tree.
// Prefer the canonical recorded label (pred.rec, matches the leaf names); fall back
// to the raw collection.json values.
const recSpeciesLc = computed(() => (pred.value?.rec?.species || recordedSpecies.value || '').toLowerCase())
const recSubspLc = computed(() => (pred.value?.rec?.subsp || (hasRecordedSubsp.value ? recordedTaxon.value : '') || '').toLowerCase())
const isRecSpecies = (t) => !!recSpeciesLc.value && t.toLowerCase() === recSpeciesLc.value
const isRecSubsp = (t) => !!recSubspLc.value && t.toLowerCase() === recSubspLc.value

const side = computed(() => pred.value?.side || '')
const oof = computed(() => !!(pred.value && pred.value.oof))
const topSubspName = computed(() => pred.value?.subspecies?.[0]?.[0] || '')

// "differs from recorded" badge uses the SAME helper as the gallery filter.
const differs = computed(() => predictionDiffers(props.item, pred.value))

// model form (colour morph) disagrees with a recorded form
const formDiffers = computed(() => {
  const f = formPred.value
  return !!(f && f.recorded && f.recorded !== f.form)
})

// the model's single highest-confidence calls, tagged "predicted" in the tree
// (mirrors the "recorded" badge). topSubspName is the top subspecies (above).
const topSpeciesName = computed(() => pred.value?.species?.[0]?.[0] || '')
const isPredSpecies = (t) => !!topSpeciesName.value && t.toLowerCase() === topSpeciesName.value.toLowerCase()
const isPredSubsp = (t) => !!topSubspName.value && t.toLowerCase() === topSubspName.value.toLowerCase()

// A subspecies suggestion only makes sense when the model's top subspecies belongs
// to its top predicted species AND has real confidence. The flat subspecies list
// always holds *some* trinomial, so without this guard a confident species-level
// call (e.g. Echydna punctata 99.7%, a species with no subspecies) would wrongly
// "suggest" an unrelated ~0% subspecies. '' when there's nothing sensible to suggest.
const SUGGEST_MIN = 0.05
const suggestedSubsp = computed(() => {
  const top = pred.value?.subspecies?.[0]
  if (!top) return ''
  const [name, prob] = top
  if (!(prob >= SUGGEST_MIN)) return ''
  if (speciesOf(name).toLowerCase() !== topSpeciesName.value.toLowerCase()) return ''
  return name
})

const fmtPct = (c) => (typeof c === 'number' && !Number.isNaN(c)) ? `${Math.round(c * 100)}%` : ''
const genusOf = (t) => t.split(/\s+/)[0]
const speciesOf = (t) => t.split(/\s+/).slice(0, 2).join(' ')
// region "+ all" rows: those the model gave a probability to (prob >= 0) come
// first, highest confidence on top; the rest (prob = -1) stay alphabetical.
const byProbThenName = (a, b) => (b.prob - a.prob) || a.taxon.localeCompare(b.taxon)

// --- Tree construction ----------------------------------------------------
// Built from the prediction's own (proper trinomial) entries:
//   genera = union of genus[] names + the genus of every species[]/subspecies[]
//            entry, ordered by genus[] prob (names not in genus[] go last).
//   species under a genus = species[] entries of that genus + parent species of
//            any subspecies[] entry under that genus not already listed.
//   subspecies under a species = subspecies[] entries whose first two words === species.
const SUBSP_MIN = 0.05   // show the 2nd/3rd subspecies only if >= 5% confidence
const tree = computed(() => {
  const p = pred.value
  if (!p) return []
  const genusArr = p.genus || []
  const speciesArr = p.species || []   // each: [name, prob, oor, [[ssp, p, oor], ...]]

  const genusProb = new Map(), genusOrder = []
  genusArr.forEach(([g, c]) => { if (!genusProb.has(g)) { genusProb.set(g, c); genusOrder.push(g) } })

  const allGenera = new Set(genusOrder)
  speciesArr.forEach(([sp]) => allGenera.add(genusOf(sp)))
  const generaOrdered = Array.from(allGenera).sort((a, b) => {
    const pa = genusProb.has(a), pb = genusProb.has(b)
    if (pa && pb) return genusProb.get(b) - genusProb.get(a)
    if (pa) return -1
    if (pb) return 1
    return a.localeCompare(b)
  })

  const treeArr = generaOrdered.map((g) => {
    const speciesNodes = speciesArr
      .filter(([sp]) => genusOf(sp) === g)
      .map(([sp, c, oor, subs]) => ({
        taxon: sp,
        pct: fmtPct(c),
        prob: c,
        oor: !!oor,
        // top-3 subspecies of THIS species; keep the 1st always, drop weak 2nd/3rd
        subspecies: (subs || [])
          .filter((x, i) => i === 0 || x[1] >= SUBSP_MIN)
          .map(([t, p2, o]) => ({ taxon: t, pct: fmtPct(p2), oor: !!o }))
      }))
      .sort((a, b) => b.prob - a.prob)
    return { taxon: g, pct: genusProb.has(g) ? fmtPct(genusProb.get(g)) : '', species: speciesNodes }
  })

  // ensure the RECORDED taxon is always present (even outside top-k) so its model
  // rank/confidence is visible for curation. Prefer pred.rec (canonical, carries the
  // model probs); fall back to the raw collection.json values when rec is absent
  // (~20% of specimens) so the recorded ID is never hidden once the bottom block is gone.
  const rec = p.rec
  const recSp = rec?.species || recordedSpecies.value
  if (recSp) {
    const rg = rec?.genus || genusOf(recSp)
    const recSubspFull = rec?.subsp || (hasRecordedSubsp.value ? recordedTaxon.value : '')
    let gNode = treeArr.find(x => x.taxon === rg)
    if (!gNode) { gNode = { taxon: rg, pct: fmtPct(rec?.genus_p), species: [] }; treeArr.push(gNode) }
    let sNode = gNode.species.find(x => x.taxon === recSp)
    if (!sNode) {
      sNode = { taxon: recSp, pct: fmtPct(rec?.species_p), prob: rec?.species_p || 0, oor: !!rec?.oor, subspecies: [] }
      gNode.species.push(sNode)
      gNode.species.sort((a, b) => b.prob - a.prob)
    }
    if (recSubspFull && !sNode.subspecies.find(x => x.taxon === recSubspFull)) {
      sNode.subspecies.push({ taxon: recSubspFull, pct: fmtPct(rec?.subsp_p), oor: !!rec?.oor })
    }
  }
  return treeArr
})

// --- Default expansion: top genus open, its top species open ---------------
const openGenera = reactive(new Set())
const openSpecies = reactive(new Set())
function resetExpansion() {
  openGenera.clear()
  openSpecies.clear()
  const t = tree.value
  if (t.length) {
    openGenera.add(t[0].taxon)
    if (t[0].species.length) openSpecies.add(t[0].species[0].taxon)
  }
  // also open the genus + species of the model's TOP species call — the top genus
  // by marginal mass (t[0]) can differ from the genus of the single highest species
  // (e.g. Heliconius numata 12% sits under Heliconius while Melinaea is the top genus
  // by mass), and the predicted species' branch should always be visible.
  const ps = topSpeciesName.value.toLowerCase()
  if (ps) for (const g of t) for (const s of g.species) {
    if (s.taxon.toLowerCase() === ps) { openGenera.add(g.taxon); openSpecies.add(s.taxon) }
  }
  // also reveal the recorded taxon's branch so its model rank is visible at a glance
  const rs = recSpeciesLc.value
  if (rs) for (const g of t) for (const s of g.species) {
    if (s.taxon.toLowerCase() === rs) { openGenera.add(g.taxon); openSpecies.add(s.taxon) }
  }
}
function expandAll() {
  for (const g of tree.value) {
    openGenera.add(g.taxon)
    for (const s of g.species) openSpecies.add(s.taxon)
  }
}
// "Show predictions" global toggle: open + fully expand every panel (or revert)
watch(expandPredictions, (on) => {
  open.value = on
  if (state.value !== 'ready') return
  if (on) expandAll(); else resetExpansion()
})
const toggleGenus = (g) => { openGenera.has(g) ? openGenera.delete(g) : openGenera.add(g) }
const toggleSpecies = (s) => { openSpecies.has(s) ? openSpecies.delete(s) : openSpecies.add(s) }

// --- "Show all" region browsing -------------------------------------------
// extraSubspecies: species "Genus species" -> array of { taxon, pct, oor }
// extraSpecies:    genus -> array of { taxon, pct, oor, subspecies:[] }
const extraSubspecies = ref({})
const extraSpecies = ref({})
const loadingShowAll = reactive(new Set())   // keys: 'ss:<species>' / 'sp:<genus>'
// whether the region has MORE taxa than already shown (else hide the "+ all" button)
const moreSubsp = ref({})    // "Genus species" -> bool
const moreSpecies = ref({})  // genus -> bool

// prob lookups so region taxa show a % only if the model predicted them
const subspProbMap = computed(() => {
  const m = new Map()
  ;(pred.value?.subspecies || []).forEach(([t, c, oor]) => { if (!m.has(t)) m.set(t, { c, oor }) })
  return m
})
const speciesProbMap = computed(() => {
  const m = new Map()
  // species_all (every species >= 1%) backs the "+ all species" % lookup; fall back
  // to the displayed top-k species for older prediction files without it.
  ;(pred.value?.species_all || pred.value?.species || []).forEach(([t, c, oor]) => { if (!m.has(t)) m.set(t, { c, oor }) })
  return m
})

async function toggleAllSubspecies(speciesNode) {
  const sp = speciesNode.taxon
  if (extraSubspecies.value[sp]) {
    const next = { ...extraSubspecies.value }
    delete next[sp]
    extraSubspecies.value = next
    return
  }
  loadingShowAll.add('ss:' + sp)
  try {
    const already = new Set(speciesNode.subspecies.map(s => s.taxon))
    const keys = (await regionSubspeciesOf(sp, side.value)).filter(k => !already.has(k))
    const rows = keys.map((k) => {
      const hit = subspProbMap.value.get(k)
      return { taxon: k, pct: hit ? fmtPct(hit.c) : '', prob: hit ? hit.c : -1, oor: hit ? !!hit.oor : false }
    }).sort(byProbThenName)
    extraSubspecies.value = { ...extraSubspecies.value, [sp]: rows }
    rows.forEach(r => loadLinks(r.taxon))
  } finally {
    loadingShowAll.delete('ss:' + sp)
  }
}

async function toggleAllSpecies(genusNode) {
  const g = genusNode.taxon
  if (extraSpecies.value[g]) {
    const next = { ...extraSpecies.value }
    delete next[g]
    extraSpecies.value = next
    return
  }
  loadingShowAll.add('sp:' + g)
  try {
    const already = new Set(genusNode.species.map(s => s.taxon))
    const keys = (await regionSpeciesOf(g, side.value)).filter(k => !already.has(k))
    const rows = keys.map((k) => {
      const hit = speciesProbMap.value.get(k)
      return {
        taxon: k,
        pct: hit ? fmtPct(hit.c) : '',
        prob: hit ? hit.c : -1,
        oor: hit ? !!hit.oor : false,
        subspecies: []   // region species rows are collapsible but list nothing until "+ all subspecies"
      }
    }).sort(byProbThenName)
    extraSpecies.value = { ...extraSpecies.value, [g]: rows }
    rows.forEach(r => loadLinks(r.taxon))
    // does each revealed species have region subspecies to offer?
    const ms = { ...moreSubsp.value }
    for (const r of rows) ms[r.taxon] = (await regionSubspeciesOf(r.taxon, side.value)).length > 0
    moreSubsp.value = ms
  } finally {
    loadingShowAll.delete('sp:' + g)
  }
}

const sideLabel = computed(() => side.value || 'either side')

// --- Links / chips --------------------------------------------------------
async function loadLinks(taxon) {
  if (!taxon || linksCache.value[taxon]) return
  const links = await getLinks(taxon)
  linksCache.value = { ...linksCache.value, [taxon]: links }
}
function chipsFor(taxon) {
  const m = linksCache.value[taxon]
  if (!m) return []
  return SOURCE_KEYS.filter(s => m[s]).map(s => ({ src: s, url: m[s] }))
}

async function load() {
  state.value = 'loading'
  extraSubspecies.value = {}
  extraSpecies.value = {}
  moreSubsp.value = {}
  moreSpecies.value = {}
  formPred.value = null
  try {
    // AI ID tab supplies the prediction directly; Collection tab fetches by CAMID.
    if (!props.prediction) getFormPrediction(camid.value).then(f => { formPred.value = f })
    const p = props.prediction || await getPredictions(camid.value)
    if (!p) { pred.value = null; state.value = 'none'; return }
    pred.value = p
    state.value = 'ready'
    resetExpansion()
    if (expandPredictions.value) { open.value = true; expandAll() }
    // preload chips for every taxon in the tree + recorded ID
    const taxa = new Set()
    if (recordedTaxon.value) taxa.add(recordedTaxon.value)
    tree.value.forEach((g) => {
      taxa.add(g.taxon)
      g.species.forEach((s) => {
        taxa.add(s.taxon)
        s.subspecies.forEach((ss) => taxa.add(ss.taxon))
      })
    })
    taxa.forEach(loadLinks)
    // figure out which "+ all" buttons have anything to reveal (memoised lookups)
    const ms = {}, mg = {}
    for (const g of tree.value) {
      const shownSp = new Set(g.species.map(s => s.taxon))
      mg[g.taxon] = (await regionSpeciesOf(g.taxon, side.value)).some(x => !shownSp.has(x))
      for (const s of g.species) {
        const shownSs = new Set(s.subspecies.map(ss => ss.taxon))
        ms[s.taxon] = (await regionSubspeciesOf(s.taxon, side.value)).some(x => !shownSs.has(x))
      }
    }
    moreSubsp.value = ms
    moreSpecies.value = mg
  } catch {
    state.value = 'error'
  }
}
watch([camid, () => props.prediction], load, { immediate: true })
</script>

<template>
  <div class="pred-panel border rounded mt-2 bg-white">
    <button
      type="button"
      class="pred-head btn btn-sm w-100 d-flex align-items-center justify-content-between text-start px-2 py-1"
      :aria-expanded="open"
      :aria-controls="'pred-body-' + camid"
      @click="open = !open"
    >
      <span class="d-flex align-items-center gap-2 flex-wrap">
        <span class="fw-bold small" title="Out-of-fold model predictions: each specimen is scored by a model that never trained on it — an honest signal for spotting mislabels.">Model predictions</span>
        <span v-if="state === 'ready' && side" class="badge text-bg-light border text-secondary fw-normal" :title="`Suggestions weighted to ${side}-of-Andes taxa`">{{ side }} of Andes</span>
        <span
          v-if="state === 'ready' && !hasRecordedSubsp && suggestedSubsp"
          class="badge text-bg-info-subtle text-info-emphasis border border-info-subtle fw-normal"
        >No subspecies recorded</span>
        <span
          v-else-if="state === 'ready' && differs"
          class="badge text-bg-warning-subtle text-warning-emphasis border border-warning-subtle fw-normal"
        >&#9888; differs from recorded</span>
      </span>
      <span class="chevron small" :class="{ open }" aria-hidden="true">&#9656;</span>
    </button>

    <div v-show="open" :id="'pred-body-' + camid" class="pred-body px-2 pb-2">
      <div v-if="state === 'loading'" class="text-muted small py-2 d-flex align-items-center gap-2">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Loading predictions&hellip;
      </div>
      <div v-else-if="state === 'error'" class="text-danger small py-2">Could not load predictions.</div>
      <div v-else-if="state === 'none'" class="text-muted small py-2">No model prediction available for this specimen.</div>

      <template v-else>
        <p v-if="!hasRecordedSubsp && suggestedSubsp" class="small text-info-emphasis mb-1 mt-1">
          No subspecies recorded &mdash; model suggests <em>{{ suggestedSubsp }}</em>.
        </p>

        <div class="pred-tree mt-1">
          <template v-for="g in tree" :key="'g-' + g.taxon">
            <!-- Genus row -->
            <div class="pred-row pred-genus">
              <button
                type="button" class="tree-toggle"
                :aria-expanded="openGenera.has(g.taxon)"
                :aria-label="`${openGenera.has(g.taxon) ? 'Collapse' : 'Expand'} genus ${g.taxon}`"
                @click="toggleGenus(g.taxon)"
              ><span class="chev" :class="{ open: openGenera.has(g.taxon) }" aria-hidden="true">&#9656;</span></button>
              <span class="pred-name genus-name" :title="g.taxon">{{ g.taxon }}</span>
              <span v-if="g.pct" class="pred-pct">{{ g.pct }}</span>
              <span class="pred-chips">
                <a v-for="c in chipsFor(g.taxon)" :key="c.src" class="src-chip" :href="c.url"
                   target="_blank" rel="noopener noreferrer"
                   :aria-label="`Open ${g.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                >{{ SOURCE_LABELS[c.src] }}</a>
              </span>
            </div>

            <template v-if="openGenera.has(g.taxon)">
              <!-- Species under this genus (model-predicted) -->
              <template v-for="s in g.species" :key="'sp-' + s.taxon">
                <div class="pred-row pred-species" :class="{ 'rec-hit': isRecSpecies(s.taxon) }">
                  <button
                    type="button" class="tree-toggle"
                    :aria-expanded="openSpecies.has(s.taxon)"
                    :aria-label="`${openSpecies.has(s.taxon) ? 'Collapse' : 'Expand'} species ${s.taxon}`"
                    @click="toggleSpecies(s.taxon)"
                  ><span class="chev" :class="{ open: openSpecies.has(s.taxon) }" aria-hidden="true">&#9656;</span></button>
                  <span class="pred-name italic" :title="s.taxon">{{ s.taxon }}</span>
                  <span v-if="s.pct" class="pred-pct">{{ s.pct }}</span>
                  <span v-if="isRecSpecies(s.taxon)" class="rec-badge" title="Recorded ID in the database">recorded</span>
                  <span v-if="isPredSpecies(s.taxon)" class="pred-badge" title="Model's top species prediction">predicted</span>
                  <span v-if="s.oor" class="oor-tag" title="Documented only on the other side of the Andes">off-region</span>
                  <span class="pred-chips">
                    <a v-for="c in chipsFor(s.taxon)" :key="c.src" class="src-chip" :href="c.url"
                       target="_blank" rel="noopener noreferrer"
                       :aria-label="`Open ${s.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                    >{{ SOURCE_LABELS[c.src] }}</a>
                  </span>
                </div>

                <template v-if="openSpecies.has(s.taxon)">
                  <!-- Predicted subspecies -->
                  <div v-for="ss in s.subspecies" :key="'ss-' + ss.taxon" class="pred-row pred-subsp" :class="{ 'rec-hit': isRecSubsp(ss.taxon) }">
                    <span class="pred-name italic" :title="ss.taxon">{{ ss.taxon }}</span>
                    <span v-if="ss.pct" class="pred-pct">{{ ss.pct }}</span>
                    <span v-if="isRecSubsp(ss.taxon)" class="rec-badge" title="Recorded ID in the database">recorded</span>
                    <span v-if="isPredSubsp(ss.taxon)" class="pred-badge" title="Model's top subspecies prediction">predicted</span>
                    <span v-if="ss.oor" class="oor-tag" title="Documented only on the other side of the Andes">off-region</span>
                    <span class="pred-chips">
                      <a v-for="c in chipsFor(ss.taxon)" :key="c.src" class="src-chip" :href="c.url"
                         target="_blank" rel="noopener noreferrer"
                         :aria-label="`Open ${ss.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                      >{{ SOURCE_LABELS[c.src] }}</a>
                    </span>
                  </div>
                  <!-- Region subspecies (show all) -->
                  <div v-for="ss in (extraSubspecies[s.taxon] || [])" :key="'xss-' + ss.taxon" class="pred-row pred-subsp pred-region">
                    <span class="pred-name italic" :title="ss.taxon">{{ ss.taxon }}</span>
                    <span v-if="ss.pct" class="pred-pct">{{ ss.pct }}</span>
                    <span v-if="ss.oor" class="oor-tag" title="Documented only on the other side of the Andes">off-region</span>
                    <span class="pred-chips">
                      <a v-for="c in chipsFor(ss.taxon)" :key="c.src" class="src-chip" :href="c.url"
                         target="_blank" rel="noopener noreferrer"
                         :aria-label="`Open ${ss.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                      >{{ SOURCE_LABELS[c.src] }}</a>
                    </span>
                  </div>
                  <!-- + all subspecies button -->
                  <div v-if="moreSubsp[s.taxon] || extraSubspecies[s.taxon]" class="pred-row pred-subsp pred-showall">
                    <button type="button" class="showall-btn" @click="toggleAllSubspecies(s)"
                      :disabled="loadingShowAll.has('ss:' + s.taxon)"
                      :aria-expanded="!!extraSubspecies[s.taxon]">
                      <span v-if="loadingShowAll.has('ss:' + s.taxon)" class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                      <template v-else>{{ extraSubspecies[s.taxon] ? '− hide' : `+ all subspecies (${sideLabel})` }}</template>
                    </button>
                  </div>
                </template>
              </template>

              <!-- Region species (show all) -->
              <template v-for="s in (extraSpecies[g.taxon] || [])" :key="'xsp-' + s.taxon">
                <div class="pred-row pred-species pred-region">
                  <button
                    type="button" class="tree-toggle"
                    :aria-expanded="openSpecies.has(s.taxon)"
                    :aria-label="`${openSpecies.has(s.taxon) ? 'Collapse' : 'Expand'} species ${s.taxon}`"
                    @click="toggleSpecies(s.taxon)"
                  ><span class="chev" :class="{ open: openSpecies.has(s.taxon) }" aria-hidden="true">&#9656;</span></button>
                  <span class="pred-name italic" :title="s.taxon">{{ s.taxon }}</span>
                  <span v-if="s.pct" class="pred-pct">{{ s.pct }}</span>
                  <span v-if="s.oor" class="oor-tag" title="Documented only on the other side of the Andes">off-region</span>
                  <span class="pred-chips">
                    <a v-for="c in chipsFor(s.taxon)" :key="c.src" class="src-chip" :href="c.url"
                       target="_blank" rel="noopener noreferrer"
                       :aria-label="`Open ${s.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                    >{{ SOURCE_LABELS[c.src] }}</a>
                  </span>
                </div>
                <template v-if="openSpecies.has(s.taxon)">
                  <div v-for="ss in (extraSubspecies[s.taxon] || [])" :key="'xss2-' + ss.taxon" class="pred-row pred-subsp pred-region">
                    <span class="pred-name italic" :title="ss.taxon">{{ ss.taxon }}</span>
                    <span v-if="ss.pct" class="pred-pct">{{ ss.pct }}</span>
                    <span v-if="ss.oor" class="oor-tag" title="Documented only on the other side of the Andes">off-region</span>
                    <span class="pred-chips">
                      <a v-for="c in chipsFor(ss.taxon)" :key="c.src" class="src-chip" :href="c.url"
                         target="_blank" rel="noopener noreferrer"
                         :aria-label="`Open ${ss.taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
                      >{{ SOURCE_LABELS[c.src] }}</a>
                    </span>
                  </div>
                  <div v-if="moreSubsp[s.taxon] || extraSubspecies[s.taxon]" class="pred-row pred-subsp pred-showall">
                    <button type="button" class="showall-btn" @click="toggleAllSubspecies(s)"
                      :disabled="loadingShowAll.has('ss:' + s.taxon)"
                      :aria-expanded="!!extraSubspecies[s.taxon]">
                      <span v-if="loadingShowAll.has('ss:' + s.taxon)" class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                      <template v-else>{{ extraSubspecies[s.taxon] ? '− hide' : `+ all subspecies (${sideLabel})` }}</template>
                    </button>
                  </div>
                </template>
              </template>

              <!-- + all species button -->
              <div v-if="moreSpecies[g.taxon] || extraSpecies[g.taxon]" class="pred-row pred-species pred-showall">
                <button type="button" class="showall-btn" @click="toggleAllSpecies(g)"
                  :disabled="loadingShowAll.has('sp:' + g.taxon)"
                  :aria-expanded="!!extraSpecies[g.taxon]">
                  <span v-if="loadingShowAll.has('sp:' + g.taxon)" class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  <template v-else>{{ extraSpecies[g.taxon] ? '− hide' : `+ all species (${sideLabel})` }}</template>
                </button>
              </div>
            </template>
          </template>
        </div>

        <!-- Model FORM prediction (colour morph) — a sub-level within the species -->
        <div v-if="formPred" class="pred-form mt-2">
          <div class="pred-group-title">
            Model form &mdash; <em>{{ formPred.species }}</em>
            <span v-if="formDiffers" class="rec-badge ms-1" :title="`Recorded form: f. ${formPred.recorded}`">&#9888; recorded f. {{ formPred.recorded }}</span>
          </div>
          <div v-for="(a, i) in formPred.alts" :key="'fm-' + a[0]" class="pred-row pred-subsp"
               :class="{ 'rec-hit': formPred.recorded && a[0] === formPred.recorded }">
            <span class="pred-name italic">f. {{ a[0] }}</span>
            <span class="pred-pct">{{ Math.round(a[1] * 100) }}%</span>
            <span v-if="i === 0" class="pred-badge" title="Model's top form prediction">predicted</span>
            <span v-if="formPred.recorded && a[0] === formPred.recorded" class="rec-badge" title="Recorded form in the database">recorded</span>
          </div>
        </div>

      </template>
    </div>
  </div>
</template>

<style scoped>
.pred-panel { font-size: 0.8rem; }
.pred-head {
  background: #f1f5f9;
  border: none;
  border-radius: inherit;
  min-height: 36px;
  color: #1e293b;
}
.pred-head:focus-visible { outline: 2px solid #0d6efd; outline-offset: -2px; }
.chevron { transition: transform 0.15s ease; color: #64748b; }
.chevron.open { transform: rotate(90deg); }

/* one line per prediction: [toggle] name (grows) · % · oor · chips */
.pred-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 1px 0;
}
/* tint by level so the eye reads genus > species > subspecies grouping */
.pred-genus {
  margin-top: 0.3rem;
  background: #e6ecf3;
  border-radius: 4px;
  padding: 2px 6px;
}
.pred-genus .genus-name, .pred-genus .pred-pct { font-weight: 700; color: #1e293b; }
.pred-species {
  padding: 1px 6px 1px 1.25rem;
  background: #f2f6fb;
  border-left: 2px solid #d3def0;
  margin-left: 0.35rem;
}
.pred-subsp {
  padding: 1px 6px 1px 3.6rem;   /* one tab past the species NAME (species has a chevron) */
  border-left: 2px solid #e2e8f0;
  margin-left: 0.35rem;
}

.tree-toggle {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  padding: 0;
  width: 14px;
  height: 14px;
  line-height: 1;
  color: #64748b;
  cursor: pointer;
}
.tree-toggle:focus-visible { outline: 2px solid #0d6efd; outline-offset: 1px; border-radius: 2px; }
.chev { display: inline-block; transition: transform 0.15s ease; font-size: 0.7rem; }
.chev.open { transform: rotate(90deg); }

.pred-name {
  flex: 0 1 auto;          /* don't grow -> the % sits right next to the name */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pred-name.italic { font-style: italic; }
.genus-name { font-weight: 700; color: #1e293b; }
.pred-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #475569;
  flex: 0 0 auto;
}
.pred-region .pred-name { color: #64748b; }

.pred-group-title {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  font-weight: 700;
  margin-bottom: 0.1rem;
}
.pred-recorded { border-top: 1px solid #e2e8f0; margin-top: 0.5rem; padding-top: 0.35rem; }
.pred-form { border-top: 1px dashed #cbd5e1; padding-top: 0.35rem; }

.pred-chips { display: flex; flex-wrap: wrap; gap: 0.2rem; flex: 0 0 auto; margin-left: auto; }
.src-chip {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 6px;
  font-size: 0.66rem;
  line-height: 1.2;
  text-decoration: none;
  color: #0d6efd;
  background: #eef4ff;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
}
.src-chip:hover { background: #dbe8ff; }
.src-chip:focus-visible { outline: 2px solid #0d6efd; outline-offset: 1px; }
.diff-chip { color: #b45309; flex: 0 0 auto; }

.showall-btn {
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  color: #475569;
  border-radius: 999px;
  font-size: 0.66rem;
  line-height: 1.2;
  min-height: 20px;
  padding: 0 8px;
  cursor: pointer;
}
.showall-btn:hover:not(:disabled) { background: #eef2f7; border-color: #94a3b8; }
.showall-btn:focus-visible { outline: 2px solid #0d6efd; outline-offset: 1px; }
.showall-btn:disabled { opacity: 0.6; cursor: default; }

.oor-tag {
  font-size: 0.6rem;
  color: #b45309;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  padding: 0 3px;
  flex: 0 0 auto;
}
/* the recorded (database) taxon, shown in context within the model's ranking */
.rec-hit { background: #fff8e1 !important; box-shadow: inset 3px 0 0 #f59e0b; border-radius: 3px; }
.rec-badge {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 4px;
  padding: 0 4px;
  flex: 0 0 auto;
}
/* the model's single top species/subspecies call */
.pred-badge {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #166534;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  border-radius: 4px;
  padding: 0 4px;
  flex: 0 0 auto;
}
@media (max-width: 768px) { .pred-panel { font-size: 0.78rem; } }
</style>
