<script setup>
// AI Identifier candidates column: the "Where taken?" location chips, then a flat,
// species-first list (top 5, "Show more" to 10) with subspecies chips, iNaturalist
// thumbnails for the visible top 5, and a one-line genus summary. Selection state
// lives in the parent; this emits `select` (and `activate` on click / Enter, which
// opens the reference sheet on phones). Location changes are emitted too, so the
// parent keeps the single rerank() path.
import { ref, computed, watch, nextTick } from 'vue'
import FilterSelect from './FilterSelect.vue'
import { speciesCandidates, formatGenusSummary, fmtPct, stepSelection } from '../utils/aiCandidates.js'
import { fieldPhotos } from '../utils/inatPhotos.js'

const props = defineProps({
  pred: { type: Object, default: null },
  selected: { type: String, default: '' },
  suggest: { type: Array, default: () => [] },     // suggestLocations() output
  country: { type: String, default: 'Any' },
  region: { type: String, default: null },
  countryOptions: { type: Array, default: () => ['Any'] },
  regionOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['select', 'activate', 'any', 'suggest', 'set-country', 'set-region'])

const ANY = 'Any'
const THUMB_ROWS = 5
const expanded = ref(false)
const cands = computed(() => speciesCandidates(props.pred, expanded.value ? 10 : 5))
const hasMore = computed(() => (props.pred?.species || []).length > 5)
const genusLine = computed(() => formatGenusSummary(props.pred))
const hasLocation = computed(() => props.country !== ANY || !!props.region)

// ---- location chips ----
const sideOf = (r) => (r?.startsWith('West') ? 'West' : r?.startsWith('East') ? 'East' : '')
const suggestLabel = (s) => (s.side ? `${s.country}, ${s.side} of Andes` : s.country)
const isSuggestActive = (s) => props.country === s.country && sideOf(props.region) === s.side
const suggestActive = computed(() => props.suggest.some(isSuggestActive))
const otherActive = computed(() => hasLocation.value && !suggestActive.value)
const showOther = ref(false)
watch(otherActive, (on) => { if (on) showOther.value = true })

// ---- iNaturalist thumbnails for the visible top 5 (species level, any place) ----
const thumbs = ref({})   // taxon -> [thumb urls]
watch(() => speciesCandidates(props.pred, THUMB_ROWS).map((c) => c.taxon).join('|'), (key) => {
  for (const taxon of key ? key.split('|') : []) {
    if (thumbs.value[taxon]) continue
    thumbs.value = { ...thumbs.value, [taxon]: [] }
    fieldPhotos(taxon)
      .then((r) => { thumbs.value = { ...thumbs.value, [taxon]: r.photos.slice(0, 3).map((p) => p.thumb) } })
      .catch(() => {})
  }
}, { immediate: true })

// ---- selection + keyboard ----
const listEl = ref(null)
function focusTaxon(taxon) {
  nextTick(() => {
    const el = [...(listEl.value?.querySelectorAll('[data-taxon]') || [])].find((x) => x.dataset.taxon === taxon)
    el?.focus()
  })
}
function onKey(e) {
  const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!d) return
  e.preventDefault()
  const next = stepSelection(cands.value, props.selected, d)
  if (next && next !== props.selected) emit('select', next)
  focusTaxon(next)
}
const isSel = (t) => t === props.selected
// roving tabindex: the selected option (or the first) is the tab stop
const tabStop = computed(() => {
  const all = cands.value.flatMap((c) => [c.taxon, ...c.subspecies.map((s) => s.taxon)])
  return all.includes(props.selected) ? props.selected : all[0]
})
function activate(taxon) { emit('select', taxon); emit('activate', taxon) }
</script>

