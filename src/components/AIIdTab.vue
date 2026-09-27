<script setup>
// AI Identifier tab: upload butterfly photo(s) -> BioCLIP 2.5-H prediction (genus ▸
// species ▸ subspecies). Inference runs ONCE per photo (raw leaf probabilities);
// the country + side-of-Andes prior is a pure client-side re-rank, so each result
// can change its location after the fact (or tap a suggested one) with no re-inference.
// Photos stream in one-by-one as the model finishes each (concurrency pool). The
// YOLO wing-crop returns selectable masks: the largest runs on Identify, others run
// lazily when their bbox is clicked.
//
// Results view, per photo (photos switch via tabs): the "Where taken?" chips
// (AILocationChips), a low-confidence banner and the shared taxonomy table
// (TaxonTree: genus > species > subspecies with every taxon browsable), the
// uploaded photo (sticky), and a reference panel for the selected taxon with
// iNaturalist field photos and museum photos (AIReferencePanel; a genus shows its
// top species). Phones get a sticky mini-bar and a bottom sheet that pins the
// user's photo above the reference photos.
import { ref, computed, watch, nextTick, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import AILocationChips from './AILocationChips.vue'
import TaxonTree from './TaxonTree.vue'
import AIReferencePanel from './AIReferencePanel.vue'
import AIPhotoView from './AIPhotoView.vue'
import InferenceProgress from './InferenceProgress.vue'
import { taxonInfo, fmtPct, lowConfidenceMessage } from '../utils/aiCandidates.js'
import { keepSelection, genusMembers, rankOf } from '../utils/taxonTree.js'
import { predictStream, predictOne, rankLeaves, getStatus, makeJobId, wakeBackend, HAS_BACKEND, PREDICTION_CACHE_VERSION } from '../utils/aiPredict.js'
import { loadCountries, suggestLocations } from '../utils/geoPrior.js'
import { getChecklist } from '../composables/useCurationData.js'

// ---- intake ----
const items = ref([])              // { id, name, previewUrl, blob, status, error }
const preparing = ref(false)
const fileInput = ref(null)
const cameraInput = ref(null)
const isOver = ref(false)
const dragActive = ref(false)      // full-page drag overlay
let _id = 0

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('decode'))
    img.src = URL.createObjectURL(file)
  })
}

// Downscale on-device so the free-tier backend isn't fed 8–20 MB phone photos.
async function downscale(file, maxEdge = 1600, q = 0.85) {
  const img = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0, w, h)
  URL.revokeObjectURL(img.src)
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
}

async function addFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  preparing.value = true
  for (const file of files) {
    const id = `img_${++_id}`
    if (!file.type.startsWith('image/') || /\.hei[cf]$/i.test(file.name)) {
      items.value.push({ id, name: file.name || 'image', previewUrl: null, blob: null, status: 'invalid',
        error: /\.hei[cf]$/i.test(file.name) ? 'HEIC isn\'t supported in browsers; set your camera to "Most Compatible" (JPEG).' : 'Not an image file.' })
      continue
    }
    const previewUrl = URL.createObjectURL(file)
    try {
      const blob = await downscale(file)
      items.value.push({ id, name: file.name || `pasted-${_id}.jpg`, previewUrl, blob, status: 'ready', error: null })
    } catch {
      items.value.push({ id, name: file.name || 'image', previewUrl, blob: null, status: 'invalid', error: 'Could not read this image.' })
    }
  }
  preparing.value = false
}

function onPick(e) { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }
function removeItem(id) {
  const i = items.value.findIndex((x) => x.id === id)
  if (i >= 0) { if (items.value[i].previewUrl) URL.revokeObjectURL(items.value[i].previewUrl); items.value.splice(i, 1) }
  const ri = results.value.findIndex((x) => x.id === id)
  if (ri >= 0) results.value.splice(ri, 1)
  if (activeId.value === id) activeId.value = results.value[0]?.id || ''
}
function clearAll() {
  items.value.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl))
  items.value = []; results.value = []; errorMsg.value = ''; activeId.value = ''; sheetOpen.value = false
}
const validItems = computed(() => items.value.filter((i) => i.status === 'ready' && i.blob))

// ---- drop anywhere on the page + paste from clipboard ----
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
let dragDepth = 0
function onWinDragEnter(e) { if (hasFiles(e)) { dragDepth++; dragActive.value = true } }
function onWinDragOver(e) { if (hasFiles(e)) e.preventDefault() }   // allow the drop
function onWinDragLeave(e) { if (hasFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragActive.value = false } }
function onWinDrop(e) {
  if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files) }
  dragDepth = 0; dragActive.value = false
}
function onPaste(e) {
  const files = Array.from(e.clipboardData?.items || [])
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean)
  if (files.length) { e.preventDefault(); addFiles(files) }
}

onMounted(async () => {
  wakeBackend(); startWarm()   // wake the Space + show its warm state the moment the tab opens
  window.addEventListener('dragenter', onWinDragEnter)
  window.addEventListener('dragover', onWinDragOver)
  window.addEventListener('dragleave', onWinDragLeave)
  window.addEventListener('drop', onWinDrop)
  window.addEventListener('paste', onPaste)
  if (typeof window.matchMedia === 'function') {
    mobileMq = window.matchMedia(MOBILE_QUERY)
    isMobile.value = mobileMq.matches
    mobileMq.addEventListener?.('change', onMq)
  }
  checklist.value = await getChecklist()
  for (const r of results.value) if (r.leaves) r.suggest = suggestLocations(checklist.value, r.leaves)
  countryOptions.value = [ANY, ...(await loadCountries())]
})
// keep-alive caches this tab; re-ping + re-show warm state on return in case it dozed off.
onActivated(() => { wakeBackend(); startWarm() })
// leaving the tab: drop the warm notice and stop the idle poll (a running batch keeps its own).
onDeactivated(() => endWarm())
onBeforeUnmount(() => {
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
  window.removeEventListener('dragenter', onWinDragEnter)
  window.removeEventListener('dragover', onWinDragOver)
  window.removeEventListener('dragleave', onWinDragLeave)
  window.removeEventListener('drop', onWinDrop)
  window.removeEventListener('paste', onPaste)
  mobileMq?.removeEventListener?.('change', onMq)
  lockScroll(false)
  stopPolling()
  items.value.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl))
})

