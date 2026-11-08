<script setup>
// Settings button in the top navbar (gear): on the photo tabs the image cache and the photo
// shortcuts; once a theme was picked with the sun/moon button, a way back to the device's setting.
// Reachable from the sticky navbar at any scroll depth. Hidden when it would be empty.
import { useTheme } from '../composables/useTheme.js'
import ImageCacheSettings from './ImageCacheSettings.vue'

defineProps({ showImageCache: { type: Boolean, default: false } })

const { themeMode, setTheme } = useTheme()
</script>

<template>
  <div v-if="showImageCache || themeMode !== 'system'" class="dropdown">
    <button type="button" class="btn btn-outline-light nav-icon-btn nav-square" data-bs-toggle="dropdown" data-bs-auto-close="outside"
      aria-expanded="false" aria-label="Settings" title="Settings">
      <!-- gear-fill (Bootstrap Icons, MIT) -->
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
      </svg>
    </button>
    <div class="dropdown-menu dropdown-menu-end p-3 settings-menu">
      <button v-if="themeMode !== 'system'" type="button" class="btn btn-link btn-sm p-0 text-start" @click="setTheme('system')">
        Theme: follow system setting
      </button>
      <template v-if="showImageCache">
        <hr v-if="themeMode !== 'system'" class="my-3">
        <ImageCacheSettings />
        <!-- mouse and keyboard shortcuts (not on phones) -->
        <div class="d-none d-md-block small">
          <hr class="my-3">
          <div class="fw-bold mb-1">Photo shortcuts</div>
          <ul class="list-unstyled mb-0">
            <li>Click a photo: open it large</li>
            <li>Shift + scroll: zoom all photos</li>
            <li>Ctrl + scroll: zoom one photo</li>
            <li>Drag: move a zoomed photo</li>
          </ul>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings-menu { min-width: 15rem; }
</style>
