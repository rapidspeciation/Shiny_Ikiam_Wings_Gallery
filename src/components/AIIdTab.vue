<script setup>
// AI Identifier tab: upload butterfly photo(s) -> BioCLIP 2.5-H prediction (genus ▸
// species ▸ subspecies). Inference runs ONCE per photo (raw leaf probabilities);
// the country + side-of-Andes prior is a pure client-side re-rank, so each result
// can change its location after the fact — or let us guess it — with no re-inference.
// Photos stream in one-by-one as the model finishes each (concurrency pool). The
// YOLO wing-crop returns selectable masks: the largest runs on Identify, others run
// lazily when their bbox is clicked. Reference photos (Sanger first, GBIF fallback)
// are shown for visual comparison.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import FilterSelect from './FilterSelect.vue'
import PredictionPanel from './PredictionPanel.vue'
import AIReferenceGallery from './AIReferenceGallery.vue'
import AIPhotoView from './AIPhotoView.vue'
import { predictStream, predictOne, rankLeaves } from '../utils/aiPredict.js'
import { loadCountries, guessRegion } from '../utils/geoPrior.js'
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
        error: /\.hei[cf]$/i.test(file.name) ? 'HEIC isn\'t supported in browsers — set your camera to "Most Compatible" (JPEG).' : 'Not an image file.' })
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
}
function clearAll() {
  items.value.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl))
  items.value = []; results.value = []; errorMsg.value = ''
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
  window.addEventListener('dragenter', onWinDragEnter)
  window.addEventListener('dragover', onWinDragOver)
  window.addEventListener('dragleave', onWinDragLeave)
  window.addEventListener('drop', onWinDrop)
  window.addEventListener('paste', onPaste)
  checklist.value = await getChecklist()
  countryOptions.value = [ANY, ...(await loadCountries())]
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onWinDragEnter)
  window.removeEventListener('dragover', onWinDragOver)
  window.removeEventListener('dragleave', onWinDragLeave)
  window.removeEventListener('drop', onWinDrop)
  window.removeEventListener('paste', onPaste)
  items.value.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl))
})

// ---- geographic prior (defaults applied to every new run) ----
const REGION_OPTS = ['West of Andes (Pacific / Chocó)', 'East of Andes (Amazon)']
const ANY = 'Any'
const country = ref(ANY)
const region = ref(null)
const countryOptions = ref([ANY])
const checklist = ref({})
const sideOf = (r) => (r?.startsWith('West') ? 'West' : r?.startsWith('East') ? 'East' : '')
const regionForSide = (s) => (s === 'West' ? REGION_OPTS[0] : s === 'East' ? REGION_OPTS[1] : null)
const cParam = (c) => (c && c !== ANY ? c : '')
const hasLocation = computed(() => country.value !== ANY || !!region.value)
function resetLocation() { country.value = ANY; region.value = null }

// ---- run ----
const results = ref([])   // see placeholder shape in run()
const running = ref(false)
const errorMsg = ref('')

function rerank(r) {
  r.pred = rankLeaves(r.leaves, checklist.value, { country: cParam(r.country), side: sideOf(r.region) })
}
function applyGuess(r) {
  const g = guessRegion(checklist.value, r.leaves)
  r.country = g.country || ANY
  r.region = g.country === 'Ecuador' ? regionForSide(g.side) : null
  r.guess = g
  rerank(r)
}
// re-rank after the leaves change (mask switch): keep the guess flow if it's active.
function applyLeaves(r, leaves, forceGuess = false) {
  r.leaves = leaves
  if (forceGuess || r.guess) applyGuess(r); else rerank(r)
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
  const noLoc = !hasLocation.value
  for (const it of pending) {
    const placeholder = {
      id: it.id, filename: it.name, previewUrl: it.previewUrl, file: it,
      loading: true, error: null, mock: false, leaves: null,
      boxes: [], unionBox: null, usedIndex: -1, predCache: {}, maskLoading: false,
      country: country.value, region: country.value === 'Ecuador' ? region.value : null,
      guess: null, pred: null,
    }
    const existing = byId(it.id)
    if (existing) Object.assign(existing, placeholder)
    else results.value.push(placeholder)
  }
  try {
    await predictStream(pending, {
      onResult: (raw) => {
        const r = byId(raw.id); if (!r) return
        r.boxes = raw.boxes || []
        r.unionBox = raw.wing_box || null          // union of all masks (the default crop)
        r.usedIndex = r.boxes.length ? -2 : -1     // -2 = all wings (union), -1 = full image, >=0 = one mask
        r.predCache = { [r.boxes.length ? 'all' : 'full']: raw.leaves }
        r.mock = raw.mock; r.loading = false
        applyLeaves(r, raw.leaves, noLoc)
      },
      onError: (e, i, file) => {
        const r = byId(file.id); if (r) { r.loading = false; r.error = e.message || 'Prediction failed.' }
      },
    })
  } catch (e) {
    errorMsg.value = e.message || 'Prediction failed.'
  } finally {
    running.value = false
  }
}

