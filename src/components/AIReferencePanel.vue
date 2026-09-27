<script setup>
// Reference panel for the selected taxon (genus, species or subspecies), used by
// the AI Identifier and the Collection compare drawer: header with name +
// probability and the guide links (BoA, Sangay, Noreste, Cotacachi, once per
// taxon), then tabs [Field photos] [Museum]. A genus shows a few photos of each
// of its top species (`members`), labelled by species. Field photos come
// from iNaturalist (research grade, place-filtered when a country is chosen);
// Museum reuses referencesFor() (Sanger collection first, GBIF fallback) with
// zoom-to-wings boxes. One large image with prev/next (arrow keys, swipe) and a
// thumbnail strip.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import AIPhotoView from './AIPhotoView.vue'
import { referencesFor } from '../utils/aiReference.js'
import { fieldPhotos, inatSearchUrl, isSubspecies } from '../utils/inatPhotos.js'
import { getBoxes, getLinks, SOURCE_KEYS, SOURCE_LABELS, SOURCE_FULL_NAMES } from '../composables/useCurationData.js'
import { fmtPct } from '../utils/aiCandidates.js'
import { fallbackToDirect, unproxiedUrl } from '../utils/imageProxy.js'
import { loadTaxonNames, taxonNamesVersion, formerlyText } from '../utils/taxonNames.js'

const props = defineProps({
  taxon: { type: String, default: '' },
  prob: { type: Number, default: null },
  country: { type: String, default: '' },   // '' = any place
  compact: { type: Boolean, default: false }, // bottom-sheet variant (smaller image)
  members: { type: Array, default: () => [] }, // genus selection: its top species
  formerNames: { type: Boolean, default: false }, // header adds "formerly <old name>" (AI Identifier)
})

const MUSEUM_MAX = 16
const PER_MEMBER = 4   // genus mode: photos per species
const tab = ref('field')
const index = ref(0)
const field = ref({ state: 'idle', photos: [] })
const museum = ref({ state: 'idle', photos: [] })
const links = ref([])
const heroBoxes = ref([])
const allPlaces = ref(false)
const broken = ref(new Set())   // image URLs that failed to load (e.g. blocked by the host)
let token = 0
let fieldTimer = null

// "formerly Agraulis vanillae" for a taxon the AI Identifier shows under its corrected name
const namesVersion = ref(taxonNamesVersion())
loadTaxonNames().then(() => { namesVersion.value = taxonNamesVersion() })
const formerly = computed(() => {
  void namesVersion.value
  return props.formerNames && !isGenus.value ? formerlyText(props.taxon) : ''
})

const place = computed(() => (allPlaces.value ? '' : props.country))
const photos = computed(() => (tab.value === 'field' ? field.value.photos : museum.value.photos)
  .filter((p) => !broken.value.has(p.thumb || p.url)))
function markBroken(p) { broken.value = new Set(broken.value).add(p.thumb || p.url) }
const current = computed(() => photos.value[index.value] || null)
// Large image failed through the proxy: retry the original URL once, else hide it.
function onHeroError() {
  const p = current.value
  if (!p) return
  const direct = unproxiedUrl(p.url)
  if (direct && direct !== p.url) p.url = direct
  else markBroken(p)
}
const count = (s) => (s.state === 'ready' || s.state === 'empty'
  ? String(s.photos.filter((p) => !broken.value.has(p.thumb || p.url)).length) : '…')

// Genus mode: when the taxon is a genus with known member species.
const groupMembers = computed(() => (isGenus.value ? props.members.slice(0, 3) : []))
const isGenus = computed(() => !!props.taxon && props.taxon.trim().split(/\s+/).length === 1)
const tag = (photos, group) => photos.slice(0, PER_MEMBER).map((p) => ({ ...p, group }))