// ---- geographic prior (only applied when the user taps a location per photo) ----
// Each result starts at Any (no prior); the "Where taken?" chips set r.country/r.region.
const REGION_OPTS = ['West of Andes (Pacific / Chocó)', 'East of Andes (Amazon)']
const ANY = 'Any'
const countryOptions = ref([ANY])
const checklist = ref({})
const sideOf = (r) => (r?.startsWith('West') ? 'West' : r?.startsWith('East') ? 'East' : '')
const regionForSide = (s) => (s === 'West' ? REGION_OPTS[0] : s === 'East' ? REGION_OPTS[1] : null)
const cParam = (c) => (c && c !== ANY ? c : '')
const hasLocation = (r) => !!r && (r.country !== ANY || !!r.region)
function resetLocation(r) { r.country = ANY; r.region = null; rerank(r) }

// ---- layout: phones get the mini-bar + bottom sheet ----
const MOBILE_QUERY = '(max-width: 767.98px)'
const isMobile = ref(false)
let mobileMq = null
function onMq(e) { isMobile.value = e.matches; if (!e.matches) closeSheet() }

// ---- run ----
const results = ref([])   // see placeholder shape in run()
const running = ref(false)
const errorMsg = ref('')

// ---- live progress notification (waking / loading / queue / analyzing) ----
// While a batch runs we poll the backend's /status: it reports the model load stage
// (so a cold Space shows "loading the model"), the queue depth (so a busy Space shows
// "Nth in line"), and the representative request's step ("yolo"/"features"). null from
// getStatus means the Space is unreachable, i.e. still waking from sleep.
const statusInfo = ref(null)
const pollTick = ref(0)          // bumps each poll so the time-based "down" cutoff re-evaluates
const activeJobId = ref('')      // most recent in-flight job, for the substage line
const batchTotal = ref(0)
const batchDone = ref(0)
let pollTimer = null
let pollStartAt = 0              // ms epoch when the current wake/poll window began

// How long to wait before declaring the server DOWN instead of "still waking". A cold
// HF Space wake + BioCLIP load runs ~1-2 min; past these the frontend stops spinning
// forever (the old bug) and shows an honest, retryable error instead.
const WAKE_GRACE_MS = 90000      // status unreachable (getStatus === null)
const LOAD_GRACE_MS = 210000     // reachable but never becomes ready (loading/degraded)

async function pollStatus() {
  statusInfo.value = await getStatus(activeJobId.value)
  pollTick.value++
}
function startPolling() {
  if (!HAS_BACKEND || pollTimer) return
  statusInfo.value = null
  pollStartAt = Date.now()
  pollStatus()
  pollTimer = setInterval(pollStatus, 1200)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  statusInfo.value = null; activeJobId.value = ''; pollStartAt = 0
}
// User hit "Try again" on the down notice: restart the wake window and re-ping. Any
// request wakes the Space; if the backend auto-heals meanwhile, the next poll flips
// the notice back to ready on its own.
function retryWarm() {
  pollStartAt = Date.now()
  wakeBackend()
  pollStatus()
}

// Shared "is the server actually down?" check for both the warm and running notices.
// Returns a terminal 'down' notice (red, retryable) once we're past the grace window,
// or null while it's still plausibly just waking/loading.
function downNotice(s, elapsed) {
  if (s === null && elapsed > WAKE_GRACE_MS) {
    return { kind: 'down', title: 'Identifier is unavailable', retryable: true, progress: null,
      detail: 'The server is not responding. It may be down or restarting. Please try again shortly.' }
  }
  if (s && s.stage === 'degraded' && elapsed > LOAD_GRACE_MS) {
    return { kind: 'down', title: 'The model failed to load', retryable: true, progress: null,
      detail: 'The server is up but the model is not loading. It keeps retrying; please try again in a minute.' }
  }
  if (s && !s.ready && s.stage !== 'degraded' && elapsed > LOAD_GRACE_MS) {
    return { kind: 'down', title: 'Identifier is unavailable', retryable: true, progress: null,
      detail: 'The model did not become ready in time. Please try again shortly.' }
  }
  return null
}

const SUBSTAGE = { yolo: 'detecting the wings', features: 'extracting wing features' }

// Notice shown WHILE a batch is running: analyzing / loading / queue / waking.
function runningNotice() {
  const total = Math.max(1, batchTotal.value)
  const counter = total > 1 ? ` (photo ${Math.min(batchDone.value + 1, total)} of ${total})` : ''
  const frac = batchDone.value / total
  if (!HAS_BACKEND) {
    return { kind: 'analyzing', title: 'Analyzing' + counter, detail: 'Running the offline demo model.', progress: frac }
  }
  const s = statusInfo.value
  const down = downNotice(s, pollStartAt ? Date.now() - pollStartAt : 0)
  if (down) return down
  if (s === null) {
    return { kind: 'waking', title: 'Waking up the server',
      detail: 'The free server sleeps when idle; the first wake can take up to a minute.', progress: null }
  }
  if (!s.ready) {
    return { kind: 'loading', title: 'Loading the model',
      detail: 'Getting BioCLIP ready on the server (first run only).', progress: null }
  }
  const waiting = s.queue?.waiting || 0
  if (waiting > 0) {
    return { kind: 'queued', title: 'Waiting in queue',
      detail: `${waiting} request${waiting > 1 ? 's' : ''} ahead of you`, progress: null }
  }
  const sub = SUBSTAGE[s.job] ? `, ${SUBSTAGE[s.job]}` : ''
  return { kind: 'analyzing', title: 'Analyzing' + counter, detail: `On the server${sub}.`, progress: frac }
}

