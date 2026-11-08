<script setup>
// Shown where a HEIC photo could not be converted (wsrv.nl failed twice): a link to the file itself.
// Used by the gallery cards (PhotoCard) and the compare drawer (TaxonDrawer).
import { driveViewUrl } from '../utils/imageProxy.js'
defineProps({ url: { type: String, required: true } })
</script>

<template>
  <div class="photo-unavailable small" @click.stop>
    <span>This HEIC photo could not be converted.</span>
    <a :href="driveViewUrl(url)" target="_blank" rel="noopener noreferrer">Open original</a>
  </div>
</template>

<style scoped>
.photo-unavailable { aspect-ratio: 3 / 2; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4rem; padding: 0.75rem; text-align: center; color: var(--wg-text-3); background: var(--wg-card-2); border: 1px dashed var(--wg-line-strong); border-radius: 4px; cursor: default; }
</style>
