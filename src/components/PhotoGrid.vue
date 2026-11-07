<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import PhotoCard from './PhotoCard.vue'
import { scrollToResults } from '../utils/scrollToResults.js'

const props = defineProps({
  loading: Boolean,
  isFiltered: Boolean,
  items: Array,
  totalCount: Number,
  hasMore: Boolean,
  side: String,
  error: String,
  columns: { type: [String, Number], default: 'Auto' },
  // changes once per new query (not per re-sort): bring the new results into view
  scrollKey: { type: Number, default: 0 },
  // Search already names each group with its count in a heading
  hideCount: { type: Boolean, default: false }
})

// one line: "225 specimens" plus "· showing 200" while more remain (each card is one specimen)
const countLine = computed(() => {
  const n = props.totalCount || 0
  const fmt = (v) => v.toLocaleString('en-US')
  let s = `${fmt(n)} ${n === 1 ? 'specimen' : 'specimens'}`
  if (props.hasMore && props.items.length < n) s += ` · showing ${fmt(props.items.length)}`
  return s
})

defineEmits(['loadMore'])

const resultsEl = ref(null)
watch(() => props.scrollKey, async () => {
  await nextTick()
  scrollToResults(resultsEl.value)
})
</script>

<template>
  <div :class="hideCount ? 'mt-2' : 'mt-4'">
    <!-- Loading / Error States -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="mt-2">Loading Database...</p>
    </div>
    
    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- before the first query the page below the button was blank, with no hint -->
    <p v-if="!loading && !error && !isFiltered" class="text-center text-muted small py-4 mb-0">
      Set any filters, then press Show Photos.
    </p>

    <!-- Results -->
    <div v-if="!loading && isFiltered" ref="resultsEl">
      <p v-if="!hideCount && totalCount > 0" class="text-center text-body-secondary mb-3">{{ countLine }}</p>

      <!-- Dynamic Grid System -->
      <div class="custom-grid" :class="`cols-${columns}`">
        <div class="grid-item" v-for="item in items" :key="item.CAM_ID">
          <PhotoCard :item="item" :side="side" />
        </div>
      </div>

      <div v-if="hasMore" class="text-center mt-5 mb-5">
        <button class="btn btn-outline-primary btn-lg px-5" @click="$emit('loadMore')">Load More</button>
      </div>
      
      <div v-if="totalCount === 0" class="text-center text-muted py-5">
        No results found matching these filters.
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-grid {
  display: grid;
  gap: 1.5rem;
  align-items: start;   /* opening one card's predictions does not stretch its row neighbours */
}
/* cards never force the column wider than the screen */
.grid-item { min-width: 0; }

/* 1 Column */
.cols-1 { grid-template-columns: 1fr; }

/* 2 Columns */
.cols-2 { grid-template-columns: repeat(2, 1fr); }

/* 3 Columns */
.cols-3 { grid-template-columns: repeat(3, 1fr); }

/* 
   Auto Configuration 
   ------------------
   OLD: minmax(max(350px, 30%), 1fr)
   NEW: minmax(max(560px, 30%), 1fr)
   
   Logic:
   1. max(560px, 30%): Ensures we never have more than 3 columns (because 30% * 4 > 100%).
   2. 560px Min Width:
      - On your 1460px effective screen: Fits 2 columns (1120px), but not 3 (1680px). -> DEFAULT 2 COLS.
      - Zoomed to 130% (~1120px screen): Fits 1 column comfortably, edges into 2. 
      - Any further zoom drops strictly to 1 column.
*/
.cols-Auto {
  grid-template-columns: repeat(auto-fill, minmax(max(560px, 30%), 1fr));
}

/* Force 1 column on mobile devices regardless of calculations */
@media (max-width: 768px) {
  .cols-Auto, .cols-2, .cols-3 { grid-template-columns: 1fr; }
}
</style>