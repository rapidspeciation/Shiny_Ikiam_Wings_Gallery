<script setup>
import { ref } from 'vue'

const password = ref('')
const status = ref('')
const isAuthorized = ref(false)

// --- CONFIGURATION FOR FORK TESTING ---
// When moving to official repo, change to: "https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/actions/workflows/update_data.yml"
const repoUrl = "https://github.com/Fr4nzz/Static_hiny_Ikiam_Wings_Gallery/actions/workflows/update_data.yml"

const checkPassword = () => {
  if (password.value === 'Hyalyris') { 
    isAuthorized.value = true
    status.value = 'Access Granted.' 
  } else { 
    status.value = 'Incorrect Password'
    password.value = '' 
  }
}

const triggerUpdate = () => {
  status.value = 'Redirecting to GitHub Actions...'
  window.open(repoUrl, '_blank')
}
</script>

<template>
  <div class="container mt-5" style="max-width: 600px;">
    <div class="card shadow">
      <div class="card-header bg-dark text-white fw-bold">Update Database</div>
      <div class="card-body text-center">
        
        <p class="text-muted small mb-4">
          Because this is a static site, updating the database requires triggering the process manually on GitHub.
        </p>

        <div v-if="!isAuthorized">
          <input type="password" v-model="password" class="form-control mb-3" placeholder="Enter Password to Unlock" @keyup.enter="checkPassword">
          <button class="btn btn-primary w-100" @click="checkPassword">Unlock</button>
        </div>

        <div v-else>
          <div class="alert alert-info small text-start">
            <strong>Instructions:</strong>
            <ol class="mb-0 ps-3 mt-1">
              <li>Click the button below.</li>
              <li>On the GitHub page, click the grey <strong>"Run workflow"</strong> button.</li>
              <li>Wait ~2 minutes. The site will rebuild automatically.</li>
            </ol>
          </div>
          <button class="btn btn-success btn-lg w-100" @click="triggerUpdate">
            🚀 Go to Update Page
          </button>
        </div>

        <p class="mt-3 text-muted fw-bold">{{ status }}</p>
      </div>
    </div>
  </div>
</template>