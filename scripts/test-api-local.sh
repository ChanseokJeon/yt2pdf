#!/bin/bash

##############################################################################
# v2doc API Local Test Script
#
# 로컬 서버를 구동하고 curl로 샘플 변환 요청을 테스트합니다.
#
# Usage:
#   ./scripts/test-api-local.sh [VIDEO_URL]
#
# Example:
#   ./scripts/test-api-local.sh
#   ./scripts/test-api-local.sh "https://www.youtube.com/watch?v=jNQXAC9IVRw"
##############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PORT=3000
BASE_URL="http://localhost:${PORT}"
TEST_VIDEO_URL="${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}" # "Me at the zoo" (18s)
SERVER_PID=""
OUTPUT_DIR="./output/api-local-test"

# Generate API key
API_KEY="v2d_test_$(openssl rand -hex 16)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}v2doc API Local Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Cleanup function
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo -e "\n${YELLOW}[Cleanup] Stopping server (PID: $SERVER_PID)...${NC}"
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    echo -e "${GREEN}[Cleanup] Server stopped${NC}"
  fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Step 1: Build check
echo -e "${YELLOW}[1/7] Checking build...${NC}"
if [ ! -f "dist/api/server.js" ]; then
  echo -e "${YELLOW}Building project...${NC}"
  npm run build
fi
echo -e "${GREEN}✓ Build OK${NC}"
echo ""

# Step 2: Create output directory
echo -e "${YELLOW}[2/7] Creating output directory...${NC}"
mkdir -p "$OUTPUT_DIR"
echo -e "${GREEN}✓ Output directory: $OUTPUT_DIR${NC}"
echo ""

# Step 3: Start server
echo -e "${YELLOW}[3/7] Starting API server on port $PORT...${NC}"
echo -e "   API Key: ${BLUE}${API_KEY}${NC}"
echo ""

V2DOC_AUTH_MODE=enforce \
V2DOC_API_KEYS="${API_KEY}:test-user:test-key" \
CLOUD_PROVIDER=local \
PORT=$PORT \
NODE_ENV=development \
node dist/api/server.js > "$OUTPUT_DIR/server.log" 2>&1 &

SERVER_PID=$!
echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"

# Step 4: Wait for server to be ready
echo -e "${YELLOW}[4/7] Waiting for server to be ready...${NC}"
MAX_WAIT=30
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -s "$BASE_URL/api/v1/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server ready!${NC}"
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  echo -n "."
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo -e "\n${RED}✗ Server failed to start within ${MAX_WAIT}s${NC}"
  echo -e "${YELLOW}Server log:${NC}"
  cat "$OUTPUT_DIR/server.log"
  exit 1
fi
echo ""

# Step 5: Test health endpoint
echo -e "${YELLOW}[5/7] Testing health endpoint...${NC}"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/api/v1/health")
echo "$HEALTH_RESPONSE" | jq '.' > "$OUTPUT_DIR/health.json" 2>/dev/null || echo "$HEALTH_RESPONSE" > "$OUTPUT_DIR/health.json"
echo -e "${GREEN}✓ Health check passed${NC}"
cat "$OUTPUT_DIR/health.json"
echo ""

# Step 6: Analyze video
echo -e "${YELLOW}[6/7] Analyzing video...${NC}"
echo -e "   URL: ${BLUE}${TEST_VIDEO_URL}${NC}"
echo ""

ANALYZE_START=$(date +%s)
ANALYZE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d "{\"url\": \"${TEST_VIDEO_URL}\"}")

ANALYZE_END=$(date +%s)
ANALYZE_TIME=$((ANALYZE_END - ANALYZE_START))

echo "$ANALYZE_RESPONSE" | jq '.' > "$OUTPUT_DIR/analyze.json" 2>/dev/null || echo "$ANALYZE_RESPONSE" > "$OUTPUT_DIR/analyze.json"

# Check if analyze was successful
if echo "$ANALYZE_RESPONSE" | jq -e '.metadata' > /dev/null 2>&1; then
  VIDEO_TITLE=$(echo "$ANALYZE_RESPONSE" | jq -r '.metadata.title')
  VIDEO_CHANNEL=$(echo "$ANALYZE_RESPONSE" | jq -r '.metadata.channel')
  VIDEO_DURATION=$(echo "$ANALYZE_RESPONSE" | jq -r '.metadata.duration')
  ESTIMATE_TIME=$(echo "$ANALYZE_RESPONSE" | jq -r '.estimate.processingTime')

  echo -e "${GREEN}✓ Analysis completed in ${ANALYZE_TIME}s${NC}"
  echo -e "   Title: ${BLUE}${VIDEO_TITLE}${NC}"
  echo -e "   Channel: ${BLUE}${VIDEO_CHANNEL}${NC}"
  echo -e "   Duration: ${BLUE}${VIDEO_DURATION}s${NC}"
  echo -e "   Estimated processing: ${BLUE}${ESTIMATE_TIME}s${NC}"