// ---- pre-identify warm-up indicator ----
// On tab open we already ping the Space (wakeBackend). This surfaces that state so the
// user knows whether the server is waking, loading, or already ready BEFORE they upload.
// The "ready" confirmation auto-dismisses after a couple of seconds.
const warmActive = ref(false)
let readyTimer = null

function warmNotice() {
  const s = statusInfo.value
  const down = downNotice(s, pollStartAt ? Date.now() - pollStartAt : 0)
  if (down) return down
  if (s === null) {
    return { kind: 'waking', title: 'Warming up the server',
      detail: 'The free server sleeps when idle; getting it ready so identifying is quick.', progress: null }
  }
  if (s.stage === 'degraded') {
    return { kind: 'loading', title: 'Warming up the model',
      detail: 'The model is taking longer than usual to load; the server is retrying.', progress: null }
  }
  if (!s.ready) {
    return { kind: 'loading', title: 'Warming up the model',
      detail: 'Getting BioCLIP ready on the server (first run only).', progress: null }
  }
  return { kind: 'ready', title: 'Server ready', detail: 'Upload a photo and hit Identify.', progress: 1 }
}

function startWarm() {
  if (!HAS_BACKEND || running.value || warmActive.value) return
  warmActive.value = true
  startPolling()
  // already known-ready (e.g. returning to the tab): show the brief confirmation
  if (statusInfo.value?.ready && !readyTimer) readyTimer = setTimeout(endWarm, 2600)
}
function endWarm() {
  warmActive.value = false
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
  if (!running.value) stopPolling()
}
// When the Space reports ready during warm-up, flash the green confirmation then hide.
watch(() => !!(statusInfo.value && statusInfo.value.ready), (ready) => {
  if (ready && warmActive.value && !running.value && !readyTimer) readyTimer = setTimeout(endWarm, 2600)
})

const progress = computed(() => {
  void pollTick.value   // re-evaluate each poll so the elapsed-time "down" cutoff fires
  if (running.value) return runningNotice()
  if (warmActive.value) return warmNotice()
  return null
})

// Species / genera the table lists before "+ all species" (the *_all lists keep the rest).
const TOP_SPECIES = 10
function rerank(r) {
  r.pred = rankLeaves(r.leaves, checklist.value, { country: cParam(r.country), side: sideOf(r.region), topK: TOP_SPECIES })
  // keep a user-picked taxon while the model still knows it, else follow the top species
  r.selected = keepSelection(r.pred, r.selected, r.userPicked)
}
// Re-rank after new leaves (upload or mask switch) and refresh the location suggestions.
function applyLeaves(r, leaves) {
  r.leaves = leaves
  r.suggest = suggestLocations(checklist.value, leaves)
  rerank(r)
}

function cachedLeaves(r, key) {
  const cached = r.predCache[key]
  return cached?.version === PREDICTION_CACHE_VERSION ? cached.leaves : null
}
function cacheLeaves(r, key, leaves) {
  r.predCache[key] = { version: PREDICTION_CACHE_VERSION, leaves }
}

const byId = (id) => results.value.find((r) => r.id === id)
function alreadyDone(id) { const r = byId(id); return !!(r && !r.loading && !r.error) }
// only photos not yet (successfully) analysed are sent on Identify, so re-clicking
// after adding one more photo doesn't re-run the model on the earlier ones.
const pendingItems = computed(() => validItems.value.filter((it) => !alreadyDone(it.id)))

async function run() {
  if (running.value) return
  const pending = pendingItems.value
  if (!pending.length) return
  running.value = true; errorMsg.value = ''
  warmActive.value = false                              // the run notice takes over
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
  batchTotal.value = pending.length; batchDone.value = 0
  activeId.value = pending[0].id                        // show the first new photo's results
  const jobs = pending.map((it) => makeJobId(it.id))
  startPolling()
  for (const it of pending) {
    const placeholder = {
      id: it.id, filename: it.name, previewUrl: it.previewUrl, file: it,
      loading: true, error: null, mock: false, leaves: null,
      boxes: [], unionBox: null, usedIndex: -1, predCache: {}, maskLoading: false,
      country: ANY, region: null,              // no geographic prior until the user taps one
      suggest: [], pred: null, selected: '', userPicked: false,
    }
    const existing = byId(it.id)
    if (existing) Object.assign(existing, placeholder)
    else results.value.push(placeholder)
  }
  try {
    await predictStream(pending, {
      jobs,
      onStart: (i, jobId) => { activeJobId.value = jobId || '' },
      onResult: (raw) => {
        batchDone.value++
        const r = byId(raw.id); if (!r) return
        r.boxes = raw.boxes || []
        r.unionBox = raw.wing_box || null          // union of all masks (the default crop)
        r.usedIndex = r.boxes.length ? -2 : -1     // -2 = all wings (union), -1 = full image, >=0 = one mask
        r.predCache = {}
        cacheLeaves(r, r.boxes.length ? 'all' : 'full', raw.leaves)
        r.mock = raw.mock; r.loading = false
        applyLeaves(r, raw.leaves)
      },
      onError: (e, i, file) => {
        batchDone.value++
        const r = byId(file.id); if (r) { r.loading = false; r.error = e.message || 'Prediction failed.' }
      },
    })
  } catch (e) {
    errorMsg.value = e.message || 'Prediction failed.'
  } finally {
    running.value = false
    stopPolling()
  }
}

