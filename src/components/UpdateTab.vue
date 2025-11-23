<script setup>
import { ref } from 'vue'

const password = ref('')
const status = ref('')
const isAuthorized = ref(false)
const loading = ref(false)

// ---------------------------------------------------------
// REPLACE THIS WITH YOUR CLOUDFLARE WORKER URL
// Example: "https://ikiam-updater.your-name.workers.dev"
// ---------------------------------------------------------
const workerUrl = "https://ikiam-db-updater.franz-chandi.workers.dev/" 

const checkPassword = () => {
  if (password.value === 'Hyalyris') { 
    isAuthorized.value = true
    status.value = 'Access Granted.' 
  } else { 
    status.value = 'Incorrect Password'
    password.value = '' 
  }
}

const triggerUpdate = async () => {
  loading.value = true
  status.value = 'Contacting server...'
  
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Hyalyris' }) // Sending password for worker verification
    })

    if (response.ok) {
      status.value = '✅ Success! The database is updating in the background. Check back in 3 minutes.'
    } else {
      const data = await response.json()
      status.value = `❌ Error: ${data.message || 'Unknown error'}`
    }
  } catch (e) {
    status.value = '❌ Network Error. Could not reach update server.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="container mt-5" style="max-width: 600px;">
    <div class="card shadow">
      <div class="card-header bg-dark text-white fw-bold">Update Database</div>
      <div class="card-body text-center">
        
        <div v-if="!isAuthorized">
          <input type="password" v-model="password" class="form-control mb-3" placeholder="Enter Password to Unlock" @keyup.enter="checkPassword">
          <button class="btn btn-primary w-100" @click="checkPassword">Unlock</button>
        </div>

        <div v-else>
          <div class="alert alert-info small text-start">
            <strong>Ready to Update:</strong>
            <ul class="mb-0 ps-3 mt-1">
              <li>This will fetch new data from Google Sheets.</li>
              <li>The process takes about 2 minutes.</li>
              <li>The website will refresh automatically when done.</li>
            </ul>
          </div>
          
          <button class="btn btn-success btn-lg w-100" @click="triggerUpdate" :disabled="loading">
            <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
            {{ loading ? 'Starting Update...' : '🚀 Start Update Now' }}
          </button>
        </div>

        <p class="mt-3 text-muted fw-bold">{{ status }}</p>
      </div>
    </div>
  </div>
</template>