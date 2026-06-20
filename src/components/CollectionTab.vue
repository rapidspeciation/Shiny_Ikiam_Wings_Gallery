<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGallery } from '../composables/useGallery.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getAllPredictions, predictionDiffers } from '../composables/useCurationData.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

// --- State ---
const { data: rawData, loading, error, ensureLoaded } = useDataset('collection', './data/collection.json')

const { columns, sortBy, sortOrder, side, onlyPhotos, onePerSubspecies } = useGlobalGalleryOptions()

// Initialize the Gallery Logic
const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters
} = useGallery(rawData, { sortBy, sortOrder, side, onlyPhotos, onePerSubspecies })

const filters = ref({
  family: null,
  subfamily: null,
  tribe: null,
  species: [],
  subspecies: [],
  sex: 'male and female',
  idStatus: [],
  modelVsRecorded: 'All'   // All | Differs | Matches | No prediction
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
  await ensureLoaded()
})

const onShowPhotos = async () => {
  // "Model vs recorded" filtering AND "Model confidence" sorting both need the
  // predictions map; load (cached) before filtering so the result set + order are
  // complete on first render. Uses the SAME predictionDiffers helper as the panel's
  // "differs" badge, so the two always agree.
  const mvr = filters.value.modelVsRecorded
  const needPred = mvr !== 'All' || sortBy.value === 'ModelConfidence'
  const predictions = needPred ? await getAllPredictions() : null

  applyFilters((item) => {
    if (filters.value.family && item.Family !== filters.value.family) return false
    if (filters.value.subfamily && item.Subfamily !== filters.value.subfamily) return false
    if (filters.value.tribe && item.Tribe !== filters.value.tribe) return false
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.idStatus.length > 0 && !filters.value.idStatus.includes(item.ID_status)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false

    if (predictions) {
      const pred = predictions[item.CAM_ID] || null
      if (mvr === 'No prediction') {
        if (pred) return false
      } else if (mvr === 'Differs') {
        if (!pred || !predictionDiffers(item, pred)) return false
      } else if (mvr === 'Matches') {
        if (!pred || predictionDiffers(item, pred)) return false
      }
    }
    return true
  })
}

// switching the sort to "Model confidence" after photos are shown needs the
// predictions map loaded; re-run the query so it's fetched and passed through.
watch(() => sortBy.value, (val) => {
  if (val === 'ModelConfidence' && isFiltered.value) onShowPhotos()
})
</script>

<template>
  <div>
    <!-- Filters -->
    <!-- Updated classes to col-6 col-md-3 -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3"><FilterSelect label="Family" v-model="filters.family" :options="families" /></div>
      <div class="col-6 col-md-3"><FilterSelect label="Subfamily" v-model="filters.subfamily" :options="subfamilies" /></div>
      <div class="col-6 col-md-3"><FilterSelect label="Tribe" v-model="filters.tribe" :options="tribes" /></div>
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
      <div class="col-6 col-md-3"><FilterSelect label="ID Status" v-model="filters.idStatus" :options="idStatuses" :multiple="true" /></div>
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold" for="mvr-filter">Model vs recorded</label>
         <select id="mvr-filter" class="form-select" v-model="filters.modelVsRecorded" aria-label="Filter by model prediction vs recorded ID">
           <option>All</option>
           <option>Differs</option>
           <option>Matches</option>
           <option>No prediction</option>
         </select>
      </div>
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
      :columns="columns"
      @loadMore="loadMore"
    />
  </div>
</template>
