<script setup>
import { ref } from 'vue'
import CollectionTab from './components/CollectionTab.vue'
import InsectaryTab from './components/InsectaryTab.vue'
import CrisprTab from './components/CrisprTab.vue'
import UpdateTab from './components/UpdateTab.vue'

const currentTab = ref('Collection')

const tabs = {
  'Collection': CollectionTab,
  'Insectary': InsectaryTab,
  'CRISPR': CrisprTab,
  'Update DB': UpdateTab
}
</script>

<template>
  <div>
    <!-- Navbar -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Ikiam Wings Gallery</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarNav">
          <ul class="navbar-nav">
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
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="container-fluid mt-3">
      <!-- Header Info -->
      <div class="alert alert-light border text-center" role="alert">
        Navigation: Shift + Scroll = Zoom all | Ctrl + Scroll = Zoom one | Drag = Move
        <br>
        <small>
          Github: <a href='https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/' target='_blank'>rapidspeciation/Shiny_Ikiam_Wings_Gallery</a>
        </small>
      </div>

      <!-- Dynamic Tab Component -->
      <keep-alive>
        <component :is="tabs[currentTab]" />
      </keep-alive>
    </div>
  </div>
</template>

<style>
.gallery-card {
  height: 100%;
  text-align: center;
  border: 1px solid #ddd;
  padding: 10px;
  border-radius: 8px;
  background: #fff;
}
.img-container {
  overflow: hidden;
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
}
.panzoom-img {
  max-width: 100%;
  height: auto;
  cursor: grab;
}
</style>
