<script setup>
// Compare drawer for gallery cards: a taxon clicked in a card's prediction table
// opens this side panel (a bottom sheet on phones) with the specimen's own photos
// beside the reference panel (Field / Museum photos + guide links) for that
// taxon, so a disagreement with the recorded ID can be checked quickly. Mounted
// once in App.vue; state lives in useTaxonDrawer().
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import AIPhotoView from './AIPhotoView.vue'
import AIReferencePanel from './AIReferencePanel.vue'
import { useTaxonDrawer } from '../composables/useTaxonDrawer.js'
import { getBoxes } from '../composables/useCurationData.js'
import { getProxiedUrl, notifyTierFailed } from '../utils/imageProxy.js'
import { taxonInfo } from '../utils/aiCandidates.js'
import { genusMembers, rankOf } from '../utils/taxonTree.js'

const { state, setTaxon, closeDrawer } = useTaxonDrawer()
const panel = ref(null)
const refPanel = ref(null)

const item = computed(() => state.item || {})
const info = computed(() => taxonInfo(state.pred, state.taxon))
const members = computed(() => (rankOf(state.taxon) === 'genus' ? genusMembers(state.pred, state.taxon, 3) : []))
const recordedTaxon = computed(() => state.recorded?.subspecies || state.recorded?.species || '')
const predictedTaxon = computed(() => state.pred?.species?.[0]?.[0] || '')
// one-tap switches between the recorded ID and the model's top call
const quick = computed(() => {
  const out = []
  if (recordedTaxon.value) out.push({ label: 'Recorded', taxon: recordedTaxon.value })
  if (predictedTaxon.value && predictedTaxon.value !== state.recorded?.species) out.push({ label: 'Model', taxon: predictedTaxon.value })
  return out
})

// ---- the specimen's own photos (dorsal first) ----
const photos = ref([])   // { name, original, src, boxes }
function specimenPhotos(it) {
  let list = []
  if (it.all_photos?.length) list = it.all_photos.map((p) => ({ name: p.Name, original: p.URL_to_view }))
  else {
    if (it.URLd) list.push({ name: `${it.CAM_ID}d.JPG`, original: it.URLd })
    if (it.URLv) list.push({ name: `${it.CAM_ID}v.JPG`, original: it.URLv })
  }
  const order = (n) => (/d\d*\.jpe?g$/i.test(n) ? 0 : /v\d*\.jpe?g$/i.test(n) ? 1 : 2)
  return list.filter((p) => p.original).sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name))
}
watch(() => state.item, async (it) => {
  photos.value = it ? specimenPhotos(it).map((p) => ({ ...p, src: getProxiedUrl(p.original), boxes: [] })) : []
  for (const p of photos.value) {
    getBoxes(p.name).then((b) => { p.boxes = b || [] }).catch(() => {})
  }
})
// image tier failed (e.g. proxy blocked): mark it and retry through the next tier
function onPhotoError(p) {
  notifyTierFailed(p.src)
  const next = getProxiedUrl(p.original)
  if (next !== p.src) p.src = next
}

