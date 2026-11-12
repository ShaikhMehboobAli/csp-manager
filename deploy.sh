#!/usr/bin/env bash
# ==============================================================================
# CSP Manager - Production Deployment Script
# ==============================================================================
# Usage from project root:
#   chmod +x deploy.sh
#   ./deploy.sh
# ==============================================================================

set -eo pipefail

echo "=========================================="
echo "🚀 Deploying CSP Manager..."
echo "=========================================="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"

# 1. Pull latest code from Git
echo ""
echo "📥 [1/4] Pulling latest code..."
cd "$ROOT_DIR"
git pull

# 2. Deploy Backend (apps/api)
echo ""
echo "⚙️  [2/4] Deploying API (apps/api)..."
cd "$API_DIR"

echo "📦 Installing packages..."
npm install --include=dev

echo "🔧 Generating Prisma Client..."
npx prisma generate

echo "🗄️  Applying database migrations (no seeds)..."
npx prisma migrate deploy

echo "🔨 Building TypeScript API..."
npm run build

echo "🔄 Starting / Reloading PM2 process..."
if pm2 describe csp-manager-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --env production --update-env
else
  pm2 start ecosystem.config.js --env production --update-env
fi

# 3. Deploy Frontend (apps/web) - Skipped until added
echo ""
echo "🌐 [3/4] Checking Frontend (apps/web)..."
if [ -d "$WEB_DIR" ] && [ -f "$WEB_DIR/package.json" ]; then
  echo "Found apps/web. Deploying frontend..."
  cd "$WEB_DIR"
  npm install
  npm run build
  if [ -f "$WEB_DIR/ecosystem.config.js" ]; then
    if pm2 describe csp-manager-web > /dev/null 2>&1; then
      pm2 reload ecosystem.config.js --env production --update-env
    else
      pm2 start ecosystem.config.js --env production --update-env
    fi
  fi
else
  echo "⏭️  Skipping apps/web (frontend will be added later)."
fi

# 4. Save PM2 state
echo ""
echo "💾 [4/4] Saving PM2 state..."
pm2 save

echo ""
echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
pm2 status csp-manager-api
