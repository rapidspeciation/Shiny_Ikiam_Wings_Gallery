# Deploying the Static Ikiam Wings Gallery

This guide explains how to deploy the Vue.js version of the gallery using GitHub Pages and GitHub Actions. Unlike the previous EC2 setup, this requires **no servers, no Docker, and no monthly fees**.

## Prerequisites

1. A GitHub Account.
2. The Google Sheets ID and API permissions (already configured in `scripts/process_data.py`).

## Step 1: Repository Configuration

To enable the automatic deployment and database updates, you must configure the GitHub repository settings.

### 1.1 Enable GitHub Pages
1. Go to your repository on GitHub.
2. Click **Settings** > **Pages**.
3. Under **Build and deployment**:
   - **Source**: Select **GitHub Actions**.
   - (Do not select "Deploy from a branch").

### 1.2 Enable Write Permissions for Actions
The "Update Database" feature requires the GitHub Action to commit changes back to your repository.
1. Go to **Settings** > **Actions** > **General**.
2. Scroll down to **Workflow permissions**.
3. Select **Read and write permissions**.
4. Click **Save**.

## Step 2: Code Configuration

If you fork this repository, you must update two files to match your new repository URL.

### 2.1 Update `vite.config.js`
This handles the base URL for assets (CSS/JS).
```javascript
export default defineConfig({
  // ...
  // CHANGE THIS to your repository name
  base: '/Static_hiny_Ikiam_Wings_Gallery/', 
  // ...
})
```

### 2.2 Update `src/components/UpdateTab.vue`
This links the "Update" button to the correct GitHub Actions page.
```javascript
// CHANGE THIS to your repository URL
const repoUrl = "https://github.com/Fr4nzz/Static_hiny_Ikiam_Wings_Gallery/actions/workflows/update_data.yml"
```

## Step 3: Deployment Workflows

This repository uses two GitHub Actions workflows located in `.github/workflows/`.

### 🚀 3.1 `deploy.yml` (Automatic)
*   **Trigger**: runs automatically whenever code is pushed to the `main` branch.
*   **What it does**:
    1.  Installs Node.js.
    2.  Builds the Vue app (`npm run build`).
    3.  Uploads the artifacts to GitHub Pages.

### 🔄 3.2 `update_data.yml` (Manual / Triggered via UI)
*   **Trigger**: Manual "Workflow Dispatch" (clicked via the website link).
*   **What it does**:
    1.  Sets up Python.
    2.  Runs `scripts/process_data.py` to fetch Google Sheets data.
    3.  Updates `public/data/*.json`.
    4.  **Commits and Pushes** the new data to the `main` branch.
*   **Chain Reaction**: Since this pushes to `main`, it automatically triggers `deploy.yml`, updating the live website with the new data.

## Step 4: Custom Domain (Optional)

To use a custom domain (e.g., `wings.gallery.info`) instead of `github.io`:

1.  **DNS Configuration**:
    *   Go to your DNS provider (e.g., FreeDNS, GoDaddy).
    *   Create a **CNAME** record pointing your subdomain to `<your-username>.github.io`.
    
2.  **GitHub Configuration**:
    *   Go to Repository **Settings** > **Pages**.
    *   Under **Custom domain**, enter your domain (e.g., `wings.gallery.info`).
    *   Click **Save**.
    *   Check the **Enforce HTTPS** box.

3.  **Local File**:
    *   Create a file named `public/CNAME` (no extension) in your code.
    *   Paste your domain name inside it (e.g., `wings.gallery.info`).
    *   Push this file to GitHub. This prevents the domain setting from resetting during deployments.
