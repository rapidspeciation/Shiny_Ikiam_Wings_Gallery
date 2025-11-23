<script setup>
import { ref } from 'vue'
import { usePanzoomRegistry } from './composables/usePanzoomRegistry.js' 

import CollectionTab from './components/CollectionTab.vue'
import InsectaryTab from './components/InsectaryTab.vue'
import CrisprTab from './components/CrisprTab.vue'
import SearchTab from './components/SearchTab.vue'
import UpdateTab from './components/UpdateTab.vue'

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
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Ikiam Wings Gallery</a>
        
        <!-- Mobile Toggler -->
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
          <span class="navbar-toggler-icon"></span>
        </button>

        <!-- Collapsible Content -->
        <div class="collapse navbar-collapse" id="navbarContent">
          
          <!-- Tabs List -->
          <!-- Removed me-auto so items stack to the left -->
          <ul class="navbar-nav mb-2 mb-lg-0">
            <li class="nav-item" v-for="(component, name) in tabs" :key="name">
              <a 
                class="nav-link" 
                :class="{ active: currentTab === name }" 
                href="#" 
                @click.prevent="currentTab = name"
              >
                {{ name }}
              </a>
            </li>
          </ul>
          
          <!-- Reset Button (Now sits immediately next to tabs) -->
          <div class="d-flex ms-lg-3">
            <button class="btn btn-sm btn-outline-light" @click="resetAll">
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
</style>