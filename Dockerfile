# yt2pdf - Cloud Run Dockerfile
# Minimal MVP for ~100 PDFs/month
# Uses pdfkit (no Chromium needed for basic PDF generation)

FROM node:20-slim

# Install system dependencies (minimal set)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # FFmpeg for screenshot capture
    ffmpeg \
    # Fonts for PDF (Korean support - base package only)
    fonts-noto-cjk \
    # Python for yt-dlp
    python3 \
    python3-pip \
    # CA certificates for HTTPS
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install yt-dlp
RUN pip3 install --break-system-packages --no-cache-dir yt-dlp

# Create app directory
WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install dependencies
# Note: --omit=dev replaces deprecated --only=production
RUN npm ci --omit=dev

# Copy built application
COPY dist/ ./dist/

# Create temp directory for processing
RUN mkdir -p /tmp/yt2pdf

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Note: Docker HEALTHCHECK is ignored by Cloud Run
# Cloud Run uses HTTP probes configured via gcloud flags

# Run API server
CMD ["node", "dist/api/server.js"]
