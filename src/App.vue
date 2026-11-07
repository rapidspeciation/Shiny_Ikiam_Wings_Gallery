<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { usePanzoomRegistry } from './composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from './composables/useGlobalGalleryOptions.js'
import { useDataset } from './composables/useDataset.js'
import { preloadBoxes } from './composables/useCurationData.js'
import { useWingOutlines } from './composables/useWingOutlines.js'
import { extractGoogleDriveFileId, checkAllTiers } from './utils/imageProxy.js'

import CollectionTab from './components/CollectionTab.vue'
import InsectaryTab from './components/InsectaryTab.vue'
import CrisprTab from './components/CrisprTab.vue'
import SearchTab from './components/SearchTab.vue'
import UpdateTab from './components/UpdateTab.vue'
import AIIdTab from './components/AIIdTab.vue'
import GalleryOptionsBar from './components/GalleryOptionsBar.vue'
import TaxonDrawer from './components/TaxonDrawer.vue'
import PhotoLightbox from './components/PhotoLightbox.vue'
import ImageCacheSettings from './components/ImageCacheSettings.vue'
import { useTaxonDrawer } from './composables/useTaxonDrawer.js'

// Pinned in the top navbar so they stay reachable while scrolling through photos.
const { zoomWings, showOutlines, expandPredictions } = useGlobalGalleryOptions()

// The outlines file (several MB) is fetched the first time the switch is on,
// also when a shared link turns it on.
const { outlineStatus, ensureOutlines } = useWingOutlines()
watch(showOutlines, on => { if (on) ensureOutlines() }, { immediate: true })

const tabs = {
  'Collection': CollectionTab,
  'Insectary': InsectaryTab,
  'CRISPR': CrisprTab,
  'Search CAMID': SearchTab,
  'Update DB': UpdateTab,
  'AI Identifier': AIIdTab
}

// --- URL <-> tab routing (shareable deep links, e.g. .../ai_identifier) ---------
// Path-based under the Vite base (/Shiny_Ikiam_Wings_Gallery/). The dev server and a
// 404.html SPA fallback (see vite.config.js) serve the app for these deep links.
const BASE = import.meta.env.BASE_URL
const slugByTab = {
  'Collection': 'collection',
  'Insectary': 'insectary',
  'CRISPR': 'crispr',
  'Search CAMID': 'search',
  'Update DB': 'update',
  'AI Identifier': 'ai_identifier'
}
const tabBySlug = Object.fromEntries(Object.entries(slugByTab).map(([t, s]) => [s, t]))
function tabFromUrl() {
  let p = window.location.pathname
  if (p.startsWith(BASE)) p = p.slice(BASE.length)
  const slug = p.replace(/^\/+|\/+$/g, '').toLowerCase()
  return tabBySlug[slug] || 'Collection'
}
const currentTab = ref(tabFromUrl())
function navigate(name) {
  currentTab.value = name
  const url = BASE + (slugByTab[name] || '')
  if (window.location.pathname.replace(/\/+$/, '') !== url.replace(/\/+$/, '')) {
    window.history.pushState({}, '', url)
  }
  // collapsed (phone) menu: close it after a tab is picked, via Bootstrap's own toggler
  if (document.getElementById('navbarContent')?.classList.contains('show')) {
    document.querySelector('.navbar-toggler')?.click()
  }
}
function onPopState() { currentTab.value = tabFromUrl() }
// zoom switches and Reset zoom act on gallery photos: hidden where there are none
const hasPhotoTools = computed(() => !['AI Identifier', 'Update DB'].includes(currentTab.value))

// "Skip to filters": first Tab stop, moves focus past the navbar and the view options
const mainTask = ref(null)
const skipLabel = computed(() => (['Collection', 'Insectary', 'CRISPR'].includes(currentTab.value) ? 'Skip to filters' : 'Skip to main content'))
function skipToMain() {
  const el = mainTask.value
  if (!el) return
  el.focus({ preventScroll: true })
  const nav = document.querySelector('nav.sticky-top')
  const top = el.getBoundingClientRect().top + window.scrollY - (nav ? nav.getBoundingClientRect().height : 0) - 8
  window.scrollTo({ top: Math.max(0, top) })
}
// the compare drawer belongs to the gallery tab it was opened from
const { closeDrawer } = useTaxonDrawer()
watch(currentTab, () => closeDrawer())

// Zoom Logic
const { attachGlobalListeners, resetAll } = usePanzoomRegistry()
attachGlobalListeners()

// Startup probe: test which image tiers are reachable
const { ensureLoaded } = useDataset('collection', './data/collection.json')

onMounted(async () => {
  window.addEventListener('popstate', onPopState)   // back/forward updates the tab
  try {
    const data = await ensureLoaded()
    const sample = data.find(item => item.URLd || item.URLv)
    if (sample) {
      const url = sample.URLd || sample.URLv
      const fileId = extractGoogleDriveFileId(url)
      if (fileId) checkAllTiers(fileId)
    }
  } catch { /* dataset load handled elsewhere */ }

  // Warm the wing-boxes cache during idle so the first "Zoom to wings" / "Wing
  // boxes" toggle is instant instead of waiting on a ~2 MB cold fetch.
  const warm = () => preloadBoxes()
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 4000 })
  else setTimeout(warm, 2000)
})
</script>

