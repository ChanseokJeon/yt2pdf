# yt2pdf - Cloud Run Dockerfile (Optimized)
# Multi-stage build with Alpine for minimal image size
# Target: ~500MB (down from ~1GB)

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY package.api.json ./

# Install all dependencies for build
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ============================================
# Stage 2: Production dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

# Use API-only package.json for minimal dependencies
COPY package.api.json ./package.json

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# ============================================
# Stage 3: Runtime
# ============================================
FROM node:20-alpine AS runtime

# Install system dependencies (minimal)
RUN apk add --no-cache \
    # FFmpeg for screenshot capture
    ffmpeg \
    # Korean font (Baekmuk ~11MB, smaller than Noto-CJK)
    font-baekmuk \
    # Python for yt-dlp
    python3 \
    py3-pip \
    # Fontconfig for font discovery
    fontconfig && \
    # Install yt-dlp
    pip3 install --break-system-packages --no-cache-dir yt-dlp && \
    # Refresh font cache
    fc-cache -f

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy config files needed at runtime
COPY yt2pdf.config.yaml ./

# Create temp directory
RUN mkdir -p /tmp/yt2pdf

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Run API server
CMD ["node", "dist/api/server.js"]
