<script setup>
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  getUrl: { type: Function, required: true }
})

const copied = ref(false)
const fallbackUrl = ref('')
let copiedTimer

const clearCopiedTimer = () => {
  if (copiedTimer) {
    window.clearTimeout(copiedTimer)
    copiedTimer = undefined
  }
}

const shareView = async () => {
  clearCopiedTimer()
  copied.value = false
  fallbackUrl.value = ''

  const url = props.getUrl()

  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = undefined
    }, 2000)
  } catch {
    fallbackUrl.value = url
  }
}

const selectUrl = (event) => event.currentTarget.select()

onBeforeUnmount(clearCopiedTimer)
</script>

<template>
  <div class="d-inline-block align-middle">
    <button type="button" class="btn btn-outline-secondary" @click="shareView">
      <svg
        class="me-1"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span aria-live="polite">{{ copied ? 'Copied' : 'Share View' }}</span>
    </button>

    <div v-if="fallbackUrl" class="mt-2">
      <p class="small mb-1" aria-live="polite">Copy this link.</p>
      <input
        class="form-control form-control-sm"
        type="text"
        :value="fallbackUrl"
        readonly
        aria-label="Share view URL"
        @focus="selectUrl"
        @click="selectUrl"
      >
    </div>
  </div>
</template>
