<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useGallery } from '../composables/useGallery.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

// --- State ---
const rawData = ref([])
const loading = ref(true)
const error = ref(null)
const selectedColumns = ref('Auto') // New State

// Initialize the Gallery Logic
const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters,
  sortBy, sortOrder, side, onlyPhotos, onePerSubspecies
} = useGallery(rawData)

const filters = ref({
  family: null,
  subfamily: null,
  tribe: null,
  species: [],
  subspecies: [],
  sex: 'male and female',
  idStatus: []
})

const getUnique = (field, data) => {
  const set = new Set(data.map(i => i[field]).filter(x => x && x !== "NA"))
  return Array.from(set).sort()
}

// --- Cascading Filter Options ---
const families = computed(() => getUnique('Family', rawData.value))

const subfamilies = computed(() => {
  let data = rawData.value
  if (filters.value.family) data = data.filter(i => i.Family === filters.value.family)
  return getUnique('Subfamily', data)
})

const tribes = computed(() => {
  let data = rawData.value
  if (filters.value.family) data = data.filter(i => i.Family === filters.value.family)
  if (filters.value.subfamily) data = data.filter(i => i.Subfamily === filters.value.subfamily)
  return getUnique('Tribe', data)
})

const speciesList = computed(() => {
  let data = rawData.value
  if (filters.value.family) data = data.filter(i => i.Family === filters.value.family)
  if (filters.value.subfamily) data = data.filter(i => i.Subfamily === filters.value.subfamily)
  if (filters.value.tribe) data = data.filter(i => i.Tribe === filters.value.tribe)
  return getUnique('Species', data)
})

const subspeciesList = computed(() => {
  let data = rawData.value
  if (filters.value.species.length > 0) {
    data = data.filter(i => filters.value.species.includes(i.Species))
  } else {
    if (filters.value.family) data = data.filter(i => i.Family === filters.value.family)
    if (filters.value.subfamily) data = data.filter(i => i.Subfamily === filters.value.subfamily)
    if (filters.value.tribe) data = data.filter(i => i.Tribe === filters.value.tribe)
  }
  return getUnique('Subspecies_Form', data)
})

const idStatuses = computed(() => getUnique('ID_status', rawData.value))

// Watchers
watch(() => filters.value.family, () => { filters.value.subfamily = null; filters.value.tribe = null; filters.value.species = []; filters.value.subspecies = [] })
watch(() => filters.value.subfamily, () => { filters.value.tribe = null; filters.value.species = []; filters.value.subspecies = [] })
watch(() => filters.value.tribe, () => { filters.value.species = []; filters.value.subspecies = [] })

onMounted(async () => {
  try {
    const res = await fetch('./data/collection.json')
    if (!res.ok) throw new Error("Failed to load data")
    rawData.value = await res.json()
  } catch (e) {
    error.value = "Error loading data."
  } finally {
    loading.value = false
  }
})

const onShowPhotos = () => {
  applyFilters((item) => {
    if (filters.value.family && item.Family !== filters.value.family) return false
    if (filters.value.subfamily && item.Subfamily !== filters.value.subfamily) return false
    if (filters.value.tribe && item.Tribe !== filters.value.tribe) return false
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.idStatus.length > 0 && !filters.value.idStatus.includes(item.ID_status)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false
    return true
  })
}
</script>

<template>
  <div>
    <!-- Top Options Row -->
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
           <input class="form-check-input" type="checkbox" v-model="onlyPhotos" id="chkPhotos">
           <label class="form-check-label small" for="chkPhotos">Has Photos</label>
         </div>
         <div class="form-check form-check-inline">
           <input class="form-check-input" type="checkbox" v-model="onePerSubspecies" id="chkOne">
           <label class="form-check-label small" for="chkOne">Unique Subsp</label>
         </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="row g-3 mb-4">
      <div class="col-md-3"><FilterSelect label="Family" v-model="filters.family" :options="families" /></div>
      <div class="col-md-3"><FilterSelect label="Subfamily" v-model="filters.subfamily" :options="subfamilies" /></div>
      <div class="col-md-3"><FilterSelect label="Tribe" v-model="filters.tribe" :options="tribes" /></div>
      <div class="col-md-3"><FilterSelect label="Species" v-model="filters.species" :options="speciesList" :multiple="true" /></div>
      <div class="col-md-3"><FilterSelect label="Subspecies" v-model="filters.subspecies" :options="subspeciesList" :multiple="true" /></div>
      <div class="col-md-3">
         <label class="form-label small fw-bold">Sex</label>
         <select class="form-select" v-model="filters.sex">
           <option>male and female</option>
           <option>male</option>
           <option>female</option>
         </select>
      </div>
      <div class="col-md-3"><FilterSelect label="ID Status" v-model="filters.idStatus" :options="idStatuses" :multiple="true" /></div>
    </div>

    <!-- Action -->
    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
    </div>

    <!-- Grid -->
    <PhotoGrid
      :loading="loading"
      :error="error"
      :isFiltered="isFiltered"
      :items="paginatedData"
      :totalCount="allMatches.length"
      :hasMore="hasMore"
      :side="side"
      :columns="selectedColumns"
      @loadMore="loadMore"
    />
  </div>
</template>
