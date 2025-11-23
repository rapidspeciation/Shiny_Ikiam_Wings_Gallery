<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useGallery } from '../composables/useGallery.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

// --- State ---
const rawData = ref([])
const loading = ref(true)
const error = ref(null)

// Initialize the Gallery Logic
const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters,
  sortBy, sortOrder, side, onlyPhotos, onePerSubspecies
} = useGallery(rawData)

// --- Specific Collection Filters ---
const filters = ref({
  family: null,
  subfamily: null,
  tribe: null,
  species: [],
  subspecies: [],
  sex: 'male and female',
  idStatus: []
})

// --- Helper: Get Unique Values ---
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
  // If specific species are selected, limit to those
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

// --- Watchers: Reset children when parent changes ---
watch(() => filters.value.family, () => {
  filters.value.subfamily = null
  filters.value.tribe = null
  filters.value.species = []
  filters.value.subspecies = []
})
watch(() => filters.value.subfamily, () => {
  filters.value.tribe = null
  filters.value.species = []
  filters.value.subspecies = []
})
watch(() => filters.value.tribe, () => {
  filters.value.species = []
  filters.value.subspecies = []
})


// --- Data Loading ---
onMounted(async () => {
  try {
    const res = await fetch('./data/collection.json')
    if (!res.ok) throw new Error("Failed to load data")
    rawData.value = await res.json()
  } catch (e) {
    error.value = "Error loading data. Please ensure the database is updated."
  } finally {
    loading.value = false
  }
})

// --- The Specific Filter Function passed to the Composable ---
const onShowPhotos = () => {
  applyFilters((item) => {
    // 1. Hierarchy matches
    if (filters.value.family && item.Family !== filters.value.family) return false
    if (filters.value.subfamily && item.Subfamily !== filters.value.subfamily) return false
    if (filters.value.tribe && item.Tribe !== filters.value.tribe) return false

    // 2. Multi-selects
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.idStatus.length > 0 && !filters.value.idStatus.includes(item.ID_status)) return false

    // 3. Single Selects
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false

    return true
  })
}
</script>

<template>
  <div>
    <!-- Top Options Row (Sort/Side/Checks) -->
    <div class="row g-3 mb-3 align-items-end bg-light p-3 rounded border">
      <div class="col-md-3">
        <label class="form-label small fw-bold">Sort By</label>
        <select class="form-select form-select-sm" v-model="sortBy">
          <option value="Preservation_date">Preservation Date</option>
          <option value="CAM_ID">CAM_ID</option>
          <option value="Row Number">Row Number</option>
        </select>
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-bold">Sort Order</label>
        <select class="form-select form-select-sm" v-model="sortOrder">
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-bold">Select Side</label>
        <select class="form-select form-select-sm" v-model="side">
          <option>Dorsal</option>
          <option>Ventral</option>
          <option>Dorsal and Ventral</option>
        </select>
      </div>
      <div class="col-md-3">
         <div class="form-check">
           <input class="form-check-input" type="checkbox" v-model="onlyPhotos" id="chkPhotos">
           <label class="form-check-label small" for="chkPhotos">Only Indiv. With Photos</label>
         </div>
         <div class="form-check">
           <input class="form-check-input" type="checkbox" v-model="onePerSubspecies" id="chkOne">
           <label class="form-check-label small" for="chkOne">One Per Subspecies/Sex</label>
         </div>
      </div>
    </div>

    <!-- Filter Grid -->
    <div class="row g-3 mb-4">
      <div class="col-md-3"><FilterSelect label="Family" v-model="filters.family" :options="families" /></div>
      <div class="col-md-3"><FilterSelect label="Subfamily" v-model="filters.subfamily" :options="subfamilies" /></div>
      <div class="col-md-3"><FilterSelect label="Tribe" v-model="filters.tribe" :options="tribes" /></div>
      <div class="col-md-3">
        <FilterSelect label="Species" v-model="filters.species" :options="speciesList" :multiple="true" placeholder="Choose species" />
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <FilterSelect label="Subspecies" v-model="filters.subspecies" :options="subspeciesList" :multiple="true" placeholder="Choose subspecies" />
      </div>
      <div class="col-md-3">
         <label class="form-label small fw-bold">Select Sex</label>
         <select class="form-select" v-model="filters.sex">
           <option>male and female</option>
           <option>male</option>
           <option>female</option>
         </select>
      </div>
      <div class="col-md-3">
        <FilterSelect label="ID Status" v-model="filters.idStatus" :options="idStatuses" :multiple="true" placeholder="All" />
      </div>
    </div>

    <!-- Action Button -->
    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
    </div>

    <!-- Reusable Grid -->
    <PhotoGrid
      :loading="loading"
      :error="error"
      :isFiltered="isFiltered"
      :items="paginatedData"
      :totalCount="allMatches.length"
      :hasMore="hasMore"
      :side="side"
      @loadMore="loadMore"
    />
  </div>
</template>
