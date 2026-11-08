<script setup>
// Light/dark button, always visible in the navbar (also on phones, beside the menu button).
// Dark shows the sun (tap for light), light shows the moon. The choice is remembered
// (useTheme.js); the first visit follows the device.
import { ref } from 'vue'
import { useTheme } from '../composables/useTheme.js'

const { theme, toggleTheme } = useTheme()
const flipped = ref(false)
function onClick() {
  toggleTheme()
  // the icon turns only when the visitor flips the theme
  flipped.value = false
  requestAnimationFrame(() => { flipped.value = true })
}
</script>

<template>
  <button type="button" class="btn btn-outline-light nav-icon-btn nav-square theme-toggle" :class="{ 'is-flipped': flipped }"
    :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
    :title="theme === 'dark' ? 'Light theme' : 'Dark theme'" @click="onClick">
    <!-- sun and moon (Feather icons, MIT) -->
    <svg v-if="theme === 'dark'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1.5v2.2M12 20.3v2.2M4.58 4.58l1.56 1.56M17.86 17.86l1.56 1.56M1.5 12h2.2M20.3 12h2.2M4.58 19.42l1.56-1.56M17.86 6.14l1.56-1.56" />
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle svg { width: 1.2rem; height: 1.2rem; }
.theme-toggle:active { transform: translateY(1px); }
.theme-toggle.is-flipped svg { animation: theme-turn 0.4s cubic-bezier(.2, .8, .2, 1); }
@keyframes theme-turn { from { transform: rotate(-90deg) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .theme-toggle.is-flipped svg { animation: none; }
  .theme-toggle:active { transform: none; }
}
</style>
