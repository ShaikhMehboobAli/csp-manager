#!/usr/bin/env bash
# ==============================================================================
# CSP Manager API - Production Zero-Downtime Deployment Script
# ==============================================================================
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ==============================================================================

set -eo pipefail

echo "=========================================="
echo "🚀 Starting CSP Manager API Deployment..."
echo "=========================================="

# Locate root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"

echo "📂 Root Directory: $ROOT_DIR"
echo "📂 API Directory:  $API_DIR"

# 1. Fetch latest changes from Git
echo ""
echo "📥 [1/6] Pulling latest changes from Git..."
cd "$ROOT_DIR"
git pull

# 2. Install dependencies
echo ""
echo "📦 [2/6] Installing dependencies in apps/api..."
cd "$API_DIR"
npm install --include=dev

# 3. Generate Prisma client
echo ""
echo "⚙️  [3/6] Generating Prisma Client..."
npx prisma generate

# 4. Run database migrations safely
echo ""
echo "🗄️  [4/6] Applying database migrations..."
npx prisma migrate deploy

# 5. Build TypeScript to JavaScript
echo ""
echo "🔨 [5/6] Building TypeScript code (tsc)..."
npm run build

# 6. Reload or start application with PM2
echo ""
echo "🔄 [6/6] Reloading application with PM2..."
cd "$ROOT_DIR"
if pm2 describe csp-manager-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --env production --update-env
else
  pm2 start ecosystem.config.js --env production --update-env
fi

# Save PM2 process list so it recovers on system reboot
pm2 save

echo ""
echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
pm2 status csp-manager-api
