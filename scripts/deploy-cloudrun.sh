#!/bin/bash
# yt2pdf Cloud Run Deployment Script
# Usage: ./scripts/deploy-cloudrun.sh [project-id] [region]

set -e

# Configuration
PROJECT_ID="${1:-$(gcloud config get-value project)}"
REGION="${2:-asia-northeast3}"
SERVICE_NAME="yt2pdf"
BUCKET_NAME="yt2pdf-output-${PROJECT_ID}"

echo "=== yt2pdf Cloud Run Deployment ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Bucket: $BUCKET_NAME"
echo ""

# Check prerequisites
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not installed"
    exit 1
fi

# Build TypeScript
echo "=== Building TypeScript ==="
npm run build

# Create GCS bucket if not exists
echo "=== Setting up GCS bucket ==="
if ! gsutil ls -b "gs://${BUCKET_NAME}" &> /dev/null; then
    echo "Creating bucket: ${BUCKET_NAME}"
    gsutil mb -l "$REGION" "gs://${BUCKET_NAME}"
    gsutil lifecycle set gcs-lifecycle.json "gs://${BUCKET_NAME}"
else
    echo "Bucket already exists: ${BUCKET_NAME}"
fi

# Deploy to Cloud Run
# Settings based on critic review:
# - 4Gi memory: prevents OOM during PDF generation
# - 2 CPU: FFmpeg is CPU-intensive
# - cpu-boost: faster cold starts
# - gen2: better performance
echo "=== Deploying to Cloud Run ==="
gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --memory 4Gi \
    --cpu 2 \
    --timeout 900 \
    --concurrency 1 \
    --min-instances 0 \
    --max-instances 1 \
    --cpu-boost \
    --execution-environment gen2 \
    --set-env-vars "NODE_ENV=production,GCS_BUCKET_NAME=${BUCKET_NAME},CLOUD_PROVIDER=gcp" \
    --allow-unauthenticated

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format "value(status.url)")

echo ""
echo "=== Deployment Complete ==="
echo "Service URL: $SERVICE_URL"
echo ""
echo "Test commands:"
echo "  # Health check"
echo "  curl ${SERVICE_URL}/api/v1/health"
echo ""
echo "  # Convert video (sync mode)"
echo "  curl -X POST ${SERVICE_URL}/api/v1/jobs/sync \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"url\": \"https://youtube.com/watch?v=VIDEO_ID\"}'"
echo ""
echo "Note: First request may take 30-60s due to cold start."
echo "For faster response, set --min-instances 1 (costs ~\$25-50/month)"