async function loadField(t, my) {
  field.value = { state: 'loading', photos: [] }
  try {
    if (groupMembers.value.length) {
      const all = await Promise.all(groupMembers.value.map((m) => fieldPhotos(m, { country: place.value, priority: true })
        .then((r) => ({ ...r, photos: tag(r.photos, m) })).catch(() => ({ photos: [] }))))
      if (my !== token) return
      const photos = all.flatMap((r) => r.photos)
      field.value = { state: photos.length ? 'ready' : 'empty', photos, genus: true,
        placeFallback: all.some((r) => r.placeFallback) && !all.some((r) => r.photos.length && !r.placeFallback) }
      return
    }
    const r = await fieldPhotos(t, { country: place.value, priority: true })
    if (my !== token) return
    field.value = { state: r.photos.length ? 'ready' : 'empty', ...r }
  } catch {
    if (my === token) field.value = { state: 'error', photos: [] }
  }
}
async function loadMuseum(t, my) {
  museum.value = { state: 'loading', photos: [] }
  try {
    if (groupMembers.value.length) {
      const all = await Promise.all(groupMembers.value.map((m) => referencesFor(m, PER_MEMBER)
        .then((r) => ({ ...r, photos: tag(r.photos, m) })).catch(() => ({ photos: [] }))))
      if (my !== token) return
      const photos = all.flatMap((r) => r.photos)
      museum.value = { state: photos.length ? 'ready' : 'empty', photos, genus: true, source: 'mixed', level: 'species' }
      return
    }
    const r = await referencesFor(t, MUSEUM_MAX)
    if (my !== token) return
    museum.value = { state: r.photos.length ? 'ready' : 'empty', ...r }
  } catch {
    if (my === token) museum.value = { state: 'empty', photos: [], source: 'none', level: 'none' }
  }
}
async function loadLinks(t, my) {
  const m = await getLinks(t).catch(() => ({}))
  if (my === token) links.value = SOURCE_KEYS.filter((s) => m?.[s]).map((s) => ({ src: s, url: m[s] }))
}

function reload() {
  const t = props.taxon
  const my = ++token
  index.value = 0
  links.value = []
  if (fieldTimer) clearTimeout(fieldTimer)
  if (!t) { field.value = { state: 'idle', photos: [] }; museum.value = { state: 'idle', photos: [] }; return }
  loadMuseum(t, my)
  loadLinks(t, my)
  // short debounce so arrowing through the list does not queue a request per row
  field.value = { state: 'loading', photos: [] }
  fieldTimer = setTimeout(() => loadField(t, my), 250)
}
watch(() => [props.taxon, groupMembers.value.join('|')].join('#'), reload, { immediate: true })
watch(() => props.country, () => { allPlaces.value = false })
watch(place, () => { if (props.taxon) { index.value = 0; loadField(props.taxon, token) } })
watch(tab, () => { index.value = 0 })
onBeforeUnmount(() => { if (fieldTimer) clearTimeout(fieldTimer) })

// Sanger photos carry a wing_boxes key -> "zoom to wings" on the museum hero.
watch(current, async (p) => {
  heroBoxes.value = []
  if (tab.value === 'museum' && p?.boxKey) {
    try { const b = await getBoxes(p.boxKey); if (current.value === p) heroBoxes.value = b || [] } catch { /* none */ }
  }
})

function step(d) {
  const n = photos.value.length
  if (!n) return
  index.value = Math.max(0, Math.min(n - 1, index.value + d))
}
function onKey(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
}
// swipe left/right on the large image (phones)
let touch = null
function onTouchStart(e) { const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY } }
function onTouchEnd(e) {
  if (!touch) return
  const t = e.changedTouches[0]
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y
  touch = null
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1)
}
defineExpose({ step })

const isSub = computed(() => isSubspecies(props.taxon))
const museumNote = computed(() => {
  const m = museum.value
  if (m.state !== 'ready') return ''
  if (m.genus) return `A few specimens of each top species in ${props.taxon}.`
  const src = m.source === 'sanger' ? 'Sanger / Ikiam collection' : m.source === 'gbif' ? 'GBIF museum and other records' : ''
  const lvl = isSub.value && m.level === 'species' ? 'No museum photos for this subspecies; showing the species. ' : ''
  const as = m.recordedAs?.length ? `. Includes records under ${m.recordedAs.join(', ')}.` : ''
  return lvl + src + as
})
const altFor = (p, i) => (tab.value === 'field'
  ? `Field photo ${i + 1} of ${photos.value.length} of ${p.taxon || p.group || props.taxon}${p.place ? `, ${p.place}` : ''}`
  : `Museum photo ${i + 1} of ${photos.value.length} of ${p.group || props.taxon}: ${p.caption || ''}`)
