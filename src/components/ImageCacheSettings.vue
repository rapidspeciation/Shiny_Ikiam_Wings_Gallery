<script setup>
// Which image proxy serves the photos (troubleshooting only, so it lives in the page footer).
import { getProxyState, setProxyMode } from '../utils/imageProxy.js'

const { mode: proxyMode, tierStatus } = getProxyState()

const proxyOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'wsrv', label: 'wsrv.nl' },
  { value: 'lh3', label: 'Google CDN' },
  { value: 'thumbnail', label: 'Thumbnail' }
]

function statusClass(tier) {
  const s = tierStatus.value[tier]
  if (s === 'ok') return 'bg-success'
  if (s === 'blocked') return 'bg-danger'
  return 'bg-secondary'
}
</script>

<template>
  <details class="image-cache">
    <summary>Image cache</summary>
    <div class="d-flex flex-wrap gap-2 mt-1">
      <div v-for="opt in proxyOptions" :key="opt.value" class="form-check form-check-inline mb-0">
        <input
          class="form-check-input"
          type="radio"
          name="proxyMode"
          :id="'proxy-' + opt.value"
          :value="opt.value"
          :checked="proxyMode === opt.value"
          @change="setProxyMode(opt.value)"
        >
        <label class="form-check-label" :for="'proxy-' + opt.value">
          {{ opt.label }}
          <span
            v-if="opt.value !== 'auto'"
            class="d-inline-block rounded-circle ms-1"
            :class="statusClass(opt.value)"
            style="width: 8px; height: 8px;"
          ></span>
        </label>
      </div>
    </div>
  </details>
</template>

<style scoped>
.image-cache summary { cursor: pointer; color: var(--bs-link-color); }
</style>