// ---- wing-mask selection (lazy: run BioCLIP on a mask only when it's chosen) ----
async function selectMask(r, i) {
  if (i === r.usedIndex || !r.boxes[i] || r.maskLoading) return
  if (r.predCache[i]) { r.usedIndex = i; applyLeaves(r, r.predCache[i]); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { box: r.boxes[i].box })
    r.predCache[i] = raw.leaves
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
  if (r.predCache.full) { r.usedIndex = -1; applyLeaves(r, r.predCache.full); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { yolo: 'off' })
    r.predCache.full = raw.leaves
    r.usedIndex = -1
    applyLeaves(r, raw.leaves)
  } catch (e) {
    errorMsg.value = e.message || 'Full-image prediction failed.'
  } finally {
    r.maskLoading = false
  }
}
// All wings together (union of every detected mask) — the default crop.
async function useAll(r) {
  if (r.usedIndex === -2 || r.maskLoading || !r.unionBox) return
  if (r.predCache.all) { r.usedIndex = -2; applyLeaves(r, r.predCache.all); return }
  r.maskLoading = true
  try {
    const raw = await predictOne(r.file, 0, { box: r.unionBox })
    r.predCache.all = raw.leaves
    r.usedIndex = -2
    applyLeaves(r, raw.leaves)
  } catch (e) {
    errorMsg.value = e.message || 'Prediction failed.'
  } finally {
    r.maskLoading = false
  }
}

// per-card location change
function setCountry(r, v) { r.country = v; if (v !== 'Ecuador') r.region = null; r.guess = null; rerank(r) }
function setRegion(r, v) { r.region = v; r.guess = null; rerank(r) }
function guess(r) { applyGuess(r) }
function applyGuessCountry(r, name) {
  r.country = name
  r.region = name === 'Ecuador' ? regionForSide(r.guess?.side) : null
  rerank(r)
}

// Candidate groups for the reference gallery: top predicted species, each fetched
// at subspecies level when confident, else species level.
function groupsFor(r) {
  const out = []
  for (const sp of (r.pred?.species || []).slice(0, 3)) {
    const [name, prob, , subs] = sp
    const topSub = subs && subs[0]
    const taxon = topSub && topSub[1] >= 0.05 ? topSub[0] : name
    out.push({ id: name, label: name, sublabel: `${Math.round(prob * 100)}%`, taxon })
  }
  return out
}

const showAbout = ref(false)
</script>

