#!/bin/bash

# Set variables
PROJECT_ID="your-project-id"  # Replace with your Google Cloud project ID
REGION="us-central1"          # Replace with your preferred region
SERVICE_NAME="ikiam-wings-gallery"

# Build the container
echo "Building Docker container..."
docker build -t gcr.io/${PROJECT_ID}/${SERVICE_NAME} .

# Push to Google Container Registry
echo "Pushing to Google Container Registry..."
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10

echo "Deployment complete!" 