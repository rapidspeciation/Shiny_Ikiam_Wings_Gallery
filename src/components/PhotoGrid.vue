<script setup>
import PhotoCard from './PhotoCard.vue'

defineProps({
  loading: Boolean,
  isFiltered: Boolean,
  items: Array,         // The paginated data
  totalCount: Number,   // Total matches
  hasMore: Boolean,
  side: String,
  error: String
})

defineEmits(['loadMore'])
</script>

<template>
  <div class="mt-4">
    <!-- Loading / Error States -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="mt-2">Loading Database...</p>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- Results -->
    <div v-if="!loading && isFiltered">
      <h4 class="text-center mb-4 fw-bold">{{ totalCount }} individuals found</h4>
      <p v-if="totalCount > 0" class="text-center text-muted small mb-4">
        Showing {{ items.length }} of {{ totalCount }} photos
      </p>

      <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4">
        <div class="col" v-for="item in items" :key="item.CAM_ID">
          <PhotoCard :item="item" :side="side" />
        </div>
      </div>

      <!-- Load More Button -->
      <div v-if="hasMore" class="text-center mt-5 mb-5">
        <button class="btn btn-outline-primary btn-lg px-5" @click="$emit('loadMore')">
          Load More
        </button>
      </div>

      <div v-if="totalCount === 0" class="text-center text-muted py-5">
        No results found matching these filters.
      </div>
    </div>
  </div>
</template>