<template>
  <div class="ai-tab">
    <!-- full-page drag overlay -->
    <div v-show="dragActive" class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay-inner">Drop photo(s) anywhere to add them</div>
    </div>

    <!-- Upload + prior controls -->
    <div class="row g-3">
      <div class="col-12 col-lg-7">
        <div class="card h-100">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center">
              <h6 class="card-title mb-0">Upload butterfly photo(s)</h6>
              <button v-if="items.length || results.length" class="btn btn-link btn-sm p-0" @click="clearAll">Clear photos</button>
            </div>
            <div class="dropzone mt-2" :class="{ over: isOver }"
              @click="fileInput.click()" @dragover.prevent="isOver = true" @dragleave.prevent="isOver = false"
              @drop.prevent="isOver = false" role="button" tabindex="0"
              @keydown.enter.prevent="fileInput.click()" @keydown.space.prevent="fileInput.click()"
              aria-label="Upload images: drag and drop, or activate to choose files">
              <div class="text-muted mb-2">Drag &amp; drop <em>anywhere</em>, paste from clipboard, or choose photos — best on a clear shot of the open wings.</div>
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

            <div v-if="items.length" class="preview-grid mt-2">
              <div v-for="it in items" :key="it.id" class="preview" :class="{ invalid: it.status === 'invalid' }">
                <img v-if="it.previewUrl" :src="it.previewUrl" :alt="it.name" />
                <button class="rm" @click="removeItem(it.id)" :aria-label="`Remove ${it.name}`">&times;</button>
                <div v-if="it.status === 'invalid'" class="small text-danger px-1">{{ it.error }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-12 col-lg-5">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Where was it photographed? <span class="text-muted fw-normal small">(optional)</span></h6>
            <p class="text-muted small mb-2">Helps when look-alikes occur — down-weights butterflies not recorded in your region. Leave it blank and we'll <strong>guess the location from the photo</strong>. You can change this per photo after identifying.</p>
            <FilterSelect label="Country" :options="countryOptions" v-model="country" placeholder="Any country" />
            <div v-if="country === 'Ecuador'" class="mt-2">
              <FilterSelect label="Region (side of the Andes)" :options="REGION_OPTS" v-model="region" placeholder="Either side" />
            </div>
            <div class="d-flex align-items-center gap-2 mt-1" style="min-height: 1.5rem">
              <button v-if="hasLocation" class="btn btn-link btn-sm p-0" @click="resetLocation">Reset location</button>
            </div>
            <div class="d-grid mt-2">
              <button class="btn btn-success" :disabled="!pendingItems.length || running" @click="run">
                <span v-if="running" class="spinner-border spinner-border-sm" aria-hidden="true"></span>
                {{ running ? 'Identifying…' : (pendingItems.length ? `Identify ${pendingItems.length > 1 ? pendingItems.length + ' photos' : 'butterfly'}` : 'All photos identified') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="errorMsg" class="alert alert-danger mt-3 py-2 small">{{ errorMsg }}</div>

    <!-- Results -->
    <div v-for="r in results" :key="r.id" class="card mt-3">
      <div class="card-body">
        <div v-if="r.mock" class="badge text-bg-secondary mb-2">demo — backend not connected</div>

        <!-- still running this photo -->
        <div v-if="r.loading" class="d-flex align-items-center gap-2 text-muted small">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Identifying {{ r.filename }}…
        </div>
        <div v-else-if="r.error" class="alert alert-warning py-2 small mb-0">{{ r.filename }}: {{ r.error }}</div>

        <template v-else>
          <!-- per-photo location override -->
          <div class="loc-bar mb-3">
            <div class="loc-field">
              <FilterSelect label="Country" :options="countryOptions" :model-value="r.country"
                placeholder="Any country" @update:model-value="(v) => setCountry(r, v)" />
            </div>
            <div v-if="r.country === 'Ecuador'" class="loc-field">
              <FilterSelect label="Region (side of the Andes)" :options="REGION_OPTS" :model-value="r.region"
                placeholder="Either side" @update:model-value="(v) => setRegion(r, v)" />
            </div>
            <div class="loc-guess">
              <button v-if="!r.guess" class="btn btn-outline-secondary btn-sm" @click="guess(r)" title="Infer the most likely location from the photo">
                I don't know — guess
              </button>
              <div v-if="r.guess" class="small">
                <template v-if="r.guess.countries && r.guess.countries.length">
                  <span class="text-muted">Guessed from the photo — top predictions are recorded from <span v-if="r.guess.side">(<strong>{{ r.guess.side }}</strong> of the Andes, {{ Math.round(r.guess.sideConf * 100) }}%)</span> — tap to apply:</span>
                  <div class="guess-chips mt-1">
                    <button v-for="[name, conf] in r.guess.countries" :key="name"
                      class="btn btn-sm guess-chip" :class="r.country === name ? 'btn-success' : 'btn-outline-success'"
                      @click="applyGuessCountry(r, name)">
                      {{ name }} <span class="chip-pct">{{ Math.round(conf * 100) }}%</span>
                    </button>
                  </div>
                </template>
                <span v-else class="text-muted">Not enough signal to guess a location.</span>
              </div>
            </div>
          </div>

          <div class="row g-3">
            <div class="col-12 col-lg-6">
              <AIPhotoView :src="r.previewUrl" :boxes="r.boxes" :used-index="r.usedIndex"
                :loading="r.maskLoading" :alt="r.filename" @select="(i) => selectMask(r, i)" />
              <!-- mask controls -->
              <div class="mask-bar small text-muted">
                <template v-if="r.boxes.length">
                  {{ r.boxes.length }} wing mask{{ r.boxes.length > 1 ? 's' : '' }} found.
                  <span v-if="r.usedIndex === -2">Using all wings together.</span>
                  <span v-else-if="r.usedIndex >= 0">Using mask {{ r.usedIndex + 1 }}.</span>
                  <span v-else>Using full image.</span>
                  <template v-if="r.boxes.length > 1"> Double-click a box to use just that one.</template>
                  <button v-if="r.usedIndex !== -2" class="btn btn-link btn-sm p-0 ms-1" @click="useAll(r)">Use all wings</button>
                  <button v-if="r.usedIndex !== -1" class="btn btn-link btn-sm p-0 ms-1" @click="useFull(r)">Use full image</button>
                </template>
                <template v-else>No wings detected — using the full image.</template>
              </div>
              <PredictionPanel :item="{ CAM_ID: r.id }" :prediction="r.pred" :start-open="true" />
            </div>
            <div class="col-12 col-lg-6">
              <div class="fw-bold small mb-1">Reference photos <span class="text-muted fw-normal">— compare with your photo</span></div>
              <AIReferenceGallery :groups="groupsFor(r)" />
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- About (simplified) -->
    <div class="card mt-3">
      <div class="card-body">
        <button class="btn btn-link p-0 fw-bold" @click="showAbout = !showAbout" :aria-expanded="showAbout">
          About this tool {{ showAbout ? '▾' : '▸' }}
        </button>
        <div v-show="showAbout" class="small mt-2">
          <p>A model that identifies butterflies from wing photos, used as a curation tool to flag uncertain or
          mislabelled identifications in the image database. It pairs a frozen <strong>BioCLIP 2.5-H</strong> image
          backbone (released February 2026) with a hierarchical classification head that predicts the finest taxon and
          rolls those predictions up the taxonomy, keeping them consistent across subspecies, species, genus, and higher
          ranks. To focus it on wing pattern, images are first cropped to the wings by a lightweight wing-segmentation
          model (YOLO26s-seg) trained on wing masks generated with SAM 3.</p>
          <p class="mb-1"><strong>Deployment accuracy</strong> on Sanger specimens (out-of-fold, dorsal+ventral combined,
          with the side-of-Andes + Ecuador prior):</p>
          <table class="table table-sm table-bordered w-auto small">
            <thead><tr><th>Rank</th><th>Top-1</th></tr></thead>
            <tbody>
              <tr><td>Subspecies</td><td>83.3%</td></tr>
              <tr><td>Species</td><td>88.9%</td></tr>
              <tr><td>Genus</td><td>95.2%</td></tr>
              <tr><td>Tribe</td><td>96.8%</td></tr>
              <tr><td>Subfamily</td><td>98.8%</td></tr>
              <tr><td>Family</td><td>99.5%</td></tr>
            </tbody>
          </table>
          <p class="text-muted">Performance is strong and reliable from genus upward (≥95%); subspecies is the hard
          frontier, because Müllerian mimicry produces look-alikes across species — exactly the cases the tool surfaces
          for checking. The backbone is currently frozen with only the head trained; planned backbone fine-tuning is the
          main lever expected to lift species and subspecies accuracy further.</p>
          <p class="mb-1">
            <strong>Models &amp; code:</strong>
            <a href="https://huggingface.co/spaces/fr4nzzch/butterfly-id" target="_blank" rel="noopener noreferrer">Hugging Face Space (inference API + weights)</a>
            · backbone <a href="https://huggingface.co/imageomics/bioclip-2.5-vith14" target="_blank" rel="noopener noreferrer">BioCLIP 2.5-H</a>
            · <a href="https://huggingface.co/facebook/sam3" target="_blank" rel="noopener noreferrer">SAM 3</a> (wing-mask training labels).
          </p>
          <p class="mb-1">
            <strong>Training data:</strong> the subspecies-level taxonomic identifications used to train the
            classifier were compiled from
            <a href="https://www.butterfliesofamerica.com" target="_blank" rel="noopener noreferrer">Butterflies of America</a>,
            <a href="https://www.sangay.eu" target="_blank" rel="noopener noreferrer">Sangay</a>,
            <a href="https://www.noreste.eu" target="_blank" rel="noopener noreferrer">Noreste</a>, and
            <a href="https://www.cotacachi.eu" target="_blank" rel="noopener noreferrer">Cotacachi</a>.
          </p>
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
.preview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 0.5rem; }
.preview { position: relative; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; background: #f8fafc; }
.preview.invalid { border-color: #dc3545; }
.preview img { width: 100%; height: 84px; object-fit: cover; display: block; }
.preview .rm { position: absolute; top: 2px; right: 2px; width: 26px; height: 26px; border: none; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; line-height: 1; cursor: pointer; }
.mask-bar { margin-bottom: .35rem; }
.loc-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .75rem; }
.loc-field { min-width: 200px; flex: 0 1 240px; }
.loc-guess { display: flex; flex-direction: column; }
.guess-chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.guess-chip { --bs-btn-padding-y: .15rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem; }
.guess-chip .chip-pct { opacity: .7; font-variant-numeric: tabular-nums; }
.drop-overlay { position: fixed; inset: 0; z-index: 1080; background: rgba(13,110,253,.12); backdrop-filter: blur(1px); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.drop-overlay-inner { border: 3px dashed #0d6efd; border-radius: 16px; padding: 2rem 3rem; background: #fff; color: #0d6efd; font-weight: 600; font-size: 1.1rem; box-shadow: 0 8px 30px rgba(0,0,0,.15); }
</style>
