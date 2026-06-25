<script setup>
// AI ID tab: upload butterfly photo(s) -> BioCLIP 2.5-H prediction (genus ▸ species
// ▸ subspecies). Inference runs ONCE per photo (raw leaf probabilities); the
// country + side-of-Andes prior is a pure client-side re-rank, so each result can
// change its location after the fact — or let us guess it from the photo — with no
// re-inference. Reference photos (Sanger first, GBIF museum-first fallback) are
// shown in a large-image gallery for visual comparison.
import { ref, computed, onMounted } from 'vue'
import FilterSelect from './FilterSelect.vue'
import PredictionPanel from './PredictionPanel.vue'
import AIReferenceGallery from './AIReferenceGallery.vue'
import { predictRaw, rankLeaves } from '../utils/aiPredict.js'
import { loadCountries, guessRegion } from '../utils/geoPrior.js'
import { getChecklist } from '../composables/useCurationData.js'

// ---- intake ----
const items = ref([])              // { id, name, previewUrl, blob, status, error }
const preparing = ref(false)
const fileInput = ref(null)
const cameraInput = ref(null)
const isOver = ref(false)
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
  preparing.value = true
  for (const file of Array.from(fileList || [])) {
    const id = `img_${++_id}`
    if (!file.type.startsWith('image/') || /\.hei[cf]$/i.test(file.name)) {
      items.value.push({ id, name: file.name, previewUrl: null, blob: null, status: 'invalid',
        error: /\.hei[cf]$/i.test(file.name) ? 'HEIC isn\'t supported in browsers — set your camera to "Most Compatible" (JPEG).' : 'Not an image file.' })
      continue
    }
    const previewUrl = URL.createObjectURL(file)
    try {
      const blob = await downscale(file)
      items.value.push({ id, name: file.name, previewUrl, blob, status: 'ready', error: null })
    } catch {
      items.value.push({ id, name: file.name, previewUrl, blob: null, status: 'invalid', error: 'Could not read this image.' })
    }
  }
  preparing.value = false
}

function onPick(e) { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }
function onDrop(e) { isOver.value = false; if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files) }
function removeItem(id) {
  const i = items.value.findIndex((x) => x.id === id)
  if (i >= 0) { if (items.value[i].previewUrl) URL.revokeObjectURL(items.value[i].previewUrl); items.value.splice(i, 1) }
}
function clearAll() {
  items.value.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl))
  items.value = []; results.value = []
}
const validItems = computed(() => items.value.filter((i) => i.status === 'ready' && i.blob))

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

onMounted(async () => {
  checklist.value = await getChecklist()
  countryOptions.value = [ANY, ...(await loadCountries())]
})

// ---- run ----
const results = ref([])   // { id, filename, mock, leaves, previewUrl, country, region, guess, pred }
const running = ref(false)
const errorMsg = ref('')

function rerank(r) {
  r.pred = rankLeaves(r.leaves, checklist.value, { country: cParam(r.country), side: sideOf(r.region) })
}

async function run() {
  if (!validItems.value.length || running.value) return
  running.value = true; errorMsg.value = ''; results.value = []
  try {
    const raws = await predictRaw(validItems.value)
    results.value = raws.map((raw) => {
      const r = {
        id: raw.id, filename: raw.filename, mock: raw.mock, leaves: raw.leaves,
        previewUrl: items.value.find((it) => it.id === raw.id)?.previewUrl,
        country: country.value, region: country.value === 'Ecuador' ? region.value : null, guess: null,
        pred: null,
      }
      rerank(r)
      return r
    })
  } catch (e) {
    errorMsg.value = e.message || 'Prediction failed.'
  } finally {
    running.value = false
  }
}

// per-card location change
function setCountry(r, v) { r.country = v; if (v !== 'Ecuador') r.region = null; r.guess = null; rerank(r) }
function setRegion(r, v) { r.region = v; r.guess = null; rerank(r) }

// "I don't know" -> infer location from the photo's raw leaves
function guess(r) {
  const g = guessRegion(checklist.value, r.leaves)
  r.country = g.country || ANY
  r.region = g.country === 'Ecuador' ? regionForSide(g.side) : null
  r.guess = g
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
    <!-- Upload + prior controls -->
    <div class="row g-3">
      <div class="col-12 col-lg-7">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Upload butterfly photo(s)</h6>
            <div class="dropzone" :class="{ over: isOver }"
              @click="fileInput.click()" @dragover.prevent="isOver = true" @dragleave.prevent="isOver = false"
              @drop.prevent="onDrop" role="button" tabindex="0"
              @keydown.enter.prevent="fileInput.click()" @keydown.space.prevent="fileInput.click()"
              aria-label="Upload images: drag and drop, or activate to choose files">
              <div class="text-muted mb-2">Drag &amp; drop, paste, or choose photos — best on a clear shot of the open wings.</div>
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
            <p class="text-muted small mb-2">Helps when look-alikes occur — down-weights butterflies not recorded in your region. You can change this per photo after identifying, or let the model guess.</p>
            <FilterSelect label="Country" :options="countryOptions" v-model="country" placeholder="Any country" />
            <div v-if="country === 'Ecuador'" class="mt-2">
              <FilterSelect label="Region (side of the Andes)" :options="REGION_OPTS" v-model="region" placeholder="Either side" />
            </div>
            <div class="d-grid mt-3">
              <button class="btn btn-success" :disabled="!validItems.length || running" @click="run">
                <span v-if="running" class="spinner-border spinner-border-sm" aria-hidden="true"></span>
                {{ running ? 'Identifying…' : `Identify ${validItems.length > 1 ? validItems.length + ' photos' : 'butterfly'}` }}
              </button>
            </div>
            <button v-if="items.length || results.length" class="btn btn-link btn-sm mt-1 p-0" @click="clearAll">Clear</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="errorMsg" class="alert alert-danger mt-3 py-2 small">{{ errorMsg }}</div>

    <!-- Results -->
    <div v-for="r in results" :key="r.id" class="card mt-3">
      <div class="card-body">
        <div v-if="r.mock" class="badge text-bg-secondary mb-2">demo — backend not connected</div>

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
            <button class="btn btn-outline-secondary btn-sm" @click="guess(r)" title="Infer the most likely location from the photo">
              I don't know — guess
            </button>
            <div v-if="r.guess" class="small text-muted mt-1">
              <template v-if="r.guess.country">
                Guessed <strong>{{ r.guess.country }}</strong>
                <span v-if="r.guess.countryConf">({{ Math.round(r.guess.countryConf * 100) }}%)</span><!--
                --><span v-if="r.guess.side">, <strong>{{ r.guess.side }}</strong> of the Andes
                  <span v-if="r.guess.sideConf">({{ Math.round(r.guess.sideConf * 100) }}%)</span></span>
              </template>
              <template v-else>Not enough signal to guess a location.</template>
            </div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-12 col-lg-6">
            <img v-if="r.previewUrl" :src="r.previewUrl" class="uploaded" :alt="r.filename" />
            <PredictionPanel :item="{ CAM_ID: r.id }" :prediction="r.pred" :start-open="true" />
          </div>
          <div class="col-12 col-lg-6">
            <div class="fw-bold small mb-1">Reference photos <span class="text-muted fw-normal">— compare with your photo</span></div>
            <AIReferenceGallery :groups="groupsFor(r)" />
          </div>
        </div>
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
.uploaded { width: 100%; max-height: 340px; object-fit: contain; background: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: .5rem; }
.loc-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .75rem; }
.loc-field { min-width: 200px; flex: 0 1 240px; }
.loc-guess { display: flex; flex-direction: column; }
</style>