</script>

<template>
  <section class="ref-panel" :class="{ compact }" aria-label="Reference photos" @keydown="onKey">
    <header class="ref-head">
      <div class="ref-title">
        <em>{{ taxon || 'No taxon selected' }}</em>
        <span v-if="prob != null" class="ref-pct">{{ fmtPct(prob) }}</span>
        <span v-if="formerly" class="ref-formerly">{{ formerly }}</span>
      </div>
      <div v-if="links.length" class="guides">
        <span class="text-muted">Guides:</span>
        <a v-for="l in links" :key="l.src" :href="l.url" target="_blank" rel="noopener noreferrer" class="src-chip"
          :aria-label="`Open ${taxon} on ${SOURCE_FULL_NAMES[l.src]} (opens in new tab)`">{{ SOURCE_LABELS[l.src] }}</a>
      </div>
    </header>

    <div class="nav nav-tabs ref-tabs" role="tablist" aria-label="Reference photo source">
      <button type="button" role="tab" class="nav-link" :class="{ active: tab === 'field' }" id="ref-tab-field"
        :aria-selected="tab === 'field'" aria-controls="ref-tabpanel" @click="tab = 'field'">
        Field photos ({{ count(field) }})
      </button>
      <button type="button" role="tab" class="nav-link" :class="{ active: tab === 'museum' }" id="ref-tab-museum"
        :aria-selected="tab === 'museum'" aria-controls="ref-tabpanel" @click="tab = 'museum'">
        Museum ({{ count(museum) }})
      </button>
    </div>

    <div id="ref-tabpanel" role="tabpanel" :aria-labelledby="tab === 'field' ? 'ref-tab-field' : 'ref-tab-museum'" class="ref-body">
      <!-- notes above the image -->
      <div v-if="tab === 'field'" class="notes">
        <div v-if="field.genus && field.state === 'ready'">A few photos of each top species in {{ taxon }}.</div>
        <div v-if="field.speciesFallback">No field photos for this subspecies; showing the species.</div>
        <div v-if="field.resolvedAs">iNaturalist lists these as <em>{{ field.resolvedAs }}</em>.</div>
        <div v-if="country && field.state === 'ready'">
          <template v-if="allPlaces">All places.</template>
          <template v-else-if="field.placeFallback">None from {{ country }}; showing all places.</template>
          <template v-else>From {{ country }}.</template>
          <button v-if="!field.placeFallback || allPlaces" type="button" class="btn btn-link btn-sm p-0 ms-1 align-baseline"
            @click="allPlaces = !allPlaces">{{ allPlaces ? `Only ${country}` : 'Show all places' }}</button>
        </div>
      </div>
      <div v-else-if="museumNote" class="notes">{{ museumNote }}</div>

      <div v-if="(tab === 'field' ? field : museum).state === 'loading'" class="ref-empty">
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
        <span class="ms-2">Loading {{ tab === 'field' ? 'field' : 'museum' }} photos…</span>
      </div>
      <div v-else-if="tab === 'field' && (field.state === 'empty' || field.state === 'error')" class="ref-empty flex-column">
        <div>{{ field.state === 'error' ? 'Could not load field photos.' : 'No field photos found.' }}</div>
        <a v-if="taxon" :href="inatSearchUrl(taxon)" target="_blank" rel="noopener noreferrer">Search iNaturalist ↗</a>
      </div>
      <div v-else-if="tab === 'museum' && museum.state === 'empty'" class="ref-empty">No museum photos found.</div>

      <template v-else-if="current">
        <div class="hero" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
          <AIPhotoView :key="current.url" :src="current.url" :boxes="heroBoxes" :used-index="-1"
            :show-masks="false" dark :alt="altFor(current, index)" @error="onHeroError" />
          <button v-if="index > 0" type="button" class="hnav hprev" aria-label="Previous photo" @click="step(-1)">‹</button>
          <button v-if="index < photos.length - 1" type="button" class="hnav hnext" aria-label="Next photo" @click="step(1)">›</button>
          <span class="counter" aria-live="polite">{{ index + 1 }} / {{ photos.length }}</span>
        </div>
        <div class="caption">
          <em v-if="current.group" class="cap-group">{{ current.group }}</em>
          <template v-if="tab === 'field'">
            <span v-if="current.place" class="cap-place">{{ current.place }}</span>
            <span v-if="current.observer" class="text-muted">Photo: {{ current.observer }}</span>
            <a v-if="current.link" :href="current.link" target="_blank" rel="noopener noreferrer" class="ms-auto">View on iNaturalist ↗</a>
          </template>
          <template v-else>
            <span class="cap-place">{{ current.caption }}</span>
            <span v-if="current.credit && current.source !== 'sanger'" class="text-muted">{{ current.credit }}</span>
            <a v-if="current.link" :href="current.link" target="_blank" rel="noopener noreferrer" class="ms-auto">View record ↗</a>
          </template>
        </div>
        <div class="strip" aria-label="Photos">
          <button v-for="(p, i) in photos" :key="`${i}|${p.url}`" type="button" class="thumb"
            :aria-label="`Show photo ${i + 1} of ${photos.length}${p.group ? `, ${p.group}` : ''}`" :aria-current="i === index ? 'true' : undefined"
            :title="p.group || undefined" :class="{ active: i === index, 'group-start': p.group && i > 0 && photos[i - 1].group !== p.group }"
            @click="index = i">
            <img :src="p.thumb || p.url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="fallbackToDirect($event) || markBroken(p)" />
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.ref-panel { display: flex; flex-direction: column; gap: .4rem; min-width: 0; }
.ref-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .35rem .75rem; }
.ref-title { font-size: 1.05rem; display: flex; align-items: baseline; gap: .5rem; min-width: 0; }
.ref-title em { overflow-wrap: anywhere; }
.ref-formerly { font-size: .75rem; color: #64748b; }
.ref-pct { font-weight: 600; color: #475569; font-size: .9rem; font-variant-numeric: tabular-nums; }
.guides { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; font-size: .72rem; }
.src-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 7px; font-size: .7rem; text-decoration: none; color: #0d6efd; background: #eef4ff; border: 1px solid #cfe0ff; border-radius: 999px; }
.src-chip:hover { background: #dbe8ff; }
.src-chip:focus-visible, .thumb:focus-visible, .hnav:focus-visible { outline: 2px solid #0d6efd; outline-offset: 2px; }
.ref-tabs .nav-link { font-size: .85rem; padding: .35rem .75rem; }
.notes { font-size: .75rem; color: #64748b; }
.ref-empty { min-height: 200px; display: flex; align-items: center; justify-content: center; gap: .25rem; background: #f1f5f9; border-radius: 8px; color: #64748b; font-size: .85rem; text-align: center; padding: 1rem; }
.hero { position: relative; }
.hero :deep(.ai-photo) { height: 380px; margin-bottom: 0; }
.compact .hero :deep(.ai-photo) { height: 42vh; min-height: 220px; }
.hnav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 5; width: 38px; height: 64px; border: none; background: rgba(0,0,0,.4); color: #fff; font-size: 1.6rem; line-height: 1; cursor: pointer; }
.hnav:hover { background: rgba(0,0,0,.65); }
.hprev { left: 0; border-radius: 0 6px 6px 0; }
.hnext { right: 0; border-radius: 6px 0 0 6px; }
.counter { position: absolute; top: 6px; left: 8px; z-index: 5; font-size: .7rem; color: #e2e8f0; background: rgba(0,0,0,.5); border-radius: 4px; padding: 0 5px; }
.caption { display: flex; flex-wrap: wrap; gap: .25rem .75rem; font-size: .78rem; align-items: baseline; }
.cap-place { font-weight: 600; color: #334155; }
.cap-group { color: #166534; font-weight: 600; }
.thumb.group-start { margin-left: 8px; }
.strip { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
.thumb { flex-shrink: 0; width: 60px; height: 60px; padding: 0; border: 2px solid transparent; border-radius: 4px; background: #e2e8f0; overflow: hidden; cursor: pointer; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb:hover { border-color: #94a3b8; }
.thumb.active { border-color: #16a34a; box-shadow: 0 0 0 1px #16a34a; }
@media (max-width: 575px) { .hero :deep(.ai-photo) { height: 300px; } .thumb { width: 52px; height: 52px; } }
</style>
