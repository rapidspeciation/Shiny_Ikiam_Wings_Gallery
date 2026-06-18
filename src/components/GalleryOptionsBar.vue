<script setup>
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getProxyState, setProxyMode } from '../utils/imageProxy.js'

const {
  columns,
  sortBy,
  sortOrder,
  side,
  onlyPhotos,
  onePerSubspecies,
  showBoxes,
  zoomWings
} = useGlobalGalleryOptions()

const { mode: proxyMode, tierStatus } = getProxyState()

const proxyOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'wsrv', label: 'wsrv.nl' },
  { value: 'lh3', label: 'Google CDN' },
  { value: 'thumbnail', label: 'Thumbnail' }
]

function statusClass(tier) {
  const s = tierStatus.value[tier]
  if (s === 'ok') return 'bg-success'
  if (s === 'blocked') return 'bg-danger'
  return 'bg-secondary'
}
</script>

<template>
  <div class="row g-2 mb-3 align-items-end bg-light p-3 rounded border">
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold">Columns</label>
      <select class="form-select form-select-sm" v-model="columns">
        <option value="Auto">Auto</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold">Sort By</label>
      <select class="form-select form-select-sm" v-model="sortBy">
        <option value="Preservation_date">Date</option>
        <option value="CAM_ID">CAM_ID</option>
        <option value="Row Number">Row #</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold">Order</label>
      <select class="form-select form-select-sm" v-model="sortOrder">
        <option value="desc">Desc</option>
        <option value="asc">Asc</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold">Side</label>
      <select class="form-select form-select-sm" v-model="side">
        <option>Dorsal</option>
        <option>Ventral</option>
        <option>Dorsal and Ventral</option>
      </select>
    </div>
    <div class="col-12 col-md-4">
      <div class="form-check form-check-inline">
        <input class="form-check-input" type="checkbox" v-model="onlyPhotos" id="chkPhotosGlobal">
        <label class="form-check-label small" for="chkPhotosGlobal">Has Photos</label>
      </div>
      <div class="form-check form-check-inline">
        <input class="form-check-input" type="checkbox" v-model="onePerSubspecies" id="chkOneGlobal">
        <label class="form-check-label small" for="chkOneGlobal">Unique Subsp</label>
      </div>
    </div>

    <!-- Curation tools (Feature 1 boxes + zoom, Feature 2 predictions) -->
    <div class="col-12">
      <fieldset>
        <legend class="form-label small fw-bold mb-1 curation-legend">Curation tools</legend>
        <div class="d-flex flex-wrap gap-3 align-items-center">
          <div class="form-check form-switch curation-switch mb-0">
            <input
              class="form-check-input"
              type="checkbox"
              role="switch"
              id="chkShowBoxes"
              v-model="showBoxes"
              aria-describedby="chkShowBoxesHelp"
            >
            <label class="form-check-label small" for="chkShowBoxes">Wing boxes</label>
          </div>
          <div class="form-check form-switch curation-switch mb-0">
            <input
              class="form-check-input"
              type="checkbox"
              role="switch"
              id="chkZoomWings"
              v-model="zoomWings"
              aria-describedby="chkZoomWingsHelp"
            >
            <label class="form-check-label small" for="chkZoomWings">Zoom to wings</label>
          </div>
        </div>
        <span id="chkShowBoxesHelp" class="visually-hidden">Draw detected wing bounding boxes over each photo</span>
        <span id="chkZoomWingsHelp" class="visually-hidden">Zoom each photo so the detected wings fill the frame</span>
      </fieldset>
    </div>

    <div class="col-12 mt-1">
      <a class="small fw-bold text-decoration-none" data-bs-toggle="collapse" href="#imageCacheCollapse" role="button" aria-expanded="false" aria-controls="imageCacheCollapse">
        Image Cache <span class="small">&#9660;</span>
      </a>
      <div class="collapse" id="imageCacheCollapse">
        <div class="d-flex flex-wrap gap-2 mt-1">
          <div v-for="opt in proxyOptions" :key="opt.value" class="form-check form-check-inline mb-0">
            <input
              class="form-check-input"
              type="radio"
              name="proxyMode"
              :id="'proxy-' + opt.value"
              :value="opt.value"
              :checked="proxyMode === opt.value"
              @change="setProxyMode(opt.value)"
            >
            <label class="form-check-label small" :for="'proxy-' + opt.value">
              {{ opt.label }}
              <span
                v-if="opt.value !== 'auto'"
                class="d-inline-block rounded-circle ms-1"
                :class="statusClass(opt.value)"
                style="width: 8px; height: 8px;"
              ></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.curation-legend {
  /* legend resets to block/auto width; keep it inline-sized + un-bold-large */
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c757d;
  width: auto;
  float: none;
}
/* Comfortable touch targets for the switches */
.curation-switch {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
}
.curation-switch .form-check-input {
  cursor: pointer;
}
.curation-switch .form-check-label {
  cursor: pointer;
  padding-left: 0.15rem;
}
.curation-switch .form-check-input:focus-visible {
  outline: 2px solid #0d6efd;
  outline-offset: 2px;
}
</style>