// ---- wing-mask selection (lazy: run BioCLIP on a mask only when it's chosen) ----
async function selectMask(r, i) {
  if (i === r.usedIndex || !r.boxes[i] || r.maskLoading) return
  const cached = cachedLeaves(r, i)
  if (cached) { r.usedIndex = i; applyLeaves(r, cached); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { box: r.boxes[i].box })
    cacheLeaves(r, i, raw.leaves)
    r.usedIndex = i
    applyLeaves(r, raw.leaves)
  } catch (e) {
    errorMsg.value = e.message || 'Mask prediction failed.'
  } finally {
    r.maskLoading = false
  }
}
async function useFull(r) {
  if (r.usedIndex === -1 || r.maskLoading) return
  const cached = cachedLeaves(r, 'full')
  if (cached) { r.usedIndex = -1; applyLeaves(r, cached); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { yolo: 'off' })
    cacheLeaves(r, 'full', raw.leaves)
    r.usedIndex = -1
    applyLeaves(r, raw.leaves)
  } catch (e) {
    errorMsg.value = e.message || 'Full-image prediction failed.'
  } finally {
    r.maskLoading = false
  }
}
// All wings together (union of every detected mask); the default crop.
async function useAll(r) {
  if (r.usedIndex === -2 || r.maskLoading || !r.unionBox) return
  const cached = cachedLeaves(r, 'all')
  if (cached) { r.usedIndex = -2; applyLeaves(r, cached); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { box: r.unionBox })
    cacheLeaves(r, 'all', raw.leaves)
    r.usedIndex = -2
    applyLeaves(r, raw.leaves)
  } catch (e) {
    errorMsg.value = e.message || 'Prediction failed.'
  } finally {
    r.maskLoading = false
  }
}

// per-photo location change ("Where taken?" row)
function setCountry(r, v) { r.country = v || ANY; if (r.country !== 'Ecuador') r.region = null; rerank(r) }
function setRegion(r, v) { r.region = v; rerank(r) }
const isSuggestActive = (r, s) => r.country === s.country && sideOf(r.region) === s.side
// tapping the active suggestion returns to Any
function applySuggestion(r, s) {
  if (isSuggestActive(r, s)) { r.country = ANY; r.region = null }
  else { r.country = s.country; r.region = s.country === 'Ecuador' ? regionForSide(s.side) : null }
  rerank(r)
}

// ---- photo tabs + selection ----
const activeId = ref('')
const active = computed(() => results.value.find((r) => r.id === activeId.value) || results.value[0] || null)
function selectTaxon(r, taxon) { r.selected = taxon; r.userPicked = true }
const selectedInfo = computed(() => (active.value ? taxonInfo(active.value.pred, active.value.selected) : null))
// a genus selection shows photos of its top species
const selectedMembers = computed(() => (active.value && rankOf(active.value.selected) === 'genus'
  ? genusMembers(active.value.pred, active.value.selected, 3) : []))
const lowConfidence = computed(() => (active.value?.pred ? lowConfidenceMessage(active.value.pred, hasLocation(active.value)) : ''))
const treeKey = (r) => `${r.id}|${r.usedIndex}`
const photoTabs = ref(null)
function onPhotoTabKey(e) {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!d || !results.value.length) return
  e.preventDefault()
  const i = results.value.findIndex((r) => r.id === active.value?.id)
  const next = results.value[(i + d + results.value.length) % results.value.length]
  activeId.value = next.id
  nextTick(() => photoTabs.value?.querySelector(`[data-id="${next.id}"]`)?.focus())
}
const topLabel = (r) => (r.loading ? 'Identifying…' : r.error ? 'Failed' : r.pred?.species?.[0]?.[0] || '')