else
  echo -e "${RED}✗ Analysis failed${NC}"
  echo "$ANALYZE_RESPONSE"
  exit 1
fi
echo ""

# Step 7: Convert video to PDF (sync)
echo -e "${YELLOW}[7/7] Converting video to PDF (sync mode)...${NC}"
echo -e "   ${YELLOW}This may take 20-60 seconds for a short video...${NC}"
echo ""

CONVERT_START=$(date +%s)
CONVERT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/jobs/sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d "{
    \"url\": \"${TEST_VIDEO_URL}\",
    \"options\": {
      \"format\": \"pdf\",
      \"screenshotInterval\": 30,
      \"layout\": \"horizontal\",
      \"includeTranslation\": false,
      \"includeSummary\": false
    }
  }")

CONVERT_END=$(date +%s)
CONVERT_TIME=$((CONVERT_END - CONVERT_START))

echo "$CONVERT_RESPONSE" | jq '.' > "$OUTPUT_DIR/convert.json" 2>/dev/null || echo "$CONVERT_RESPONSE" > "$OUTPUT_DIR/convert.json"

# Check if conversion was successful
if echo "$CONVERT_RESPONSE" | jq -e '.status' > /dev/null 2>&1; then
  STATUS=$(echo "$CONVERT_RESPONSE" | jq -r '.status')

  if [ "$STATUS" = "completed" ]; then
    JOB_ID=$(echo "$CONVERT_RESPONSE" | jq -r '.jobId')
    DOWNLOAD_URL=$(echo "$CONVERT_RESPONSE" | jq -r '.downloadUrl')
    PAGES=$(echo "$CONVERT_RESPONSE" | jq -r '.stats.pages')
    SCREENSHOTS=$(echo "$CONVERT_RESPONSE" | jq -r '.stats.screenshotCount')
    FILE_SIZE=$(echo "$CONVERT_RESPONSE" | jq -r '.stats.fileSize')
    FILE_SIZE_KB=$((FILE_SIZE / 1024))

    echo -e "${GREEN}✓ Conversion completed in ${CONVERT_TIME}s${NC}"
    echo -e "   Job ID: ${BLUE}${JOB_ID}${NC}"
    echo -e "   Pages: ${BLUE}${PAGES}${NC}"
    echo -e "   Screenshots: ${BLUE}${SCREENSHOTS}${NC}"
    echo -e "   File size: ${BLUE}${FILE_SIZE_KB} KB${NC}"
    echo ""

    # Download the PDF if it's a file:// URL
    if [[ "$DOWNLOAD_URL" == file://* ]]; then
      FILE_PATH="${DOWNLOAD_URL#file://}"
      OUTPUT_PDF="$OUTPUT_DIR/output.pdf"

      if [ -f "$FILE_PATH" ]; then
        cp "$FILE_PATH" "$OUTPUT_PDF"
        echo -e "${GREEN}✓ PDF saved to: ${OUTPUT_PDF}${NC}"

        # Try to open the PDF
        if command -v open &> /dev/null; then
          open "$OUTPUT_PDF"
          echo -e "${GREEN}✓ PDF opened${NC}"
        elif command -v xdg-open &> /dev/null; then
          xdg-open "$OUTPUT_PDF"
          echo -e "${GREEN}✓ PDF opened${NC}"
        fi
      fi
    else
      echo -e "   Download URL: ${BLUE}${DOWNLOAD_URL}${NC}"
    fi
  else
    echo -e "${RED}✗ Conversion failed with status: ${STATUS}${NC}"
    ERROR=$(echo "$CONVERT_RESPONSE" | jq -r '.error // "Unknown error"')
    echo -e "   Error: ${RED}${ERROR}${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ Conversion request failed${NC}"
  echo "$CONVERT_RESPONSE"
  exit 1
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ All tests completed successfully!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Results saved to: ${BLUE}${OUTPUT_DIR}/${NC}"
echo -e "  - server.log"
echo -e "  - health.json"
echo -e "  - analyze.json"
echo -e "  - convert.json"
echo -e "  - output.pdf"
echo ""
echo -e "${YELLOW}Tip: 다른 비디오로 테스트하려면:${NC}"
echo -e "  ./scripts/test-api-local.sh \"https://www.youtube.com/watch?v=YOUR_VIDEO_ID\""
echo ""
