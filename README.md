# Static Ikiam Wings Gallery

A static Vue.js application to view butterfly wing photos of specimens from the ongoing project at Ikiam - Ecuador.

## 🔗 [Live Application](https://fr4nzz.github.io/Static_hiny_Ikiam_Wings_Gallery/)
*(Note: Update this link to your final URL)*

## Overview

This project is a modern, static reimplementation of the original R-Shiny application. It was migrated to **Vue 3 + Vite** to improve performance, reduce hosting costs, and ensure high availability.

- **Previous Architecture:** R-Shiny running on AWS EC2 (Dockerized).
- **Current Architecture:** Static Single Page Application (SPA) hosted on GitHub Pages. Data is pre-processed via Python and GitHub Actions.

## Features

### 🦋 Gallery Views
- **Collection Tab**: Filter individuals based on Taxonomy (Family, Subfamily, Tribe, Species, Subspecies) and Sex.
- **Insectary Tab**: View specimens from the insectary, filtered by Insectary ID and biological data.
- **CRISPR Tab**: Specialized view for CRISPR-injected individuals, filtering by mutants.
- **Search**: fast lookup by CAMID (e.g., `CAM12345`).

### ⚡ Performance & UX
- **Image Proxying**: Uses `wsrv.nl` to cache and optimize images from Google Drive, preventing HTTP 429 (Rate Limit) errors and speeding up load times.
- **Zoom & Pan**:
  - **Desktop**: Shift + Scroll to zoom all, Ctrl + Scroll to zoom one.
  - **Mobile**: Native-feel gestures. One finger scrolls the page; pinch-to-zoom enables panning the image.
- **Responsive Grid**: Automatically adjusts columns based on screen width and zoom level.

### 🔄 Data Pipeline
The application allows users to trigger a database update directly from the UI.
1. User clicks "Update Database" (protected by password).
2. The app triggers a **GitHub Action** (`update_data.yml`).
3. A Python script downloads data from Google Sheets, processes dates/links, and generates optimized JSON files.
4. The Action commits the new JSON files to the repository.
5. A second Action (`deploy.yml`) automatically rebuilds and deploys the website.

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
   git clone https://github.com/fr4nzz/Static_hiny_Ikiam_Wings_Gallery
   cd Static_hiny_Ikiam_Wings_Gallery
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

- **Original App**: [rapidspeciation/Shiny_Ikiam_Wings_Gallery](https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery)
- **Google Drive Script**: Utilizes `list_google_drive_files.gs` to map Drive photos to sheets.