// ---- mobile bottom sheet ----
const sheetOpen = ref(false)
const sheetEl = ref(null)
const sheetPanel = ref(null)
const photoArea = ref(null)
let sheetReturnFocus = null
function lockScroll(on) { if (typeof document !== 'undefined') document.body.style.overflow = on ? 'hidden' : '' }
function openSheet() {
  if (!isMobile.value || !active.value) return
  sheetReturnFocus = document.activeElement
  sheetOpen.value = true
  lockScroll(true)
  nextTick(() => sheetEl.value?.focus())
}
function closeSheet() {
  if (!sheetOpen.value) return
  sheetOpen.value = false
  lockScroll(false)
  sheetReturnFocus?.focus?.()
}
function onSheetKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSheet() }
  else if (e.target === sheetEl.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); sheetPanel.value?.step(e.key === 'ArrowLeft' ? -1 : 1)
  }
}
function scrollToPhoto() { photoArea.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
onDeactivated(() => closeSheet())

const showAbout = ref(false)
</script>

<template>
  <div class="ai-tab">
    <!-- full-page drag overlay -->
    <div v-show="dragActive" class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay-inner">Drop photo(s) anywhere to add them</div>
    </div>

    <!-- live progress notification (waking / loading / queue / analyzing) -->
    <InferenceProgress :show="!!progress" :kind="progress?.kind || 'analyzing'"
      :title="progress?.title || ''" :detail="progress?.detail || ''" :progress="progress?.progress ?? null"
      :retryable="!!progress?.retryable" @retry="retryWarm" />

    <!-- Upload -->
    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center">
          <h6 class="card-title mb-0">Upload butterfly photo(s)</h6>
          <button v-if="items.length || results.length" class="btn btn-link btn-sm p-0" @click="clearAll">Clear photos</button>
        </div>
        <div class="dropzone mt-2" :class="{ over: isOver, compact: results.length }"
          @click="fileInput.click()" @dragover.prevent="isOver = true" @dragleave.prevent="isOver = false"
          @drop.prevent="isOver = false" role="button" tabindex="0"
          @keydown.enter.prevent="fileInput.click()" @keydown.space.prevent="fileInput.click()"
          aria-label="Upload images: drag and drop, or activate to choose files">
          <div v-if="!results.length" class="text-muted mb-2">Drag &amp; drop <em>anywhere</em>, paste from clipboard, or choose photos. Best results come from a clear shot of the open wings.</div>
          <div v-else class="text-muted small">Add more photos: drag, paste, or</div>
          <div class="d-flex gap-2 justify-content-center flex-wrap" @click.stop>
            <button class="btn btn-primary btn-sm" @click="fileInput.click()">Choose photos</button>
            <button class="btn btn-outline-secondary btn-sm" @click="cameraInput.click()">Take photo</button>
          </div>
          <!-- accept="image/*" with NO capture lets Android offer Files/Drive/Photos, not just the camera/Photos. -->
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick" />
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="onPick" />
        </div>

        <div v-if="preparing" class="small text-muted mt-2">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Preparing images…
        </div>

        <div class="d-flex flex-wrap align-items-end gap-3 mt-2">
          <div v-if="items.length" class="preview-grid flex-grow-1" :class="{ small: results.length }">
            <div v-for="it in items" :key="it.id" class="preview" :class="{ invalid: it.status === 'invalid' }">
              <img v-if="it.previewUrl" :src="it.previewUrl" :alt="it.name" />
              <button class="rm" @click="removeItem(it.id)" :aria-label="`Remove ${it.name}`">&times;</button>
              <div v-if="it.status === 'invalid'" class="small text-danger px-1">{{ it.error }}</div>
            </div>
          </div>
          <button class="btn btn-success ms-auto identify-btn" :disabled="!pendingItems.length || running" @click="run">
            <span v-if="running" class="spinner-border spinner-border-sm" aria-hidden="true"></span>
            {{ running ? 'Identifying…' : (pendingItems.length ? `Identify ${pendingItems.length > 1 ? pendingItems.length + ' photos' : 'butterfly'}` : (results.length ? 'All photos identified' : 'Identify butterfly')) }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="errorMsg" class="alert alert-danger mt-3 py-2 small">{{ errorMsg }}</div>

    <!-- Results -->
    <section v-if="active" class="results mt-3" aria-label="Results">
      <!-- one tab per uploaded photo -->
      <div v-if="results.length > 1" ref="photoTabs" class="photo-tabs" role="tablist" aria-label="Your photos" @keydown="onPhotoTabKey">
        <button v-for="r in results" :key="r.id" type="button" role="tab" class="photo-tab" :data-id="r.id"
          :class="{ active: r.id === active.id }" :aria-selected="r.id === active.id" aria-controls="ai-result-panel"
          :tabindex="r.id === active.id ? 0 : -1" @click="activeId = r.id">
          <img :src="r.previewUrl" :alt="r.filename" />
          <span class="pt-text">
            <span class="pt-name">{{ r.filename }}</span>
            <span class="pt-top"><span v-if="r.loading" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span><em>{{ topLabel(r) }}</em></span>
          </span>
        </button>
      </div>

      <div id="ai-result-panel" class="card" :role="results.length > 1 ? 'tabpanel' : undefined">
        <div class="card-body">
          <div v-if="active.mock" class="badge text-bg-secondary mb-2">demo: backend not connected</div>

          <div v-if="active.loading" class="d-flex align-items-center gap-2 text-muted small">
            <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Identifying {{ active.filename }}…
          </div>
          <div v-else-if="active.error" class="alert alert-warning py-2 small mb-0">{{ active.filename }}: {{ active.error }}</div>

          <template v-else>
            <!-- phones: sticky mini-bar with the user's photo + selected taxon -->
            <div v-if="isMobile" class="mini-bar">
              <button type="button" class="mini-thumb" @click="scrollToPhoto" aria-label="Scroll to your photo">
                <img :src="active.previewUrl" alt="Your photo" />
              </button>
              <div class="mini-text">
                <div class="mini-lbl">Selected</div>
                <div class="mini-name"><em>{{ active.selected }}</em> <span v-if="selectedInfo">{{ fmtPct(selectedInfo.prob) }}</span></div>
              </div>
              <button type="button" class="btn btn-sm btn-primary" @click="openSheet">Compare</button>
            </div>

            <div class="res-grid">
              <div class="area-cands">
                <div class="cands-side">
                  <AILocationChips :suggest="active.suggest" :country="active.country" :region="active.region"
                    :country-options="countryOptions" :region-options="REGION_OPTS"
                    @any="resetLocation(active)" @suggest="(s) => applySuggestion(active, s)"
                    @set-country="(v) => setCountry(active, v)" @set-region="(v) => setRegion(active, v)" />
                </div>
                <div class="cands-main">
                  <div class="col-title" id="preds-lbl">Predictions</div>
                  <div v-if="lowConfidence" class="low-conf" role="status">{{ lowConfidence }}</div>
                  <TaxonTree :pred="active.pred" :selected="active.selected" :reset-key="treeKey(active)"
                    browse="vocabulary" thumbs former-names :genus-limit="4" label="Predictions"
                    @select="(t) => selectTaxon(active, t)" @activate="openSheet" />
                </div>
              </div>

              <div ref="photoArea" class="area-photo">
                <div class="photo-sticky">
                  <div class="col-title">Your photo</div>
                  <AIPhotoView :key="active.id" :src="active.previewUrl" :boxes="active.boxes" :used-index="active.usedIndex"
                    :loading="active.maskLoading" :alt="`Your photo: ${active.filename}`" @select="(i) => selectMask(active, i)" />
                  <!-- mask controls -->
                  <div class="mask-bar small text-muted">
                    <template v-if="active.boxes.length">
                      {{ active.boxes.length }} wing mask{{ active.boxes.length > 1 ? 's' : '' }} found.
                      <span v-if="active.usedIndex === -2">Using all wings together.</span>
                      <span v-else-if="active.usedIndex >= 0">Using mask {{ active.usedIndex + 1 }}.</span>
                      <span v-else>Using full image.</span>
                      <template v-if="active.boxes.length > 1"> Double-click a box to use just that one.</template>
                      <button v-if="active.usedIndex !== -2" class="btn btn-link btn-sm p-0 ms-1" @click="useAll(active)">Use all wings</button>
                      <button v-if="active.usedIndex !== -1" class="btn btn-link btn-sm p-0 ms-1" @click="useFull(active)">Use full image</button>
                    </template>
                    <template v-else>No wings detected, using the full image.</template>
                  </div>
                </div>
              </div>

              <div v-if="!isMobile" class="area-ref">
                <AIReferencePanel :taxon="active.selected" :prob="selectedInfo?.prob ?? null" :members="selectedMembers" former-names
                  :country="active.country !== ANY ? active.country : ''" />
              </div>
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- phones: bottom sheet pins the user's photo above the reference photos -->
    <Teleport to="body">
      <div v-if="sheetOpen && isMobile && active" class="sheet-backdrop" @click.self="closeSheet">
        <div ref="sheetEl" class="sheet" role="dialog" aria-modal="true" aria-label="Compare with reference photos"
          tabindex="-1" @keydown="onSheetKey">
          <div class="sheet-head">
            <span class="sheet-title">Compare</span>
            <button type="button" class="btn-close" aria-label="Close" @click="closeSheet"></button>
          </div>
          <div class="sheet-user">
            <img :src="active.previewUrl" :alt="`Your photo: ${active.filename}`" />
            <span class="sheet-user-lbl">Your photo</span>
          </div>
          <div class="sheet-scroll">
            <AIReferencePanel ref="sheetPanel" compact former-names :taxon="active.selected" :prob="selectedInfo?.prob ?? null"
              :members="selectedMembers" :country="active.country !== ANY ? active.country : ''" />
          </div>
        </div>
      </div>
    </Teleport>

    <!-- About (simplified) -->
    <div class="card mt-3">
      <div class="card-body">
        <button class="btn btn-link p-0 fw-bold" @click="showAbout = !showAbout" :aria-expanded="showAbout">
          About this tool {{ showAbout ? '▾' : '▸' }}
        </button>
        <div v-show="showAbout" class="small mt-2">
          <p>A model that identifies butterflies and nocturnal moths from wing photos, used as a curation tool to flag
          uncertain or mislabelled identifications in the image database. It pairs a frozen <strong>BioCLIP 2.5-H</strong>
          image backbone with a hierarchical classification head that predicts the finest taxon
          and rolls those predictions up the taxonomy, keeping them consistent across subspecies, species, genus, and
          higher ranks. To focus it on wing pattern, images are first cropped to the wings by a lightweight
          YOLO26s-seg-based butterfly segmentation model trained on wing masks generated with SAM 3.</p>
          <p><strong>Coverage:</strong> the label space spans Neotropical butterflies across all major families
          (Nymphalidae, Hesperiidae, Riodinidae, Lycaenidae, Pieridae, Papilionidae) and now a substantial component of
          <strong>nocturnal moths</strong> — predominantly <em>Sphingidae</em> (hawkmoths), with Saturniidae, Geometridae,
          Notodontidae, Erebidae and others.
          Rare species represented by even single observations are included in training. Sampling remains
          uneven: most of the butterfly data sits in the <em>Ithomiini</em> mimicry radiation and most of the moth data
          in <em>Sphingidae</em>, so confident calls on sparsely-sampled groups (skippers, hairstreaks, micromoths)
          warrant extra caution. Even within Ithomiini, Müllerian mimicry makes subspecies look-alikes genuinely hard to
          tell apart.</p>
          <p>The collection classifier uses an attention model to combine dorsal and ventral photos for 3,829
          specimens with verified pairs, learning how much to rely on each view. Other specimens keep their previous
          predictions. AI Identifier uses a separate single-photo classifier.</p>
          <section aria-labelledby="attention-benchmark-title">
            <p id="attention-benchmark-title" class="mb-1"><strong>Collection accuracy</strong> on 314 held-out
            Sanger dorsal/ventral pairs, with the side-of-Andes + Ecuador prior:</p>
            <table id="attention-benchmark" class="table table-sm table-bordered w-auto small">
              <thead><tr><th>Rank</th><th>Specimens</th><th>Top-1</th><th>Top-5</th></tr></thead>
              <tbody>
                <tr><td>Named subspecies</td><td>296</td><td>89.86%</td><td>98.65%</td></tr>
                <tr><td>Species</td><td>314</td><td>95.22%</td><td>99.04%</td></tr>
                <tr><td>Genus</td><td>314</td><td>98.09%</td><td>99.36%</td></tr>
              </tbody>
            </table>
          </section>
          <section aria-labelledby="field-benchmark-title">
            <p id="field-benchmark-title" class="mb-1"><strong>AI Identifier accuracy</strong> on 4,566 held-out
            field photos from GBIF (iNaturalist Research Grade, 629 species from Ecuador, Colombia and Peru),
            recorded between 12 February and 7 September 2026, after BioCLIP 2.5-H was released. No location selected;
            identifications scored under current names:</p>
            <table id="field-benchmark" class="table table-sm table-bordered w-auto small">
              <thead><tr><th>Rank</th><th>Photographs</th><th>Top-1</th><th>Top-5</th></tr></thead>
              <tbody>
                <tr><td>Species</td><td>4,566</td><td>85.74%</td><td>96.23%</td></tr>
                <tr><td>Genus</td><td>4,566</td><td>95.38%</td><td>98.45%</td></tr>
              </tbody>
            </table>
          </section>
          <p class="text-muted">Top-1: the recorded identification ranks first. Top-5: it is among the first five.
          The two tables measure different tasks and should not be compared with each other. Both test sets were also
          used while choosing between model versions, so these scores may be slightly optimistic. They do not cover
          species outside the label space.</p>
          <!-- Sex benchmark and support details are generated from the verified OOF export. -->
          <section aria-labelledby="sex-benchmark-title">
          <p id="sex-benchmark-title" class="mb-1"><strong>Sex prediction</strong></p>
          <p>Collection predictions use separate BioCLIP features from the two ventral forewings and two dorsal hindwings,
          for 1,586 Sanger specimens. The benchmark below covers 1,220 specimens across 57 species.</p>
          <table id="sex-benchmark" class="table table-sm table-bordered w-auto small">
            <thead><tr><th scope="col">Evaluation</th><th scope="col">Specimens</th><th scope="col">Accuracy</th></tr></thead>
            <tbody>
              <tr><td>All scored specimens</td><td>1,220</td><td>89.7%</td></tr>
            </tbody>
          </table>
          <p>Scores average three models that each excluded the specimen from training and checkpoint selection.
          <strong>Supported</strong> requires confidence ≥80% and sufficient taxon evidence for both sexes; otherwise <strong>Uncertain</strong>.
          This exploratory screen supports 274 predictions in <em>Ithomia salapia</em>, <em>Mechanitis mazaeus</em>, <em>Mechanitis messenoides</em>, <em>Mechanitis polymnia</em>, <em>Oleria amalda</em>, <em>Oleria baizana</em>, <em>Oleria tigilla</em>.
          5 disagree with the recorded sex and are candidates for review.</p>
          <p>Sex prediction is not yet supported for uploaded photos. The current method uses separate features from
          ventral forewing and dorsal hindwing crops of Sanger specimens. These views expose regions that may show
          sexual differences, including androconia in some taxa.</p>

          </section>
          <p class="mb-1">
            <strong>Models &amp; code:</strong>
            single-photo head:
            <a href="https://huggingface.co/fr4nzzch/butterfly-id-classifier" target="_blank" rel="noopener noreferrer">fr4nzzch/butterfly-id-classifier</a>
            · wing cropper:
            <a href="https://huggingface.co/spaces/fr4nzzch/butterfly-id/blob/main/assets/wing_seg_v6.pt" target="_blank" rel="noopener noreferrer">wing_seg_v6.pt</a>
            · collection attention model:
            <a href="https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/releases/tag/collection-attention-20260926" target="_blank" rel="noopener noreferrer">collection-attention-20260926</a>
            · <a href="https://huggingface.co/spaces/fr4nzzch/butterfly-id" target="_blank" rel="noopener noreferrer">inference Space</a>
            · backbone <a href="https://huggingface.co/imageomics/bioclip-2.5-vith14" target="_blank" rel="noopener noreferrer">BioCLIP 2.5-H</a>
            · <a href="https://huggingface.co/facebook/sam3" target="_blank" rel="noopener noreferrer">SAM 3</a> (wing-mask training labels).
          </p>
          <p class="mb-1">
            <strong>Training data:</strong> the subspecies-level taxonomic identifications used to train the
            classifier were compiled from
            <a href="https://www.butterfliesofamerica.com" target="_blank" rel="noopener noreferrer">Butterflies of America</a>,
            <a href="https://www.sangay.eu" target="_blank" rel="noopener noreferrer">Sangay</a>,
            <a href="https://www.noreste.eu" target="_blank" rel="noopener noreferrer">Noreste</a>, and
            <a href="https://www.cotacachi.eu" target="_blank" rel="noopener noreferrer">Cotacachi</a>, expanded with
            additional Neotropical butterfly photo databases from across the region and, for the nocturnal moths,
            specialist collections such as the <a href="https://sphingidae.myspecies.info" target="_blank" rel="noopener noreferrer">Sphingidae
            Taxonomic Inventory</a> and other hawkmoth/saturniid resources. The AI Identifier classifier is also trained on
            research-grade iNaturalist and museum photos from GBIF, used for training only.
          </p>
          <p class="mb-1"><strong>Changelog</strong></p>
          <p><strong>27 September 2026:</strong> Updated AI Identifier names to the current taxonomy, following Butterflies of
          America: 246 duplicate, misspelled or outdated species names were merged into their valid names (for example
          Agraulis vanillae is now Dione vanillae), and non-adult and mislabelled training photos were removed. Former names
          are shown next to renamed species. Accuracy is unchanged when test photos are scored under the same names.</p>
          <p><strong>27 September 2026:</strong> Retrained the AI Identifier classifier with about 457,000 additional GBIF
          photos (research-grade iNaturalist observations and museum specimens recorded before 12 February 2026, up to
          1,000 per species). On the GBIF field photos, Species Top-1 rose from 73.92% to 85.15% (+11.23 pp) and Top-5
          from 92.05% to 96.12% (+4.07 pp).</p>
          <p><strong>26 September 2026:</strong> Retrained the AI Identifier classifier after correcting 558 training
          labels using their source captions. On the GBIF field photos, Species Top-1 rose from 73.37% to 73.92% (+0.55 pp);
          Top-5 is unchanged at 92.05%.</p>
          <p><strong>26 September 2026:</strong> AI Identifier now uses the corrected v6 wing crop, fixes 92 taxon
          names, and no longer guesses a location when none is selected. On the GBIF field photos, Species Top-1 rose
          from 67.50% to 73.37% (+5.87 pp) and Top-5 from 85.59% to 92.05% (+6.46 pp), with the previous classification head.</p>
          <p><strong>26 September 2026:</strong> Collection predictions for verified dorsal/ventral pairs now use an
          attention model. On 314 held-out pairs, Species Top-1 rose from 92.04% to 95.22% (+3.18 pp) over averaging
          single-photo predictions across the two views.</p>
          <p><strong>10 September 2026:</strong> Added joint dorsal/ventral features for taxonomic prediction
          in specimens with verified paired photos, retaining the previous method for other specimens.
          Species Top-1 accuracy reaches 91.33% (+0.85 pp, Top-5: 97.91%) and Subspecies Top-1 reaches 87.93%
          (+0.87 pp, Top-5: 97.33%), on a five-fold Sanger evaluation of 3,355 specimens with the geographic prior (Genus Top-1: 95.55%,
          Family Top-1: 99.32%). For uploaded photos, the model does not yet support combining dorsal and ventral photos of the same individual.</p>
          <p><strong>9 September 2026:</strong> Added out-of-fold sex predictions from separate ventral forewing and dorsal
          hindwing features, confidence scores, Supported/Uncertain labels, sex agreement filters, and confidence sorting
          that places supported predictions first.</p>
          <p><strong>6 September 2026:</strong> Retrained the taxonomic classification head with the expanded Butterflies of America
          dataset, retaining rare species down to single observations (covering 4,478 species and 4,958 subspecies).
          BioCLIP features are extracted from tight crops focused strictly on the wings, improving Species Top-1 accuracy
          to 91.6% (+1.4 pp, Top-5: 98.0%) and Subspecies Top-1 to 85.7% (+1.0 pp, Top-5: 96.5%). Also corrected EXIF 180° orientation
          for gallery bounding boxes so zoom-to-wings centers over visible butterfly wings.</p>
          <p><strong>3 September 2026:</strong> Updated wing segmentation to reduce crops of envelopes and color charts,
          improving Species Top-1 by +1.0 pp and Genus Top-1 by +0.8 pp. Corrected taxonomic synonyms, spelling variants,
          and eliminated 315 invalid placeholder classes (such as <em>NOT_FOUND</em>), lifting overall Subspecies Top-1 by
          +0.7 pp (84.0% → 84.7%) and Species Top-1 by +0.5 pp (89.7% → 90.2%).</p>
          <p class="text-muted mb-0"><strong>This is an AI suggestion, not a definitive identification.</strong></p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dropzone { border: 2px dashed #cbd5e1; border-radius: 8px; padding: 1.25rem 1rem; text-align: center; cursor: pointer; transition: border-color .15s, background .15s; }
.dropzone:hover, .dropzone.over { border-color: #0d6efd; background: #f1f6ff; }
.dropzone:focus-visible { outline: 2px solid #0d6efd; outline-offset: 2px; }
.preview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 110px)); gap: 0.5rem; }
.preview { position: relative; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; background: #f8fafc; }
.preview.invalid { border-color: #dc3545; }
.preview img { width: 100%; height: 84px; object-fit: cover; display: block; }
.preview .rm { position: absolute; top: 2px; right: 2px; width: 26px; height: 26px; border: none; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; line-height: 1; cursor: pointer; }
.dropzone.compact { display: flex; align-items: center; justify-content: center; gap: .6rem; flex-wrap: wrap; padding: .5rem 1rem; }
.preview-grid.small { grid-template-columns: repeat(auto-fill, 64px); }
.preview-grid.small .preview img { height: 48px; }
.preview-grid.small .preview .rm { width: 20px; height: 20px; font-size: .8rem; }
.identify-btn { min-width: 12rem; }
.mask-bar { margin-bottom: .35rem; }
.low-conf { font-size: .78rem; color: #854d0e; background: #fefce8; border: 1px solid #fde68a; border-radius: 6px; padding: .35rem .55rem; margin-bottom: .45rem; }
.col-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin-bottom: .35rem; }

/* photo tabs */
.photo-tabs { display: flex; gap: .4rem; overflow-x: auto; padding-bottom: .4rem; }
.photo-tab { display: flex; align-items: center; gap: .5rem; flex: 0 0 auto; max-width: 260px; padding: .3rem .6rem .3rem .3rem; border: 1px solid #dee2e6; border-radius: 8px; background: #fff; color: inherit; text-align: left; cursor: pointer; }
.photo-tab:hover { border-color: #94a3b8; }
.photo-tab.active { border-color: #16a34a; box-shadow: 0 0 0 1px #16a34a; background: #f0fdf4; }
.photo-tab:focus-visible { outline: 2px solid #0d6efd; outline-offset: 2px; }
.photo-tab img { width: 44px; height: 44px; object-fit: cover; border-radius: 5px; flex: 0 0 auto; }
.pt-text { display: flex; flex-direction: column; min-width: 0; font-size: .75rem; }
.pt-name { color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-top { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* results grid: phones stack candidates then photo (reference opens in a sheet) */
.res-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); grid-template-areas: "cands" "photo"; }
.area-cands { grid-area: cands; min-width: 0; }
.cands-main { margin-top: 1rem; min-width: 0; }
.area-photo { grid-area: photo; min-width: 0; scroll-margin-top: 130px; }
.area-ref { grid-area: ref; min-width: 0; }
/* medium: photo and reference side by side, predictions below */
@media (min-width: 768px) {
  .res-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "photo ref" "cands cands"; }
  .area-cands { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 1.25rem; align-items: start; }
  .cands-main { margin-top: 0; }
}
/* desktop: predictions | photo (sticky) | reference */
@media (min-width: 1200px) {
  .res-grid { grid-template-columns: minmax(280px, .9fr) minmax(0, 1fr) minmax(0, 1.15fr); grid-template-areas: "cands photo ref"; }
  .area-cands { display: block; }
  .cands-main { margin-top: 1rem; }
  .photo-sticky { position: sticky; top: 70px; }
  .photo-sticky :deep(.ai-photo) { height: 440px; }
}

/* phones: sticky mini-bar */
.mini-bar { position: sticky; top: 56px; z-index: 20; display: flex; align-items: center; gap: .6rem; margin: -.25rem -.25rem .75rem; padding: .4rem .5rem; background: rgba(255,255,255,.96); border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 2px 8px rgba(15,23,42,.08); }
.mini-thumb { padding: 0; border: none; background: none; flex: 0 0 auto; }
.mini-thumb img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; display: block; }
.mini-thumb:focus-visible { outline: 2px solid #0d6efd; outline-offset: 2px; }
.mini-text { min-width: 0; flex: 1 1 auto; }
.mini-lbl { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
.mini-name { font-size: .88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* phones: bottom sheet (teleported to body) */
.sheet-backdrop { position: fixed; inset: 0; z-index: 1060; background: rgba(15,23,42,.45); display: flex; align-items: flex-end; }
.sheet { width: 100%; max-height: 92vh; display: flex; flex-direction: column; background: #fff; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,.25); outline: none; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding: .6rem .9rem .3rem; }
.sheet-title { font-weight: 600; }
.sheet-user { position: relative; flex: 0 0 auto; margin: 0 .75rem; background: #0f172a; border-radius: 8px; overflow: hidden; }
.sheet-user img { display: block; width: 100%; height: 20vh; object-fit: contain; }
.sheet-user-lbl { position: absolute; left: 6px; top: 6px; font-size: .68rem; color: #fff; background: rgba(0,0,0,.55); border-radius: 4px; padding: 0 5px; }
.sheet-scroll { overflow-y: auto; padding: .6rem .75rem 1rem; }

.drop-overlay { position: fixed; inset: 0; z-index: 1080; background: rgba(13,110,253,.12); backdrop-filter: blur(1px); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.drop-overlay-inner { border: 3px dashed #0d6efd; border-radius: 16px; padding: 2rem 3rem; background: #fff; color: #0d6efd; font-weight: 600; font-size: 1.1rem; box-shadow: 0 8px 30px rgba(0,0,0,.15); }
</style>
