<script setup>
// Feature 2: compact, collapsible model-predictions panel (curation aid).
// Feature 3: per-taxon source cross-links (BoA / Sangay / Noreste / Cotacachi).
import { ref, computed, watch } from 'vue'
import { getPredictions, getLinks, SOURCE_KEYS, SOURCE_LABELS, SOURCE_FULL_NAMES } from '../composables/useCurationData.js'

const props = defineProps({
  item: { type: Object, required: true }
})

const state = ref('loading')   // 'loading' | 'ready' | 'none' | 'error'
const pred = ref(null)
const open = ref(false)        // compact by default; detail on demand
const linksCache = ref({})     // taxon -> { boa, sangay, noreste, cotacachi }

const camid = computed(() => props.item && props.item.CAM_ID)

// Recorded ID (guard NA/None/empty).
const clean = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (!s || s === 'NA' || s === 'None') return ''
  return s
}
const recordedSpecies = computed(() => clean(props.item && props.item.Species))
const recordedSubsp = computed(() => clean(props.item && props.item.Subspecies_Form))
const recordedTaxon = computed(() => {
  const sp = recordedSpecies.value
  const ssp = recordedSubsp.value
  if (sp && ssp) return ssp.startsWith(sp) ? ssp : `${sp} ${ssp}`
  return sp
})

const hasRecordedSubsp = computed(() => !!recordedSubsp.value)

// Top picks (guard missing/empty arrays).
const topSubspecies = computed(() => (pred.value?.subspecies || []).slice(0, 3))
const topSpecies = computed(() => (pred.value?.species || []).slice(0, 3))
const topGenus = computed(() => (pred.value?.genus || []).slice(0, 2))

const topSubspName = computed(() => topSubspecies.value[0]?.[0] || '')
const topSpeciesName = computed(() => topSpecies.value[0]?.[0] || '')

const speciesDiffers = computed(() => {
  if (!recordedSpecies.value || !topSpeciesName.value) return false
  return recordedSpecies.value.toLowerCase() !== topSpeciesName.value.toLowerCase()
})
const subspDiffers = computed(() => {
  if (!hasRecordedSubsp.value || !topSubspName.value) return false
  const rec = recordedTaxon.value.toLowerCase()
  const top = topSubspName.value.toLowerCase()
  return rec !== top && !top.endsWith(recordedSubsp.value.toLowerCase())
})

const fmtPct = (c) => {
  if (typeof c !== 'number' || Number.isNaN(c)) return ''
  return `${Math.round(c * 100)}%`
}
const barWidth = (c) => {
  if (typeof c !== 'number' || Number.isNaN(c)) return '0%'
  return `${Math.max(0, Math.min(100, c * 100))}%`
}

async function loadLinks(taxon) {
  if (!taxon) return
  if (linksCache.value[taxon]) return
  const links = await getLinks(taxon)
  linksCache.value = { ...linksCache.value, [taxon]: links }
}

// Fetch links for the visible taxa once the panel is first expanded.
watch(open, (isOpen) => {
  if (!isOpen) return
  const taxa = new Set()
  if (recordedTaxon.value) taxa.add(recordedTaxon.value)
  topSubspecies.value.forEach(([t]) => t && taxa.add(t))
  topSpecies.value.forEach(([t]) => t && taxa.add(t))
  topGenus.value.forEach(([t]) => t && taxa.add(t))
  taxa.forEach(loadLinks)
})

