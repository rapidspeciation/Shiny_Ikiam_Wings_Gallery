<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useGallery } from '../composables/useGallery.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

const rawData = ref([])
const loading = ref(true)
const error = ref(null)
const selectedColumns = ref('Auto')

const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters,
  sortBy, sortOrder, side, onlyPhotos
} = useGallery(rawData)

const filters = ref({
  species: [],
  subspecies: [],
  sex: 'male and female',
  insectaryId: null // Single select for ID usually, or search
})

// Helpers
const getUnique = (field, data) => Array.from(new Set(data.map(i => i[field]).filter(x => x && x !== "NA"))).sort()

// Options
const speciesList = computed(() => getUnique('Species', rawData.value))

const subspeciesList = computed(() => {
  let data = rawData.value
  if (filters.value.species.length > 0) data = data.filter(i => filters.value.species.includes(i.Species))
  return getUnique('Subspecies_Form', data)
})

const idList = computed(() => {
  let data = rawData.value
  if (filters.value.species.length > 0) data = data.filter(i => filters.value.species.includes(i.Species))
  if (filters.value.subspecies.length > 0) data = data.filter(i => filters.value.subspecies.includes(i.Subspecies_Form))
  return getUnique('Insectary_ID', data)
})

onMounted(async () => {
  try {
    const res = await fetch('./data/insectary.json')
    if (!res.ok) throw new Error("Failed to load data")
    rawData.value = await res.json()
  } catch (e) {
    error.value = "Error loading Insectary data."
  } finally {
    loading.value = false
  }
})

const onShowPhotos = () => {
  applyFilters((item) => {
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false
    if (filters.value.insectaryId && item.Insectary_ID !== filters.value.insectaryId) return false
    return true
  })
}
</script>

<template>
  <div>
    <!-- Options Row -->
    <div class="row g-2 mb-3 align-items-end bg-light p-3 rounded border">
      <div class="col-6 col-md-2">
        <label class="form-label small fw-bold">Columns</label>
        <select class="form-select form-select-sm" v-model="selectedColumns">
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
      <div class="col-12 col-md-3">
         <div class="form-check">
           <input class="form-check-input" type="checkbox" v-model="onlyPhotos" id="chkPhotos">
           <label class="form-check-label small" for="chkPhotos">Only Indiv. With Photos</label>
         </div>
      </div>
    </div>

    <!-- Filters -->
    <!-- Updated classes to col-6 col-md-3 -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3"><FilterSelect label="Species" v-model="filters.species" :options="speciesList" :multiple="true" /></div>
      <div class="col-6 col-md-3"><FilterSelect label="Subspecies" v-model="filters.subspecies" :options="subspeciesList" :multiple="true" /></div>
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold">Sex</label>
         <select class="form-select" v-model="filters.sex">
           <option>male and female</option>
           <option>male</option>
           <option>female</option>
         </select>
      </div>
      <div class="col-6 col-md-3"><FilterSelect label="Insectary ID" v-model="filters.insectaryId" :options="idList" placeholder="All" /></div>
    </div>

    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
    </div>

    <PhotoGrid
      :loading="loading" :error="error" :isFiltered="isFiltered"
      :items="paginatedData" :totalCount="allMatches.length" :hasMore="hasMore"
      :side="side" :columns="selectedColumns" @loadMore="loadMore"
    />
  </div>
</template>