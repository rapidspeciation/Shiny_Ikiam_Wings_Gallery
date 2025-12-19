<script setup>
import { ref } from 'vue'
import { usePanzoomRegistry } from './composables/usePanzoomRegistry.js' 

import CollectionTab from './components/CollectionTab.vue'
import InsectaryTab from './components/InsectaryTab.vue'
import CrisprTab from './components/CrisprTab.vue'
import SearchTab from './components/SearchTab.vue'
import UpdateTab from './components/UpdateTab.vue'
import GalleryOptionsBar from './components/GalleryOptionsBar.vue'

const currentTab = ref('Collection')

const tabs = {
  'Collection': CollectionTab,
  'Insectary': InsectaryTab,
  'CRISPR': CrisprTab,
  'Search by CAMID': SearchTab,
  'Update DB': UpdateTab
}

// Zoom Logic
const { attachGlobalListeners, resetAll } = usePanzoomRegistry()
attachGlobalListeners()
</script>

<template>
  <div>
    <!-- Navbar -->
    <!-- Changed to navbar-expand-md for better tablet support -->
    <nav class="navbar navbar-expand-md navbar-dark bg-dark sticky-top">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Ikiam Wings Gallery</a>
        
        <!-- Mobile Toggler -->
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
          <span class="navbar-toggler-icon"></span>
        </button>

        <!-- Collapsible Content -->
        <div class="collapse navbar-collapse" id="navbarContent">
          
          <!-- Tabs List -->
          <ul class="navbar-nav mb-2 mb-md-0">
            <li class="nav-item" v-for="(component, name) in tabs" :key="name">
              <a 
                class="nav-link px-2 small-text" 
                :class="{ active: currentTab === name }" 
                href="#" 
                @click.prevent="currentTab = name"
              >
                {{ name }}
              </a>
            </li>
          </ul>
          
          <!-- Reset Button -->
          <div class="d-flex ms-md-3 mt-2 mt-md-0">
            <button class="btn btn-sm btn-outline-light text-nowrap" @click="resetAll">
              Reset Zoom
            </button>
          </div>
          
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="container-fluid mt-3">
      <div class="alert alert-light border text-center py-2 small" role="alert">
        Navigation: Shift + Scroll = Zoom all | Ctrl + Scroll = Zoom one | Drag = Move
        <span class="d-none d-md-inline"> | Github: <a href='https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/' target='_blank'>rapidspeciation/Shiny_Ikiam_Wings_Gallery</a></span>
      </div>

      <GalleryOptionsBar />

      <keep-alive>
        <component :is="tabs[currentTab]" />
      </keep-alive>
    </div>
  </div>
</template>

<style>
/* Global Styles */
.gallery-card {
  height: 100%;
  text-align: center;
  border: 1px solid #ddd;
  padding: 10px;
  border-radius: 8px;
  background: #fff;
}
.nav-link {
  cursor: pointer;
}
/* Slightly smaller text for tabs to fit more on screen */
.small-text {
  font-size: 0.95rem;
}
</style>