async function load() {
  state.value = 'loading'
  try {
    const p = await getPredictions(camid.value)
    if (!p) { pred.value = null; state.value = 'none'; return }
    pred.value = p
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

watch(camid, load, { immediate: true })

function linkFor(taxon, src) {
  return linksCache.value[taxon] ? linksCache.value[taxon][src] : null
}
</script>

<template>
  <div class="pred-panel border rounded mt-2 bg-white">
    <!-- Header / toggle -->
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

    <!-- Body -->
    <div v-show="open" :id="'pred-body-' + camid" class="pred-body px-2 pb-2">
      <!-- States -->
      <div v-if="state === 'loading'" class="text-muted small py-2 d-flex align-items-center gap-2">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Loading predictions&hellip;
      </div>
      <div v-else-if="state === 'error'" class="text-danger small py-2">
        Could not load predictions.
      </div>
      <div v-else-if="state === 'none'" class="text-muted small py-2">
        No model prediction available for this specimen.
      </div>

      <template v-else>
        <p
          v-if="!hasRecordedSubsp && topSubspName"
          class="small text-info-emphasis mb-2 mt-1"
        >No subspecies recorded &mdash; model suggests:</p>

        <!-- Subspecies -->
        <div v-if="topSubspecies.length" class="pred-group">
          <div class="pred-group-title">Subspecies</div>
          <div
            v-for="([taxon, conf], i) in topSubspecies"
            :key="'ss-' + i"
            class="pred-row"
            :class="{ 'pred-suggest': i === 0 && !hasRecordedSubsp }"
          >
            <div class="pred-row-main">
              <span class="pred-name" :title="taxon">{{ taxon }}</span>
              <span class="pred-pct">{{ fmtPct(conf) }}</span>
            </div>
            <div class="pred-bar"><span class="pred-bar-fill" :style="{ width: barWidth(conf) }"></span></div>
            <div class="pred-chips">
              <a
                v-for="src in SOURCE_KEYS"
                :key="src"
                class="src-chip"
                :href="linkFor(taxon, src) || '#'"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[src] }}</a>
            </div>
          </div>
        </div>

        <!-- Species -->
        <div v-if="topSpecies.length" class="pred-group">
          <div class="pred-group-title">Species</div>
          <div v-for="([taxon, conf], i) in topSpecies" :key="'sp-' + i" class="pred-row">
            <div class="pred-row-main">
              <span class="pred-name" :title="taxon">{{ taxon }}</span>
              <span class="pred-pct">{{ fmtPct(conf) }}</span>
            </div>
            <div class="pred-bar"><span class="pred-bar-fill" :style="{ width: barWidth(conf) }"></span></div>
            <div class="pred-chips">
              <a
                v-for="src in SOURCE_KEYS"
                :key="src"
                class="src-chip"
                :href="linkFor(taxon, src) || '#'"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[src] }}</a>
            </div>
          </div>
        </div>

        <!-- Genus -->
        <div v-if="topGenus.length" class="pred-group">
          <div class="pred-group-title">Genus</div>
          <div v-for="([taxon, conf], i) in topGenus" :key="'g-' + i" class="pred-row">
            <div class="pred-row-main">
              <span class="pred-name" :title="taxon">{{ taxon }}</span>
              <span class="pred-pct">{{ fmtPct(conf) }}</span>
            </div>
            <div class="pred-bar"><span class="pred-bar-fill" :style="{ width: barWidth(conf) }"></span></div>
          </div>
        </div>

        <!-- Recorded ID with its own source chips -->
        <div v-if="recordedTaxon" class="pred-group pred-recorded">
          <div class="pred-group-title">Recorded ID</div>
          <div class="pred-row">
            <div class="pred-row-main">
              <span class="pred-name" :title="recordedTaxon">{{ recordedTaxon }}</span>
              <span v-if="speciesDiffers || subspDiffers" class="diff-chip" aria-hidden="true">&#9888;</span>
            </div>
            <div class="pred-chips">
              <a
                v-for="src in SOURCE_KEYS"
                :key="src"
                class="src-chip"
                :href="linkFor(recordedTaxon, src) || '#'"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Open ${recordedTaxon} on ${SOURCE_FULL_NAMES[src]} (opens in new tab)`"
              >{{ SOURCE_LABELS[src] }}</a>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pred-panel {
  font-size: 0.8rem;
}
.pred-head {
  background: #f1f5f9;
  border: none;
  border-radius: inherit;
  min-height: 36px;
  color: #1e293b;
}
.pred-head:focus-visible {
  outline: 2px solid #0d6efd;
  outline-offset: -2px;
}
.chevron {
  transition: transform 0.15s ease;
  color: #64748b;
}
.chevron.open { transform: rotate(90deg); }

.pred-group { margin-top: 0.5rem; }
.pred-group-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  font-weight: 700;
  margin-bottom: 0.15rem;
}
.pred-row {
  margin-bottom: 0.35rem;
}
.pred-row-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.pred-name {
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pred-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #475569;
  flex-shrink: 0;
}
.pred-bar {
  height: 3px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}
.pred-bar-fill {
  display: block;
  height: 100%;
  background: #0d6efd;
  border-radius: 2px;
}
.pred-suggest .pred-name { font-weight: 700; color: #0c5460; }
.pred-suggest .pred-bar-fill { background: #0dcaf0; }

.pred-recorded {
  border-top: 1px solid #e2e8f0;
  padding-top: 0.4rem;
}

/* Source cross-link chips (Feature 3) */
.pred-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.2rem;
}
.src-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 1px 6px;
  font-size: 0.68rem;
  line-height: 1.2;
  text-decoration: none;
  color: #0d6efd;
  background: #eef4ff;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
}
.src-chip:hover { background: #dbe8ff; }
.src-chip:focus-visible {
  outline: 2px solid #0d6efd;
  outline-offset: 1px;
}
.diff-chip {
  color: #b45309;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .pred-panel { font-size: 0.78rem; }
}
</style>
