<script setup>
import { ref } from 'vue'
const password = ref('')
const status = ref('')
const isAuthorized = ref(false)

const checkPassword = () => {
  if (password.value === 'Hyalyris') { isAuthorized.value = true; status.value = 'Access Granted.' } 
  else { status.value = 'Incorrect Password'; password.value = '' }
}
const triggerUpdate = () => {
  window.open(`https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/actions/workflows/update_data.yml`, '_blank')
  status.value = 'Redirecting to GitHub Actions...'
}
</script>
<template>
  <div class="container mt-5" style="max-width: 600px;">
    <div class="card shadow">
      <div class="card-header bg-dark text-white">Update Database</div>
      <div class="card-body text-center">
        <div v-if="!isAuthorized">
          <input type="password" v-model="password" class="form-control mb-3" placeholder="Password" @keyup.enter="checkPassword">
          <button class="btn btn-primary" @click="checkPassword">Unlock</button>
        </div>
        <div v-else>
          <button class="btn btn-danger btn-lg" @click="triggerUpdate">🚀 Trigger Database Update</button>
        </div>
        <p class="mt-3 text-muted">{{ status }}</p>
      </div>
    </div>
  </div>
</template>
