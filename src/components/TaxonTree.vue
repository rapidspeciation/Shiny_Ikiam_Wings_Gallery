<script setup>
// Shared compact taxonomy table (Collection cards and AI Identifier):
// genus > species > subspecies, one line per taxon with its probability, a thin
// bar and (optionally) one iNaturalist thumbnail. Opens along the most likely
// path; "+ all species in <genus>" / "+ all subspecies" rows browse every taxon,
// including 0% ones. Every taxon row is selectable (click, Enter); arrows move,
// left/right collapse/expand. Guide links are NOT shown per row: the reference
// panel or drawer shows them once for the selected taxon. Logic in taxonTree.js.
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import {
  buildTree, defaultExpansion, expandEverything, flattenTree, extraRows, probIndex,
  speciesCandidates, subspeciesCandidates, genusMembers, genusOf, treeKeyAction, GENUS_LIMIT,
} from '../utils/taxonTree.js'
import { fmtPct } from '../utils/aiCandidates.js'
import { fieldPhotos } from '../utils/inatPhotos.js'
import { fallbackToDirect } from '../utils/imageProxy.js'
import { getChecklist } from '../composables/useCurationData.js'
import { loadTaxonNames, taxonNamesVersion, formerlyText } from '../utils/taxonNames.js'

const props = defineProps({
  pred: { type: Object, default: null },
  // Collection: { species, subspecies, evidence } of the database record (RECORDED badge)
  recorded: { type: Object, default: null },
  selected: { type: String, default: '' },
  resetKey: { type: String, default: '' },        // expansion resets when this changes
  browse: { type: String, default: 'region' },    // 'region' (checklist by side) | 'vocabulary' (full model output)
  side: { type: String, default: '' },            // region mode: 'East' | 'West' | '' (either side)
  badges: { type: Boolean, default: false },      // RECORDED / PREDICTED badges
  thumbs: { type: Boolean, default: false },      // one iNaturalist thumbnail per species / genus row
  genusLimit: { type: Number, default: GENUS_LIMIT },
  expandAll: { type: Boolean, default: false },
  label: { type: String, default: 'Model predictions' },
  formerNames: { type: Boolean, default: false },  // row tooltip adds "formerly <old name>" (AI Identifier)
})
const emit = defineEmits(['select', 'activate'])

// ---- checklist (region mode) ----
const checklist = ref(null)
onMounted(async () => { if (props.browse === 'region') checklist.value = await getChecklist() })
// old / new taxon names (taxonNames.js): "+ all" rows list a taxon once under either name
const namesVersion = ref(taxonNamesVersion())
onMounted(() => loadTaxonNames().then(() => { namesVersion.value = taxonNamesVersion() }))

// ---- tree + expansion ----
const tree = computed(() => buildTree(props.pred, props.recorded))
const idx = computed(() => probIndex(props.pred))
const topSpecies = computed(() => props.pred?.species?.[0]?.[0] || '')
const topSubsp = computed(() => props.pred?.subspecies?.[0]?.[0] || '')

const open = reactive({ genera: new Set(), species: new Set(), allSpecies: new Set(), allSubspecies: new Set() })
const showAllGenera = ref(false)
// species allowed to offer "+ all subspecies": the default path plus any the user opens
const browseSpecies = reactive(new Set())
function assign(next) {
  for (const k of ['genera', 'species', 'allSpecies', 'allSubspecies']) {
    open[k].clear()
    for (const v of next[k] || []) open[k].add(v)
  }
}
function reset() {
  showAllGenera.value = false
  assign(defaultExpansion(tree.value, { topSpecies: topSpecies.value, recordedSpecies: props.recorded?.species || '', selected: props.selected }))
  browseSpecies.clear()
  for (const v of open.species) browseSpecies.add(v)
  if (props.expandAll) { showAllGenera.value = true; assign({ ...open, ...expandEverything(tree.value) }) }
}
// only a new photo / specimen (or its first prediction) resets; a re-rank keeps the user's layout
watch(() => `${props.resetKey}|${tree.value.length > 0}`, reset, { immediate: true })
watch(() => props.expandAll, reset)
// a selection made outside the table (or kept across a re-rank) stays visible
watch(() => props.selected, (t) => {
  if (!t || rows.value.some((r) => r.taxon === t && r.rank)) return
  const d = defaultExpansion(tree.value, { selected: t })
  for (const k of ['genera', 'species', 'allSpecies', 'allSubspecies']) for (const v of d[k]) open[k].add(v)
  for (const v of d.species) browseSpecies.add(v)
})

