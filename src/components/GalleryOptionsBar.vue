<script setup>
import { computed, watch } from 'vue'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'

const props = defineProps({ currentTab: { type: String, default: '' } })

const {
  columns,
  sortBy,
  sortOrder,
  side,
  onlyPhotos,
  onePerSubspecies,
  showBoxes
  // zoomWings + expandPredictions live in the top navbar now (App.vue)
} = useGlobalGalleryOptions()

// Only the Collection tab carries model predictions, so "Model confidence" sort is
// offered there alone. Leaving it (or any tab without predictions) reverts the sort
// to the default so other tabs don't silently keep an inapplicable sort.
const DEFAULT_SORT = 'Preservation_date'
const supportsModelConfidence = computed(() => props.currentTab === 'Collection')
watch(supportsModelConfidence, (ok) => {
  if (!ok && ['ModelConfidence', 'SexConfidence'].includes(sortBy.value)) sortBy.value = DEFAULT_SORT
}, { immediate: true })

</script>

<template>
  <div class="row g-2 mb-3 align-items-end wg-box p-3 rounded border">
    <!-- phones always show one column (PhotoGrid), so Columns is hidden there and Side gets a full row -->
    <div class="d-none d-md-block col-md-2">
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
        <option value="CAM_ID">CAMID</option>
        <option value="Row Number">Row #</option>
        <option v-if="supportsModelConfidence" value="ModelConfidence">Model confidence (taxonomy)</option>
        <option v-if="supportsModelConfidence" value="SexConfidence">Model confidence (sex)</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold">Order</label>
      <select class="form-select form-select-sm" v-model="sortOrder">
        <option value="desc">Desc</option>
        <option value="asc">Asc</option>
      </select>
    </div>
    <div class="col-12 col-md-2">
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
      <!-- the image cache choice moved to the page footer (troubleshooting) -->
      <div class="form-check form-switch form-check-inline">
        <input class="form-check-input" type="checkbox" role="switch" id="chkShowBoxes"
               v-model="showBoxes" aria-describedby="chkShowBoxesHelp">
        <label class="form-check-label small" for="chkShowBoxes">Wing boxes</label>
      </div>
      <span id="chkShowBoxesHelp" class="visually-hidden">Draw detected wing bounding boxes over each photo</span>
    </div>
  </div>
</template>

<style scoped>
.curation-legend {
  /* legend resets to block/auto width; keep it inline-sized + un-bold-large */
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--wg-muted);
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
