<script setup>
// Model-predictions panel on each gallery card (curation aid): header with the
// side-of-Andes tag and differs / no-subspecies badges, the predicted sex line,
// then the shared taxonomy table (TaxonTree: genus > species > subspecies, one
// line per taxon with RECORDED / PREDICTED badges and region "+ all" browsing).
// Clicking a taxon opens the compare drawer (TaxonDrawer) with guide links and
// reference photos beside this specimen. British spelling throughout.
import { ref, computed, watch } from 'vue'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import {
  getPredictions, getSexPrediction, getFormPrediction, predictionDiffers, getPredictionMissingReason,
} from '../composables/useCurationData.js'
import { useTaxonDrawer } from '../composables/useTaxonDrawer.js'
import { speciesOf } from '../utils/taxonTree.js'
import TaxonTree from './TaxonTree.vue'
import { resolveCamid } from '../utils/galleryPipeline.js'
import { REVIEW_RANKS, rankComparison, recordedPredictionEvidence, recordedTaxonomy } from '../utils/taxonomy.js'
import { formatSexPrediction } from '../utils/sexPrediction.js'

// `item` drives the existing CAMID-based curation flow (Collection tab).
// `prediction` passes a model result directly (no CAMID, no recorded taxon).
const props = defineProps({
  item: { type: Object, default: () => ({}) },
  prediction: { type: Object, default: null },
  startOpen: { type: Boolean, default: false },
})

const { expandPredictions } = useGlobalGalleryOptions()

const state = ref('loading')   // 'loading' | 'ready' | 'none' | 'error'
const pred = ref(null)
const missingReason = ref('')
const rankMissingReasons = ref({})
const formPred = ref(null)     // model FORM prediction (polymorphic morph), or null
const sexPred = ref(null)
const sexState = ref('none')
const displayedSex = computed(() => formatSexPrediction(sexPred.value, recordedSpecies.value))
const open = ref(props.startOpen || expandPredictions.value)   // compact by default; "Show predictions" opens all
// "Show predictions" global toggle: open every panel (the table expands fully too)
watch(expandPredictions, (on) => { open.value = on })

const camid = computed(() => resolveCamid(props.item))

const recorded = computed(() => recordedTaxonomy(props.item))
const recordedSpecies = computed(() => recorded.value.species)
const recordedSubsp = computed(() => recorded.value.subspecies)
const recordedTaxon = computed(() => {
  const sp = recordedSpecies.value, ssp = recordedSubsp.value
  if (sp && ssp) return ssp.startsWith(sp) ? ssp : `${sp} ${ssp}`
  return sp
})
const hasRecordedSubsp = computed(() => !!recordedSubsp.value)

const side = computed(() => pred.value?.side || '')
const topSpeciesName = computed(() => pred.value?.species?.[0]?.[0] || '')

// "differs from recorded" badge uses the SAME helper as the gallery filter.
const differs = computed(() => predictionDiffers(props.item, pred.value))

const rankRows = computed(() => REVIEW_RANKS.map(rank => rankComparison(props.item, pred.value, rank)))
const publicReason = (reason) => String(reason || '')
  .replaceAll('candidate-D', 'corrected model')
  .replaceAll('OOF', 'held-out')

// model form (colour morph) disagrees with a recorded form
const formDiffers = computed(() => {
  const f = formPred.value
  return !!(f && f.recorded && f.recorded !== f.form)
})

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

// --- Taxonomy table (shared TaxonTree; logic in utils/taxonTree.js) ----------
// The recorded taxon always appears in the table: the collection row supplies its
// identity and the prediction arrays supply any matching probability.
const treeRecorded = computed(() => {
  if (!recordedSpecies.value) return null
  const subspecies = hasRecordedSubsp.value ? recordedTaxon.value : ''
  return {
    species: recordedSpecies.value,
    subspecies,
    evidence: {
      genus: recordedPredictionEvidence(props.item, pred.value, 'genus'),
      species: recordedPredictionEvidence(props.item, pred.value, 'species'),
      subspecies: subspecies ? recordedPredictionEvidence(props.item, pred.value, 'subspecies') : null,
    },
  }
})
// A taxon clicked in the table opens the compare drawer next to this specimen.
const { state: drawer, openDrawer } = useTaxonDrawer()
const selectedHere = computed(() => (drawer.open && drawer.item === props.item ? drawer.taxon : ''))
function inspect(taxon) {
  openDrawer({ item: props.item, pred: pred.value, taxon, recorded: treeRecorded.value })
}