// ---- open / close ----
const MOBILE_QUERY = '(max-width: 767.98px)'
const isMobile = ref(false)
let mq = null
const onMq = (e) => { isMobile.value = e.matches }
onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    mq = window.matchMedia(MOBILE_QUERY); isMobile.value = mq.matches; mq.addEventListener?.('change', onMq)
  }
})
onBeforeUnmount(() => { mq?.removeEventListener?.('change', onMq); document.body.style.overflow = '' })
watch(() => state.open, (on) => {
  document.body.style.overflow = on ? 'hidden' : ''
  if (on) nextTick(() => panel.value?.focus())
})
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeDrawer() }
  else if (e.target === panel.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); refPanel.value?.step(e.key === 'ArrowLeft' ? -1 : 1)
  }
}
const recordedLabel = computed(() => recordedTaxon.value || 'No ID recorded')
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" class="drawer-backdrop" :class="{ mobile: isMobile }" @click.self="closeDrawer">
      <div ref="panel" class="drawer" role="dialog" aria-modal="true" :aria-label="`Compare ${item.CAM_ID || 'specimen'} with reference photos`"
        tabindex="-1" @keydown="onKey">
        <div class="drawer-head">
          <div class="drawer-title">
            <span class="fw-semibold">Compare {{ item.CAM_ID }}</span>
            <span class="text-muted small">Recorded: <em>{{ recordedLabel }}</em></span>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="closeDrawer"></button>
        </div>

        <div class="drawer-body">
          <section class="specimen" aria-label="This specimen">
            <div class="col-title">This specimen</div>
            <div class="spec-photos">
              <div v-for="p in photos" :key="p.name" class="spec-photo">
                <AIPhotoView :src="p.src" :boxes="p.boxes" :used-index="-1" :show-masks="false" dark
                  :alt="`${item.CAM_ID} ${/d\d*\./i.test(p.name) ? 'dorsal' : 'ventral'}`" @error="onPhotoError(p)" />
                <span class="spec-lbl">{{ /d\d*\./i.test(p.name) ? 'Dorsal' : /v\d*\./i.test(p.name) ? 'Ventral' : p.name }}</span>
              </div>
              <div v-if="!photos.length" class="text-muted small">No photos for this specimen.</div>
            </div>
          </section>

          <section class="reference" aria-label="Reference">
            <div class="quick" v-if="quick.length">
              <span class="col-title mb-0">Show</span>
              <button v-for="q in quick" :key="q.label" type="button" class="btn btn-sm quick-chip"
                :class="state.taxon === q.taxon ? 'btn-success' : 'btn-outline-secondary'" :aria-pressed="state.taxon === q.taxon"
                @click="setTaxon(q.taxon)">{{ q.label }}: <em>{{ q.taxon }}</em></button>
            </div>
            <AIReferencePanel ref="refPanel" :compact="isMobile" :taxon="state.taxon" :prob="info?.prob ?? null" :members="members" />
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop { position: fixed; inset: 0; z-index: 1060; background: rgba(15,23,42,.45); display: flex; justify-content: flex-end; }
.drawer { width: min(1040px, 94vw); height: 100%; display: flex; flex-direction: column; background: #fff; box-shadow: -8px 0 30px rgba(0,0,0,.25); outline: none; animation: slide-in .18s ease-out; }
@keyframes slide-in { from { transform: translateX(40px); opacity: .6; } to { transform: none; opacity: 1; } }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .7rem 1rem; border-bottom: 1px solid #e2e8f0; }
.drawer-title { display: flex; flex-direction: column; min-width: 0; }
.drawer-body { flex: 1 1 auto; overflow-y: auto; display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 1rem; padding: .8rem 1rem 1rem; }
.col-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin-bottom: .35rem; }
.spec-photos { display: flex; flex-direction: column; gap: .5rem; }
.spec-photo { position: relative; }
.spec-photo :deep(.ai-photo) { height: 300px; margin-bottom: 0; }
.spec-lbl { position: absolute; left: 6px; top: 6px; font-size: .68rem; color: #fff; background: rgba(0,0,0,.55); border-radius: 4px; padding: 0 5px; }
.quick { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; margin-bottom: .5rem; }
.quick-chip { --bs-btn-padding-y: .1rem; --bs-btn-padding-x: .55rem; --bs-btn-font-size: .76rem; border-radius: 999px; }

/* phones: bottom sheet, the specimen photos in a row above the reference */
.drawer-backdrop.mobile { align-items: flex-end; justify-content: stretch; }
.mobile .drawer { width: 100%; height: auto; max-height: 92vh; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,.25); animation: none; }
.mobile .drawer-body { grid-template-columns: minmax(0, 1fr); gap: .6rem; padding: .5rem .75rem 1rem; }
.mobile .spec-photos { flex-direction: row; overflow-x: auto; }
.mobile .spec-photo { flex: 1 0 45%; }
.mobile .spec-photo :deep(.ai-photo) { height: 20vh; min-height: 120px; }
.mobile .spec-photo :deep(.frame-btn) { display: none; }
</style>