// "+ all" candidates, memoised per prediction / checklist
const opts = computed(() => ({ mode: props.browse, checklist: checklist.value, side: props.side }))
const extraCache = computed(() => { void props.pred; void opts.value; void tree.value; void namesVersion.value; return { sp: new Map(), ss: new Map() } })
function extraSpecies(g) {
  const m = extraCache.value.sp
  if (!m.has(g.taxon)) {
    m.set(g.taxon, extraRows(speciesCandidates(props.pred, g.taxon, opts.value), g.species.map((s) => s.taxon), idx.value.species, 'species'))
  }
  return m.get(g.taxon)
}
function extraSubspecies(s) {
  const m = extraCache.value.ss
  if (!m.has(s.taxon)) {
    m.set(s.taxon, extraRows(subspeciesCandidates(props.pred, s.taxon, opts.value), s.subspecies.map((x) => x.taxon), idx.value.subspecies, 'subspecies'))
  }
  return m.get(s.taxon)
}

const keepGenera = computed(() => new Set([genusOf(props.selected), genusOf(props.recorded?.species || '')].filter(Boolean)))
const rows = computed(() => flattenTree(tree.value, {
  ...open, showAllGenera: showAllGenera.value, genusLimit: props.genusLimit, keepGenera: keepGenera.value,
  browseSpecies, extraSpecies, extraSubspecies,
}))

function toggle(r) {
  if (r.kind === 'genus') flip(open.genera, r.taxon)
  else if (r.kind === 'species') {
    // follow what the row shows: an open species with nothing visible counts as closed
    if (r.open) open.species.delete(r.taxon)
    else { open.species.add(r.taxon); browseSpecies.add(r.taxon) }
    // a browsed species has no model subspecies of its own: list them all at once
    if (r.extra && open.species.has(r.taxon)) open.allSubspecies.add(r.taxon)
  } else if (r.kind === 'all-species') flip(open.allSpecies, r.taxon)
  else if (r.kind === 'all-subspecies') flip(open.allSubspecies, r.taxon)
  else if (r.kind === 'more-genera') showAllGenera.value = !showAllGenera.value
}
function flip(set, v) { set.has(v) ? set.delete(v) : set.add(v) }
const isTaxonRow = (r) => r.kind === 'genus' || r.kind === 'species' || r.kind === 'subspecies'
// leaves carry no aria-expanded; toggle rows report whether their list is shown
const ariaExpanded = (r) => (isTaxonRow(r) ? (r.expandable ? r.open : undefined) : r.open)

// ---- display ----
const pct = (p) => (typeof p === 'number' && p >= 0 ? fmtPct(p) : '')
const barW = (p) => (typeof p === 'number' && p > 0 ? `${Math.max(2, Math.round(p * 100))}%` : '0')
const epithet = (t) => t.split(/\s+/).slice(2).join(' ')
const lc = (t) => String(t || '').toLowerCase()
const isRecorded = (r) => !!props.recorded && (
  (r.rank === 'species' && lc(r.taxon) === lc(props.recorded.species)) ||
  (r.rank === 'subspecies' && !!props.recorded.subspecies && lc(r.taxon) === lc(props.recorded.subspecies)))
const isPredicted = (r) => props.badges && (
  (r.rank === 'species' && lc(r.taxon) === lc(topSpecies.value)) ||
  (r.rank === 'subspecies' && lc(r.taxon) === lc(topSubsp.value)))