async function load() {
  state.value = 'loading'
  missingReason.value = ''
  rankMissingReasons.value = {}
  formPred.value = null
  sexPred.value = null
  sexState.value = 'none'
  // A direct taxonomy prediction belongs to the AI Identifier upload flow,
  // where sex prediction is not yet supported.
  if (!props.prediction) {
    try {
      sexPred.value = await getSexPrediction(camid.value)
      sexState.value = sexPred.value ? 'ready' : 'none'
    } catch {
      sexState.value = 'error'
    }
  }
  try {
    // AI ID tab supplies the prediction directly; Collection tab fetches by CAMID.
    if (!props.prediction) getFormPrediction(camid.value).then(f => { formPred.value = f })
    const p = props.prediction || await getPredictions(camid.value)
    if (!p) {
      pred.value = null
      missingReason.value = await getPredictionMissingReason(camid.value)
      state.value = 'none'
      return
    }
    pred.value = p
    const missing = {}
    for (const row of rankRows.value) {
      if (row.status === 'missing') missing[row.rank] = await getPredictionMissingReason(camid.value, row.rank)
    }
    rankMissingReasons.value = missing
    state.value = 'ready'
    if (expandPredictions.value) open.value = true
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
        <span class="fw-bold small" title="Corrected out-of-fold model predictions; each specimen is scored by a model that never trained on it.">Model predictions</span>
        <span v-if="state === 'ready' && side" class="badge text-bg-light border text-secondary fw-normal" :title="`Recorded ${side}-of-Andes side; paired model predictions include geographic weighting.`">{{ side }} of Andes</span>
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
      <div v-if="displayedSex" class="pred-sex mt-2">{{ displayedSex.text }}</div>
      <div v-else-if="sexState === 'error'" class="text-muted small mt-2">Sex prediction unavailable.</div>
      <div v-if="state === 'loading'" class="text-muted small py-2 d-flex align-items-center gap-2">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Loading predictions&hellip;
      </div>
      <div v-else-if="state === 'error'" class="text-danger small py-2">Could not load predictions.</div>
      <div v-else-if="state === 'none'" class="text-muted small py-2">
        No model prediction available for this specimen.
        <span v-if="missingReason">{{ publicReason(missingReason) }}.</span>
      </div>

      <template v-else>
        <div class="pred-tree mt-1">
          <TaxonTree :pred="pred" :recorded="treeRecorded" :selected="selectedHere" :reset-key="camid"
            browse="region" :side="side" badges :genus-limit="5" :expand-all="expandPredictions"
            :label="`Model predictions for ${camid}`" @select="inspect" />
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
.pred-sex { color: #334155; font-weight: 600; }
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
.pred-tree { text-align: left; }

/* model form rows: one line per form (name · % · badges) */
.pred-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 1px 0;
}
.pred-subsp { padding: 1px 6px 1px 1.4rem; }
.pred-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pred-name.italic { font-style: italic; }
.pred-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #475569;
  flex: 0 0 auto;
}
.pred-group-title {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  font-weight: 700;
  margin-bottom: 0.1rem;
}
.pred-form { border-top: 1px dashed #cbd5e1; padding-top: 0.35rem; text-align: left; }
/* the recorded (database) form */
.rec-hit { background: #fff8e1; box-shadow: inset 3px 0 0 #f59e0b; border-radius: 3px; }
.rec-badge, .pred-badge {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-radius: 4px;
  padding: 0 4px;
  flex: 0 0 auto;
}
.rec-badge { color: #92400e; background: #fef3c7; border: 1px solid #fde68a; }
.pred-badge { color: #166534; background: #dcfce7; border: 1px solid #bbf7d0; }
@media (max-width: 768px) { .pred-panel { font-size: 0.78rem; } }
/* Phones: long names wrap instead of pushing the percentages off the card. */
@media (max-width: 576px) {
  .pred-tree :deep(.tt-bar) { flex-basis: 28px; }
}
</style>
