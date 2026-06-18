<script setup>
// Compact model-predictions panel (curation aid) + per-taxon source cross-links.
// One line per prediction: italic taxon · % · only the source chips that resolve.
import { ref, computed, watch } from 'vue'
import { getPredictions, getLinks, SOURCE_KEYS, SOURCE_LABELS, SOURCE_FULL_NAMES } from '../composables/useCurationData.js'

const props = defineProps({ item: { type: Object, required: true } })

const state = ref('loading')   // 'loading' | 'ready' | 'none' | 'error'
const pred = ref(null)
const open = ref(false)        // compact by default; detail on demand
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

const topSubspecies = computed(() => (pred.value?.subspecies || []).slice(0, 3))
const topSpecies = computed(() => (pred.value?.species || []).slice(0, 3))
const topGenus = computed(() => (pred.value?.genus || []).slice(0, 2))
const topSubspName = computed(() => topSubspecies.value[0]?.[0] || '')
const topSpeciesName = computed(() => topSpecies.value[0]?.[0] || '')

const speciesDiffers = computed(() =>
  !!recordedSpecies.value && !!topSpeciesName.value &&
  recordedSpecies.value.toLowerCase() !== topSpeciesName.value.toLowerCase())
const subspDiffers = computed(() => {
  if (!hasRecordedSubsp.value || !topSubspName.value) return false
  const rec = recordedTaxon.value.toLowerCase(), top = topSubspName.value.toLowerCase()
  return rec !== top && !top.endsWith(recordedSubsp.value.toLowerCase())
})

const fmtPct = (c) => (typeof c === 'number' && !Number.isNaN(c)) ? `${Math.round(c * 100)}%` : ''

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
  try {
    const p = await getPredictions(camid.value)
    if (!p) { pred.value = null; state.value = 'none'; return }
    pred.value = p
    state.value = 'ready'
    // preload links (in-memory lookups after the one-time file load) so chips
    // are ready the instant the panel is expanded
    const taxa = new Set()
    if (recordedTaxon.value) taxa.add(recordedTaxon.value)
    topSubspecies.value.forEach(([t]) => t && taxa.add(t))
    topSpecies.value.forEach(([t]) => t && taxa.add(t))
    topGenus.value.forEach(([t]) => t && taxa.add(t))
    taxa.forEach(loadLinks)
  } catch {
    state.value = 'error'
  }
}
watch(camid, load, { immediate: true })
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
        <span class="fw-bold small">Model predictions</span>
        <span
          v-if="state === 'ready' && !hasRecordedSubsp && topSubspName"
          class="badge text-bg-info-subtle text-info-emphasis border border-info-subtle fw-normal"
        >No subspecies recorded</span>
        <span
          v-else-if="state === 'ready' && (speciesDiffers || subspDiffers)"
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
        <p v-if="!hasRecordedSubsp && topSubspName" class="small text-info-emphasis mb-1 mt-1">
          No subspecies recorded &mdash; model suggests:
        </p>

        <div v-if="topSubspecies.length" class="pred-group">
          <div class="pred-group-title">Subspecies</div>
          <div
            v-for="([taxon, conf], i) in topSubspecies"
            :key="'ss-' + i"
            class="pred-row"
            :class="{ 'pred-suggest': i === 0 && !hasRecordedSubsp }"
          >
            <span class="pred-name" :title="taxon">{{ taxon }}</span>
            <span class="pred-pct">{{ fmtPct(conf) }}</span>
            <span class="pred-chips">
              <a v-for="c in chipsFor(taxon)" :key="c.src" class="src-chip" :href="c.url"
                 target="_blank" rel="noopener noreferrer"
                 :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[c.src] }}</a>
            </span>
          </div>
        </div>

        <div v-if="topSpecies.length" class="pred-group">
          <div class="pred-group-title">Species</div>
          <div v-for="([taxon, conf], i) in topSpecies" :key="'sp-' + i" class="pred-row">
            <span class="pred-name" :title="taxon">{{ taxon }}</span>
            <span class="pred-pct">{{ fmtPct(conf) }}</span>
            <span class="pred-chips">
              <a v-for="c in chipsFor(taxon)" :key="c.src" class="src-chip" :href="c.url"
                 target="_blank" rel="noopener noreferrer"
                 :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[c.src] }}</a>
            </span>
          </div>
        </div>

        <div v-if="topGenus.length" class="pred-group">
          <div class="pred-group-title">Genus</div>
          <div v-for="([taxon, conf], i) in topGenus" :key="'g-' + i" class="pred-row">
            <span class="pred-name" :title="taxon">{{ taxon }}</span>
            <span class="pred-pct">{{ fmtPct(conf) }}</span>
            <span class="pred-chips">
              <a v-for="c in chipsFor(taxon)" :key="c.src" class="src-chip" :href="c.url"
                 target="_blank" rel="noopener noreferrer"
                 :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[c.src] }}</a>
            </span>
          </div>
        </div>

        <div v-if="recordedTaxon" class="pred-group pred-recorded">
          <div class="pred-group-title">Recorded ID</div>
          <div class="pred-row">
            <span class="pred-name" :title="recordedTaxon">{{ recordedTaxon }}</span>
            <span v-if="speciesDiffers || subspDiffers" class="diff-chip" aria-hidden="true">&#9888;</span>
            <span class="pred-chips">
              <a v-for="c in chipsFor(recordedTaxon)" :key="c.src" class="src-chip" :href="c.url"
                 target="_blank" rel="noopener noreferrer"
                 :aria-label="`Open ${recordedTaxon} on ${SOURCE_FULL_NAMES[c.src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[c.src] }}</a>
            </span>
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

.pred-group { margin-top: 0.4rem; }
.pred-group-title {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  font-weight: 700;
  margin-bottom: 0.1rem;
}
/* one line per prediction: name (grows) · % · chips (right) */
.pred-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 1px 0;
}
.pred-name {
  font-style: italic;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pred-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #475569;
  flex: 0 0 auto;
}
.pred-suggest .pred-name { font-weight: 700; color: #0c5460; font-style: italic; }

.pred-recorded { border-top: 1px solid #e2e8f0; margin-top: 0.4rem; padding-top: 0.35rem; }

.pred-chips { display: flex; flex-wrap: wrap; gap: 0.2rem; flex: 0 0 auto; }
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

@media (max-width: 768px) { .pred-panel { font-size: 0.78rem; } }
</style>
