#!/bin/bash
# Build channels-ui and deploy to sena_agents_backend/public/channels/
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../sena_agents_backend/sena_agents_backend/public/channels"

cd "$SCRIPT_DIR"

echo "Installing dependencies..."
npm install --silent

echo "Building channels-ui..."
npm run build

echo ""
echo "Build complete. Assets deployed to:"
echo "  $TARGET_DIR"
echo ""
ls -lh "$TARGET_DIR/"
echo ""
echo "Route: /assets/sena_agents_backend/channels/index.html"