<template>
  <div class="ai-cands">
    <!-- Where taken? -->
    <div class="where" role="group" aria-labelledby="where-lbl">
      <div id="where-lbl" class="col-title">Where taken?</div>
      <div class="chips">
        <button type="button" class="btn btn-sm loc-chip" :class="!hasLocation ? 'btn-success' : 'btn-outline-secondary'"
          :aria-pressed="!hasLocation" @click="emit('any')">Any</button>
        <button v-for="s in suggest" :key="s.country + s.side" type="button"
          class="btn btn-sm loc-chip" :class="isSuggestActive(s) ? 'btn-success' : 'btn-outline-secondary'"
          :aria-pressed="isSuggestActive(s)" @click="emit('suggest', s)">{{ suggestLabel(s) }}</button>
        <button type="button" class="btn btn-sm loc-chip" :class="otherActive ? 'btn-success' : 'btn-outline-secondary'"
          :aria-pressed="otherActive" :aria-expanded="showOther" @click="showOther = !showOther">
          {{ otherActive ? `Other: ${country}${sideOf(region) ? `, ${sideOf(region)}` : ''}` : 'Other country…' }}
        </button>
      </div>
      <div v-if="showOther" class="other-sel mt-2">
        <FilterSelect label="Country" :options="countryOptions" :model-value="country"
          placeholder="Any country" @update:model-value="(v) => emit('set-country', v || ANY)" />
        <div v-if="country === 'Ecuador'" class="mt-2">
          <FilterSelect label="Side of the Andes" :options="regionOptions" :model-value="region"
            placeholder="Either side" @update:model-value="(v) => emit('set-region', v)" />
        </div>
      </div>
      <div class="hint text-muted">Pick where the photo was taken to favour species recorded there.</div>
    </div>

    <!-- Candidates -->
    <div class="col-title mt-3" id="cands-lbl">Candidates</div>
    <ul ref="listEl" class="cand-list" role="listbox" aria-labelledby="cands-lbl" @keydown="onKey">
      <li v-for="(c, i) in cands" :key="c.taxon" class="cand" :class="{ sel: isSel(c.taxon) }" role="presentation">
        <button type="button" role="option" class="cand-main" :data-taxon="c.taxon"
          :aria-selected="isSel(c.taxon)" :tabindex="tabStop === c.taxon ? 0 : -1"
          @click="activate(c.taxon)">
          <span class="cand-top">
            <span class="rank">{{ i + 1 }}</span>
            <em class="cand-name">{{ c.taxon }}</em>
            <span v-if="hasLocation && c.oor" class="oor-tag" title="Not recorded in the selected location">off-region</span>
            <span class="cand-pct">{{ fmtPct(c.prob) }}</span>
          </span>
          <span class="bar" aria-hidden="true"><span class="fill" :style="{ width: Math.max(1, Math.round(c.prob * 100)) + '%' }"></span></span>
          <span v-if="i < 5 && thumbs[c.taxon]?.length" class="cand-thumbs" aria-hidden="true">
            <img v-for="u in thumbs[c.taxon]" :key="u" :src="u" alt="" loading="lazy" referrerpolicy="no-referrer" />
          </span>
        </button>
        <div v-if="c.subspecies.length" class="ssp-row">
          <button v-for="s in c.subspecies" :key="s.taxon" type="button" role="option" class="ssp-chip"
            :class="{ sel: isSel(s.taxon) }" :data-taxon="s.taxon" :aria-selected="isSel(s.taxon)"
            :tabindex="tabStop === s.taxon ? 0 : -1" :aria-label="`Subspecies ${s.taxon}, ${fmtPct(s.prob)}`"
            @click="activate(s.taxon)">
            ssp. <em>{{ s.epithet }}</em> {{ fmtPct(s.prob) }}
            <span v-if="hasLocation && s.oor" class="oor-tag">off-region</span>
          </button>
        </div>
      </li>
    </ul>
    <button v-if="hasMore" type="button" class="btn btn-link btn-sm p-0 mt-1" :aria-expanded="expanded"
      @click="expanded = !expanded">{{ expanded ? 'Show fewer' : 'Show more' }}</button>
    <div v-if="genusLine" class="genus-line text-muted mt-2">Genus: {{ genusLine }}</div>
  </div>
</template>

<style scoped>
.col-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin-bottom: .35rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.loc-chip { --bs-btn-padding-y: .2rem; --bs-btn-padding-x: .6rem; --bs-btn-font-size: .78rem; border-radius: 999px; }
.hint { font-size: .72rem; margin-top: .35rem; }
.other-sel { max-width: 360px; }
.cand-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
.cand { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; overflow: hidden; }
.cand.sel { border-color: #16a34a; box-shadow: 0 0 0 1px #16a34a; }
.cand-main { display: flex; flex-direction: column; gap: .3rem; width: 100%; text-align: left; background: transparent; border: none; padding: .5rem .6rem; cursor: pointer; color: inherit; }
.cand-main:hover { background: #f8fafc; }
.cand.sel .cand-main { background: #f0fdf4; }
.cand-main:focus-visible, .ssp-chip:focus-visible { outline: 2px solid #0d6efd; outline-offset: -2px; }
.cand-top { display: flex; align-items: baseline; gap: .4rem; min-width: 0; }
.rank { font-size: .7rem; color: #94a3b8; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.cand-name { font-size: .92rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cand-pct { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; color: #334155; flex: 0 0 auto; }
.bar { display: block; height: 3px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
.bar .fill { display: block; height: 100%; background: #16a34a; }
.cand-thumbs { display: flex; gap: 4px; }
.cand-thumbs img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; background: #e2e8f0; }
.ssp-row { display: flex; flex-wrap: wrap; gap: .3rem; padding: 0 .6rem .5rem 1.6rem; }
.ssp-chip { font-size: .74rem; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; border-radius: 999px; padding: .05rem .5rem; cursor: pointer; }
.ssp-chip:hover { border-color: #94a3b8; }
.ssp-chip.sel { border-color: #16a34a; background: #dcfce7; color: #166534; }
.oor-tag { font-size: .62rem; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 4px; padding: 0 3px; flex: 0 0 auto; font-style: normal; }
.genus-line { font-size: .75rem; }
</style>
