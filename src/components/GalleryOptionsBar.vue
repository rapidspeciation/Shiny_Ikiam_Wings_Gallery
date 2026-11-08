<script setup>
import { computed, watch } from 'vue'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { useMediaQuery } from '../composables/useMediaQuery.js'

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

// Phones: the box folds into one line that states the current choice, so the taxon
// filters and Show Photos come up into the first screen.
const isPhone = useMediaQuery('(max-width: 575.98px)')
const SORT_LABELS = { Preservation_date: 'Date', CAM_ID: 'CAMID', 'Row Number': 'Row #', ModelConfidence: 'Model confidence (taxonomy)', SexConfidence: 'Model confidence (sex)' }
const summary = computed(() => {
  const order = sortBy.value === 'Preservation_date'
    ? (sortOrder.value === 'desc' ? 'newest first' : 'oldest first')
    : (sortOrder.value === 'desc' ? 'descending' : 'ascending')
  const parts = [`${SORT_LABELS[sortBy.value] || sortBy.value}, ${order}`, side.value]
  if (onlyPhotos.value) parts.push('Has Photos')
  if (onePerSubspecies.value) parts.push('Unique Subsp')
  if (showBoxes.value) parts.push('Wing boxes')
  return parts.join(' · ')
})
</script>

<template>
  <component :is="isPhone ? 'details' : 'div'" class="opt-box wg-box rounded border" :class="isPhone ? 'opt-folded' : 'p-3'">
    <summary v-if="isPhone" class="opt-summary"><span class="fw-bold">View:</span> <span class="opt-summary-text">{{ summary }}</span></summary>
    <div class="row g-2 align-items-end m-0" :class="{ 'opt-fields': isPhone }">
    <!-- phones always show one column (PhotoGrid), so Columns is hidden there and Side gets a full row -->
    <div class="d-none d-md-block col-md-2">
      <label class="form-label small fw-bold" for="opt-columns">Columns</label>
      <select id="opt-columns" class="form-select form-select-sm" v-model="columns">
        <option value="Auto">Auto</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold" for="opt-sort">Sort By</label>
      <select id="opt-sort" class="form-select form-select-sm" v-model="sortBy">
        <option value="Preservation_date">Date</option>
        <option value="CAM_ID">CAMID</option>
        <option value="Row Number">Row #</option>
        <option v-if="supportsModelConfidence" value="ModelConfidence">Model confidence (taxonomy)</option>
        <option v-if="supportsModelConfidence" value="SexConfidence">Model confidence (sex)</option>
      </select>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label small fw-bold" for="opt-order">Order</label>
      <select id="opt-order" class="form-select form-select-sm" v-model="sortOrder">
        <option value="desc">Desc</option>
        <option value="asc">Asc</option>
      </select>
    </div>
    <div class="col-12 col-md-2">
      <label class="form-label small fw-bold" for="opt-side">Side</label>
      <select id="opt-side" class="form-select form-select-sm" v-model="side">
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
  </component>
</template>

<style scoped>
/* the same place and inner spacing as the former .row.g-2.p-3 box */
.opt-box { margin: -0.5rem -0.25rem 1rem; }
.opt-folded { margin: 0 0 0.75rem; }
.opt-summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 2.25rem 0.45rem 0.75rem;
  position: relative;
  cursor: pointer;
  list-style: none;
  font-size: 0.875rem;
}
.opt-summary::-webkit-details-marker { display: none; }
.opt-summary-text { min-width: 0; }
/* the form-select chevron, turned when open */
.opt-summary::after {
  content: "";
  position: absolute;
  right: 0.75rem;
  top: 50%;
  width: 16px;
  height: 12px;
  margin-top: -6px;
  background: var(--wg-chevron) center / 16px 12px no-repeat;
  transition: transform 0.15s ease;
}
details[open] > .opt-summary::after { transform: rotate(180deg); }
details[open] > .opt-summary { border-bottom: 1px solid var(--bs-border-color); }
.opt-fields { padding: 0.5rem 0.75rem 0.75rem; }
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
</style>
