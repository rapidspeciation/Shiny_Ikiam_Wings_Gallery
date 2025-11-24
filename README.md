# Static Ikiam Wings Gallery

A static Vue.js application to view butterfly wing photos of specimens from the ongoing project at Ikiam - Ecuador.

## 🔗 [Live Application](https://rapidspeciation.github.io/Shiny_Ikiam_Wings_Gallery/)

## Overview

This project is a modern, static reimplementation of the original R-Shiny application. It was migrated to **Vue 3 + Vite** to improve performance, host it for free on GitHub Pages, and ensure high availability.

- **Previous Architecture:** R-Shiny running on AWS EC2 (Dockerized).
- **Current Architecture:** Static Single Page Application (SPA) hosted on GitHub Pages. Data is pre-processed via Python and GitHub Actions.

## Features

### 🦋 Gallery Views
- **Collection Tab**: Filter individuals based on Taxonomy (Family, Subfamily, Tribe, Species, Subspecies) and Sex.
- **Insectary Tab**: View specimens from the insectary, filtered by Insectary ID and biological data.
- **CRISPR Tab**: Specialized view for CRISPR-injected individuals, filtering by mutants.
- **Search**: Fast lookup by CAMID (e.g., `CAM012345`).

### ⚡ Performance & UX
- **Image Proxying**: Uses `wsrv.nl` to cache and optimize images from Google Drive, preventing HTTP 429 (Rate Limit) errors and speeding up load times.
- **Zoom & Pan**:
  - **Desktop**: Shift + Scroll to zoom all, Ctrl + Scroll to zoom one.
  - **Mobile**: Native-feel gestures. One finger scrolls the page; pinch-to-zoom enables panning the image.
- **Responsive Grid**: Automatically adjusts columns based on screen width and zoom level.

### 📂 Google Drive Data Source
The application's data is sourced from Google Sheets, which are populated by the custom Google Apps Script included in this repository: [`list_google_drive_files.gs`](./list_google_drive_files.gs).

This script recursively lists files from specified Google Drive folders into a `Photo_links` sheet and includes features like **Dead Link Cleaning** and **Batch Processing** to handle thousands of images.

**To set this up in your Google Sheet:**
1.  Open your Google Sheet and navigate to `Extensions > Apps Script`.
2.  Create a file named `list_google_drive_files.gs` and paste the content from the file in this repo.
3.  **Install LongRun Library**: Create another script file named `LongRun.gs` and paste the content from [this library](https://github.com/inclu-cat/LongRun/blob/main/generated-gs/LongRun.gs). This is required to bypass Google's 6-minute execution limit.
4.  **Enable Drive API**: In the Apps Script editor, click `Services +` (left menu), select **Drive API**, and click Add.
5.  **Configure Folders**: Update the `FOLDER_MAPPING` constant in `list_google_drive_files.gs` with your specific Google Drive Folder IDs.
6.  **Run**: Refresh your Google Sheet. A new menu `Photo Database Tools` will appear to run the sync.

### 🔄 Secure Database Updates
The application allows users to trigger a database update directly from the UI without exposing API keys.
1. **User Authentication**: Users enter a password in the "Update DB" tab.
2. **Secure Proxy**: The app sends the request to a **Cloudflare Worker** (serverless function).
3. **Trigger**: The Worker verifies the password and uses a hidden token to trigger a **GitHub Action** (`update_data.yml`).
4. **Processing**: A Python script downloads data from Google Sheets, processes dates/links, and generates optimized JSON files.
5. **Deployment**: The new data is committed to the repository, automatically triggering a rebuild and deployment of the website.

## Tech Stack

- **Framework**: Vue 3 (Composition API)
- **Build Tool**: Vite
- **Styling**: Bootstrap 5 + Custom CSS
- **Data Processing**: Python (Pandas)
- **Hosting**: GitHub Pages
- **Image Caching**: wsrv.nl

## Local Development

To run this application locally:

1. **Clone the Repository**
   ```bash
   git clone https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery.git
   cd Shiny_Ikiam_Wings_Gallery
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```
   Open the link shown in the terminal (usually `http://localhost:5173`).

4. **Update Data Locally (Optional)**
   If you need to fetch fresh data from Google Sheets:
   ```bash
   pip install pandas requests
   python scripts/process_data.py
   ```

## Deployment

This application is configured for **Continuous Deployment** using GitHub Actions.
For detailed configuration and setup instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Credits

- **Idea & Development**: Franz Chandi
- **AI Assistance (Original App)**: ChatGPT (OpenAI) - Assisted in the development of the initial R-Shiny codebase.
- **AI Assistance (Migration)**: Gemini 3 Pro (Google) - Assisted in the complete architecture migration from R-Shiny to the modern static web stack.