<template>
  <div>
    <a class="visually-hidden-focusable skip-link" href="#main-task" @click.prevent="skipToMain">{{ skipLabel }}</a>
    <!-- Navbar -->
    <!-- Collapses below xl: from md the tabs and switches wrapped into a ~170 px sticky bar -->
    <nav class="navbar navbar-expand-xl navbar-dark wg-navbar sticky-top">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Ikiam Wings Gallery</a>
        
        <!-- Mobile Toggler -->
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
          <span class="navbar-toggler-icon"></span>
        </button>

        <!-- Collapsible Content -->
        <div class="collapse navbar-collapse" id="navbarContent">
          
          <!-- Tabs List -->
          <ul class="navbar-nav mb-2 mb-xl-0">
            <li class="nav-item" v-for="(component, name) in tabs" :key="name">
              <a 
                class="nav-link px-2 small-text text-nowrap" 
                :class="{ active: currentTab === name }"
                :href="BASE + (slugByTab[name] || '')"
                @click.prevent="navigate(name)"
              >
                {{ name }}
              </a>
            </li>
          </ul>
          
          <!-- Pinned curation toggles + Reset (stay reachable while scrolling); only on the photo tabs -->
          <div v-if="hasPhotoTools" class="d-flex flex-wrap align-items-center gap-2 ms-xl-auto mt-2 mt-xl-0 nav-tools">
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" role="switch" id="navZoomWings" v-model="zoomWings">
              <label class="form-check-label small text-light" for="navZoomWings">Zoom to wings</label>
            </div>
            <div class="form-check form-switch mb-0" title="Wing outlines from the Database Manager's readings: forewings orange, hindwings blue">
              <input class="form-check-input" type="checkbox" role="switch" id="navShowOutlines" v-model="showOutlines">
              <label class="form-check-label small text-light" for="navShowOutlines">
                Wing outlines<span v-if="showOutlines && outlineStatus === 'loading'" class="text-white-50"> (loading&hellip;)</span><span v-else-if="showOutlines && ['empty', 'error'].includes(outlineStatus)" class="text-white-50"> (not available)</span>
              </label>
            </div>
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" role="switch" id="navShowPred" v-model="expandPredictions">
              <label class="form-check-label small text-light" for="navShowPred">Show predictions</label>
            </div>
            <!-- mouse and keyboard shortcuts (not on phones) -->
            <div class="dropdown d-none d-md-block">
              <button type="button" class="btn btn-sm btn-outline-light nav-icon-btn" data-bs-toggle="dropdown" aria-expanded="false"
                aria-label="Photo shortcuts" title="Photo shortcuts">?</button>
              <div class="dropdown-menu dropdown-menu-end p-3 small help-menu">
                <div class="fw-bold mb-1">Photo shortcuts</div>
                <ul class="list-unstyled mb-0">
                  <li>Click a photo: open it large</li>
                  <li>Shift + scroll: zoom all photos</li>
                  <li>Ctrl + scroll: zoom one photo</li>
                  <li>Drag: move a zoomed photo</li>
                </ul>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-light nav-icon-btn" aria-label="Reset zoom" title="Reset zoom" @click="resetAll">
              <!-- arrow-counterclockwise (Bootstrap Icons, MIT) -->
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
                <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
              </svg>
            </button>
          </div>
          
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="container-fluid mt-3">
      <GalleryOptionsBar v-if="currentTab !== 'AI Identifier'" :current-tab="currentTab" />

      <div id="main-task" ref="mainTask" tabindex="-1" class="main-task">
        <keep-alive>
          <component :is="tabs[currentTab]" />
        </keep-alive>
      </div>
      <TaxonDrawer />
      <PhotoLightbox />
    </div>

    <footer class="container-fluid small text-body-secondary py-3 mt-4 d-flex flex-wrap justify-content-center align-items-start column-gap-4 row-gap-2">
      <span>GitHub: <a href="https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/" target="_blank" rel="noopener noreferrer">rapidspeciation/Shiny_Ikiam_Wings_Gallery</a></span>
      <ImageCacheSettings v-if="hasPhotoTools" />
    </footer>
  </div>
</template>

<style>
/* Global Styles */
.gallery-card {
  height: 100%;
  text-align: center;
  border: 1px solid var(--wg-card-border);
  padding: 10px;
  border-radius: 8px;
  background: var(--wg-card);
  color: var(--bs-body-color);
}
/* alive cards: lift on hover, press on click */
.gallery-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
@media (hover: hover) {
  .gallery-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px var(--wg-shadow);
  }
}
.gallery-card:active {
  transform: translateY(0) scale(0.995);
  box-shadow: 0 2px 6px var(--wg-shadow);
}
@media (prefers-reduced-motion: reduce) {
  .gallery-card { transition: none; }
  .gallery-card:hover, .gallery-card:active { transform: none; }
}
/* a shade apart from the page in both themes */
.wg-navbar {
  background: var(--wg-nav);
  box-shadow: inset 0 -1px 0 var(--wg-nav-border);   /* no extra height */
}
.nav-link {
  cursor: pointer;
}
/* 1200 to 1399 px: tabs and switches share one row (they wrapped to 87 px) */
@media (min-width: 1200px) and (max-width: 1399.98px) {
  .navbar-nav .nav-link.px-2 { padding-left: 0.4rem !important; padding-right: 0.4rem !important; }
  .nav-tools { column-gap: 0.75rem !important; }
  .navbar-brand { margin-right: 0.6rem; }
}
@media (min-width: 1200px) and (max-width: 1279.98px) {
  .navbar-brand { font-size: 1.125rem; }
  .navbar-nav .small-text { font-size: 0.875rem; }
  .nav-tools .form-check-label { font-size: 0.8125rem; }
}
.skip-link {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 1100;
  padding: 0.5rem 0.9rem;
  border-radius: 0.375rem;
  background: var(--bs-body-bg);
  color: var(--bs-link-color);
  box-shadow: 0 2px 10px var(--wg-shadow);
}
.main-task:focus { outline: none; }
.help-menu { min-width: 15rem; }
.nav-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0.45rem;
}
/* Slightly smaller text for tabs to fit more on screen */
.small-text {
  font-size: 0.95rem;
}
</style>
