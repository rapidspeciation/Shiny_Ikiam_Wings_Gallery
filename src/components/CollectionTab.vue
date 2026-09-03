<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGallery } from '../composables/useGallery.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getAllPredictions, predictionDiffers, rankComparison, resolveCamid } from '../composables/useCurationData.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'
import { AUDIT_RANKS } from '../utils/taxonomy.js'

const BASE = import.meta.env.BASE_URL

// --- State ---
const { data: rawData, loading, error, ensureLoaded } = useDataset('collection', './data/collection.json')

const { columns, sortBy, sortOrder, side, onlyPhotos, onePerSubspecies } = useGlobalGalleryOptions()

const filters = ref({
  family: null,
  subfamily: null,
  tribe: null,
  species: [],
  subspecies: [],
  sex: 'male and female',
  idStatus: [],
  modelVsRecorded: 'All',   // All | Differs | Matches | No prediction
  reviewRank: 'species'
})

// Initialize the Gallery Logic
const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters
} = useGallery(rawData, { sortBy, sortOrder, side, onlyPhotos, onePerSubspecies, reviewRank: computed(() => filters.value.reviewRank) })

const auditSummary = ref([])
const auditLoaded = ref(false)
const disagreementUrl = computed(() => {
  const base = typeof window === 'undefined' ? '/Shiny_Ikiam_Wings_Gallery/' : `${window.location.origin}${BASE}`
  return `${base}collection?modelVsRecorded=Differs&reviewRank=${filters.value.reviewRank}&sortBy=ModelConfidence&sortOrder=desc`
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
  const params = new URLSearchParams(window.location.search)
  if (params.get('modelVsRecorded')) filters.value.modelVsRecorded = params.get('modelVsRecorded')
  if (params.get('reviewRank') && ['genus', 'species', 'subspecies'].includes(params.get('reviewRank'))) {
    filters.value.reviewRank = params.get('reviewRank')
  }
  if (params.get('sortBy')) sortBy.value = params.get('sortBy')
  if (params.get('sortOrder') && ['asc', 'desc'].includes(params.get('sortOrder'))) sortOrder.value = params.get('sortOrder')
  if (params.get('modelVsRecorded')) await onShowPhotos()
})

function buildAuditSummary(items, predictions) {
  return AUDIT_RANKS.map(rank => {
    const counts = { rank, totalScored: 0, agreements: 0, disagreements: 0, missing: 0, synonymOnly: 0 }
    for (const item of items) {
      const comparison = rankComparison(item, predictions[resolveCamid(item)] || null, rank)
      if (comparison.status === 'missing') counts.missing += 1
      else {
        counts.totalScored += 1
        if (comparison.status === 'disagreement') counts.disagreements += 1
        else if (comparison.status === 'synonym-only') counts.synonymOnly += 1
        else counts.agreements += 1
      }
    }
    return counts
  })
}

const onShowPhotos = async () => {
  // "Model vs recorded" filtering AND "Model confidence" sorting both need the
  // predictions map; load (cached) before filtering so the result set + order are
  // complete on first render. Uses the SAME predictionDiffers helper as the panel's
  // "differs" badge, so the two always agree.
  const mvr = filters.value.modelVsRecorded
  // The audit table is part of the review surface, so always load the single
  // frozen candidate-D map.  There is deliberately no historical fallback.
  const predictions = await getAllPredictions()
  auditSummary.value = buildAuditSummary(rawData.value, predictions)
  auditLoaded.value = true

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
      const comparison = rankComparison(item, pred, filters.value.reviewRank)
      if (mvr === 'No prediction') {
        if (comparison.status !== 'missing') return false
      } else if (mvr === 'Differs') {
        if (comparison.status !== 'disagreement' || !predictionDiffers(item, pred, filters.value.reviewRank)) return false
      } else if (mvr === 'Matches') {
        if (comparison.status !== 'agreement' && comparison.status !== 'synonym-only') return false
      }
    }
    return true
  }, predictions)
}

// switching the sort to "Model confidence" after photos are shown needs the
// predictions map loaded; re-run the query so it's fetched and passed through.
watch([() => sortBy.value, () => sortOrder.value, () => filters.value.reviewRank], () => {
  if (isFiltered.value && (sortBy.value === 'ModelConfidence' || sortOrder.value || filters.value.reviewRank)) onShowPhotos()
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
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold" for="review-rank-filter">Review rank</label>
         <select id="review-rank-filter" class="form-select" v-model="filters.reviewRank" aria-label="Rank used for model disagreement and confidence review">
           <option value="genus">Genus</option>
           <option value="species">Species</option>
           <option value="subspecies">Subspecies</option>
         </select>
      </div>
    </div>

    <!-- Action -->
    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
      <a class="btn btn-outline-warning ms-2" :href="disagreementUrl" aria-label="Open direct model disagreement review">Open disagreements</a>
    </div>

    <section v-if="auditLoaded" class="candidate-audit card border-light-subtle mb-3" aria-labelledby="candidate-audit-title">
      <div class="card-body py-2 px-3">
        <div class="d-flex flex-wrap align-items-baseline justify-content-between gap-2">
          <h2 id="candidate-audit-title" class="h6 mb-1">Candidate D audit by rank</h2>
          <span class="small text-muted">Canonical comparisons; recorded taxonomy is not model output.</span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm small mb-0" aria-label="Candidate D audit summary">
            <thead><tr><th>Rank</th><th>Total scored</th><th>Agreements</th><th>Disagreements</th><th>Missing</th><th>Synonym-only</th></tr></thead>
            <tbody>
              <tr v-for="row in auditSummary" :key="row.rank">
                <th scope="row">{{ row.rank }}</th><td>{{ row.totalScored }}</td><td>{{ row.agreements }}</td><td>{{ row.disagreements }}</td><td>{{ row.missing }}</td><td>{{ row.synonymOnly }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

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