function toggleLabel(r) {
  if (r.kind === 'more-genera') return r.open ? '− fewer genera' : `+ ${r.count} more genera`
  const where = props.browse === 'region' && props.side ? `, ${props.side}` : ''
  if (r.kind === 'all-species') return r.open ? '− fewer species' : `+ all species in ${r.taxon} (${r.count}${where})`
  return r.open ? '− fewer subspecies' : `+ all subspecies (${r.count}${where})`
}
const rowTitle = (r) => {
  if (!isTaxonRow(r)) return undefined
  void namesVersion.value
  const f = props.formerNames && r.rank !== 'genus' ? formerlyText(r.taxon) : ''
  return f ? `${r.taxon} (${f})` : r.taxon
}
const rowLabel = (r) => {
  if (!isTaxonRow(r)) return toggleLabel(r)
  const bits = [`${r.rank} ${r.taxon}`]
  if (pct(r.prob)) bits.push(pct(r.prob))
  if (isRecorded(r)) bits.push('recorded')
  if (isPredicted(r)) bits.push('predicted')
  if (r.oor) bits.push('off-region')
  return bits.join(', ')
}

// ---- thumbnails: one per species row (genus rows use their top species) ----
const thumbFor = (r) => {
  if (!props.thumbs) return ''
  if (r.kind === 'species') return r.taxon
  if (r.kind === 'genus') {
    const g = tree.value.find((x) => x.taxon === r.taxon)
    return g?.species[0]?.taxon || genusMembers(props.pred, r.taxon, 1)[0] || ''
  }
  return ''
}
const thumbUrl = ref({})   // taxon -> url | '' (loading / none)
function loadThumb(taxon) {
  if (!taxon || taxon in thumbUrl.value) return
  thumbUrl.value = { ...thumbUrl.value, [taxon]: '' }
  fieldPhotos(taxon)
    .then((r) => { thumbUrl.value = { ...thumbUrl.value, [taxon]: r.photos[0]?.thumb || '' } })
    .catch(() => {})
}
// Only rows actually on screen fetch (respects the iNaturalist token bucket).
let io = null
function observeThumb(el) {
  if (!el || !props.thumbs) return
  if (!io) {
    if (typeof IntersectionObserver !== 'function') { loadThumb(el.dataset.thumb); return }
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { loadThumb(e.target.dataset.thumb); io.unobserve(e.target) }
    }, { rootMargin: '80px' })
  }
  io.observe(el)
}
onBeforeUnmount(() => io?.disconnect())

// ---- selection + keyboard (roving tabindex over the visible rows) ----
const treeEl = ref(null)
const focusKey = ref('')
const tabStop = computed(() => {
  const keys = rows.value.map((r) => r.key)
  if (keys.includes(focusKey.value)) return focusKey.value
  const sel = rows.value.find((r) => isTaxonRow(r) && r.taxon === props.selected)
  return sel ? sel.key : keys[0]
})
function focusRow(key) {
  focusKey.value = key
  nextTick(() => [...(treeEl.value?.querySelectorAll('[data-key]') || [])].find((x) => x.dataset.key === key)?.focus())
}
function choose(r) {
  if (!isTaxonRow(r)) { toggle(r); return }
  focusKey.value = r.key
  if (r.expandable && !r.open) toggle(r)
  emit('select', r.taxon)
  emit('activate', r.taxon)
}
function onKey(e, r) {
  const act = treeKeyAction(rows.value, r.key, e.key)
  if (!act) return
  e.preventDefault()
  if (act.focus) focusRow(act.focus)
  else if (act.toggle) toggle(r)
  else if (act.select) choose(r)
}
defineExpose({ rows })
</script>

