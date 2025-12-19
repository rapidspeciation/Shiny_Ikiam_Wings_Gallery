<script setup>
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'

const {
  columns,
  sortBy,
  sortOrder,
  side,
  onlyPhotos,
  onePerSubspecies
} = useGlobalGalleryOptions()
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
  </div>
</template>
