<script setup>
import { ref, computed, watch } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGallery } from '../composables/useGallery.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getAllPredictions, getAllSexPredictions, predictionDiffers, resolveCamid } from '../composables/useCurationData.js'
import { matchesSexFilter } from '../utils/sexPrediction.js'
import ShareViewButton from './ShareViewButton.vue'
import { useShareView } from '../composables/useShareView.js'
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
const sexFilterError = ref('')
const taxonomyFilterError = ref('')

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
watch(() => filters.value.family, () => { filters.value.subfamily = null; filters.value.tribe = null; filters.value.species = []; filters.value.subspecies = [] }, { flush: 'sync' })
watch(() => filters.value.subfamily, () => { filters.value.tribe = null; filters.value.species = []; filters.value.subspecies = [] }, { flush: 'sync' })
watch(() => filters.value.tribe, () => { filters.value.species = []; filters.value.subspecies = [] }, { flush: 'sync' })



const onShowPhotos = async () => {
  sexFilterError.value = ''
  taxonomyFilterError.value = ''
  // "Model vs recorded" filtering AND "Model confidence" sorting both need the
  // predictions map; load (cached) before filtering so the result set + order are
  // complete on first render. Uses the SAME predictionDiffers helper as the panel's
  // "differs" badge, so the two always agree.
  const mvr = filters.value.modelVsRecorded
  const taxonomyFilter = ['Differs', 'Matches', 'No prediction'].includes(mvr)
  const sexFilter = ['Sex differs', 'Sex matches', 'No sex prediction'].includes(mvr)
  const needPred = taxonomyFilter || sortBy.value === 'ModelConfidence'
  let predictions = null
  if (needPred) {
    try {
      predictions = await getAllPredictions()
    } catch {
      taxonomyFilterError.value = 'Taxonomy predictions could not be loaded. Try again.'
      return
    }
  }
  let sexPredictions = null
  if (sexFilter || sortBy.value === 'SexConfidence') {
    try {
      sexPredictions = await getAllSexPredictions()
    } catch {
      sexFilterError.value = 'Sex predictions could not be loaded.'
      return
    }
  }

  applyFilters((item) => {
    if (filters.value.family && item.Family !== filters.value.family) return false
    if (filters.value.subfamily && item.Subfamily !== filters.value.subfamily) return false
    if (filters.value.tribe && item.Tribe !== filters.value.tribe) return false
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.idStatus.length > 0 && !filters.value.idStatus.includes(item.ID_status)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false

    if (predictions) {
      const pred = predictions[resolveCamid(item)] || null
      if (mvr === 'No prediction') {
        if (pred) return false
      } else if (mvr === 'Differs') {
        if (!pred || !predictionDiffers(item, pred)) return false
      } else if (mvr === 'Matches') {
        if (!pred || predictionDiffers(item, pred)) return false
      }
    }
    if (sexFilter && sexPredictions && !matchesSexFilter(item, sexPredictions[resolveCamid(item)], mvr)) return false
    return true
  }, predictions, sexPredictions)
}

// switching the sort to "Model confidence" after photos are shown needs the
// predictions map loaded; re-run the query so it's fetched and passed through.
watch(() => sortBy.value, (val) => {
  if (['ModelConfidence', 'SexConfidence'].includes(val) && isFiltered.value) onShowPhotos()
})
const { shareUrl } = useShareView({ slug: 'collection', filters, ensureLoaded, apply: onShowPhotos })
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
         <select id="mvr-filter" class="form-select" v-model="filters.modelVsRecorded" aria-label="Filter by model prediction versus recorded taxonomy or sex">
           <option>All</option>
           <option value="Differs">Taxonomy differs</option>
           <option value="Matches">Taxonomy matches</option>
           <option value="Sex differs">Sex differs</option>
           <option value="Sex matches">Sex matches</option>
           <option value="No sex prediction">No sex prediction</option>
         </select>
      </div>
    </div>

    <!-- Action -->
    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
      <ShareViewButton class="ms-2" :get-url="shareUrl" />
      <div v-if="taxonomyFilterError" class="small text-danger mt-2" role="alert">{{ taxonomyFilterError }}</div>
      <div v-if="sexFilterError" class="small text-danger mt-2" role="alert">{{ sexFilterError }}</div>
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