<template>
  <div ref="treeEl" class="taxon-tree" :class="{ 'with-thumbs': thumbs }" role="tree" :aria-label="label">
    <div v-for="r in rows" :key="r.key" :data-key="r.key" role="treeitem"
      class="tt-row" :class="[`lv${r.level}`, `k-${r.kind}`, {
        sel: isTaxonRow(r) && r.taxon === selected, extra: r.extra, 'rec-hit': isTaxonRow(r) && isRecorded(r) }]"
      :aria-level="r.level" :aria-expanded="ariaExpanded(r)"
      :aria-selected="isTaxonRow(r) ? r.taxon === selected : undefined" :aria-label="rowLabel(r)"
      :tabindex="r.key === tabStop ? 0 : -1" :title="rowTitle(r)"
      @click="choose(r)" @keydown="onKey($event, r)">
      <template v-if="isTaxonRow(r)">
        <span v-if="r.expandable" class="tt-chev" :class="{ open: r.open }" aria-hidden="true"
          @click.stop="toggle(r)">&#9656;</span>
        <span v-else class="tt-chev none" aria-hidden="true"></span>
        <span v-if="thumbFor(r)" :ref="observeThumb" :data-thumb="thumbFor(r)" class="tt-thumb" aria-hidden="true">
          <img v-if="thumbUrl[thumbFor(r)]" :src="thumbUrl[thumbFor(r)]" alt="" loading="lazy" referrerpolicy="no-referrer"
            @error="fallbackToDirect($event)" />
        </span>
        <span v-else-if="thumbs && r.kind !== 'subspecies'" class="tt-thumb empty" aria-hidden="true"></span>
        <span class="tt-name">
          <template v-if="r.rank === 'genus'">{{ r.taxon }}</template>
          <template v-else-if="r.rank === 'species'"><em>{{ r.taxon }}</em></template>
          <template v-else><span class="ssp">ssp.</span> <em>{{ epithet(r.taxon) }}</em></template>
        </span>
        <span v-if="isRecorded(r)" class="tt-badge rec" title="Recorded ID in the database">recorded</span>
        <span v-if="isPredicted(r)" class="tt-badge pred" title="Model's top prediction">predicted</span>
        <span v-if="r.oor" class="tt-badge oor" title="Not recorded in the selected region">off-region</span>
        <span class="tt-bar" aria-hidden="true"><span class="fill" :style="{ width: barW(r.prob) }"></span></span>
        <span class="tt-pct">{{ pct(r.prob) }}</span>
      </template>
      <span v-else class="tt-more">{{ toggleLabel(r) }}</span>
    </div>
  </div>
</template>

<style scoped>
.taxon-tree { font-size: .8rem; line-height: 1.25; }
.tt-row { display: flex; align-items: center; gap: .35rem; min-height: 20px; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
.tt-row:hover { background: #f1f5f9; }
.tt-row:focus-visible { outline: 2px solid #0d6efd; outline-offset: -2px; }
.lv1 { margin-top: 2px; }
.lv1.k-genus { background: #e9eef5; font-weight: 700; color: #1e293b; }
.lv1.k-genus:hover { background: #dde5ef; }
.lv2 { padding-left: calc(6px + 1rem); }
.lv3 { padding-left: calc(6px + 2.3rem); }
.tt-row.sel { background: #dcfce7; box-shadow: inset 3px 0 0 #16a34a; }
.tt-row.sel:hover { background: #d1fadf; }
.rec-hit:not(.sel) { background: #fff8e1; box-shadow: inset 3px 0 0 #f59e0b; }
.tt-chev { flex: 0 0 14px; width: 14px; text-align: center; color: #64748b; font-size: .7rem; transition: transform .15s ease; }
.tt-chev.open { transform: rotate(90deg); }
.tt-thumb { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 4px; background: #e2e8f0; overflow: hidden; }
.tt-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.with-thumbs .tt-row { min-height: 32px; }
.with-thumbs .k-subspecies, .with-thumbs .tt-row:not(.k-genus):not(.k-species) { min-height: 24px; }
.tt-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssp { color: #94a3b8; font-size: .9em; }
.extra .tt-name { color: #64748b; }
.tt-badge { flex: 0 0 auto; font-size: .58rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; padding: 0 4px; border: 1px solid; }
.tt-badge.rec { color: #92400e; background: #fef3c7; border-color: #fde68a; }
.tt-badge.pred { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
.tt-badge.oor { color: #b45309; background: #fff7ed; border-color: #fed7aa; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: .62rem; }
.tt-bar { flex: 0 0 44px; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
.tt-bar .fill { display: block; height: 100%; background: #16a34a; }
.k-genus .tt-bar .fill { background: #64748b; }
.extra .tt-bar .fill { background: #94a3b8; }
.tt-pct { flex: 0 0 2.4rem; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: #475569; }
.tt-more { color: #475569; font-size: .72rem; border: 1px dashed #cbd5e1; background: #f8fafc; border-radius: 999px; padding: 0 8px; }
.tt-row:hover .tt-more { border-color: #94a3b8; background: #eef2f7; }
.k-all-species, .k-all-subspecies, .k-more-genera { min-height: 22px; }
.k-all-species { padding-left: calc(6px + 1rem + 14px + .35rem); }
.k-all-subspecies { padding-left: calc(6px + 2.3rem); }
</style>
