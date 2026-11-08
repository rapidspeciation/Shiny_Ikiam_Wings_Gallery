<script setup>
// Which image proxy serves the photos (troubleshooting). Lives in the navbar's settings menu.
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
  <fieldset class="image-cache mb-0">
    <legend class="fs-6 fw-bold mb-1">Image cache</legend>
    <div v-for="opt in proxyOptions" :key="opt.value" class="form-check mb-0">
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
  </fieldset>
</template>

<style scoped>
@media (pointer: coarse) { .image-cache .form-check { display: flex; } }
</style>
