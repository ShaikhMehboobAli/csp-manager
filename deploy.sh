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

# 1. Load NVM and use Node version from .nvmrc if available
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  \. "$NVM_DIR/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  \. "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  \. "/usr/local/opt/nvm/nvm.sh"
fi

if command -v nvm > /dev/null 2>&1; then
  if [ -f "$ROOT_DIR/.nvmrc" ]; then
    echo "🟢 Loading Node version from .nvmrc..."
    cd "$ROOT_DIR"
    nvm use || nvm install
  fi
fi

echo "📌 Using Node: $(node -v) | npm: $(npm -v)"

# 2. Pull latest code from Git
echo ""
echo "📥 [1/4] Pulling latest code..."
cd "$ROOT_DIR"
git pull

# 3. Validate environment configuration for API
if [ ! -f "$API_DIR/.env" ] && [ -f "$ROOT_DIR/.env" ]; then
  echo "📋 Found .env at root, copying to apps/api/.env..."
  cp "$ROOT_DIR/.env" "$API_DIR/.env"
fi

if [ ! -f "$API_DIR/.env" ]; then
  echo ""
  echo "❌ Error: apps/api/.env not found!"
  echo "👉 Please copy the example environment file and configure your database before deploying:"
  echo "   cp apps/api/.env.example apps/api/.env"
  echo "   nano apps/api/.env"
  echo ""
  exit 1
fi

# Ensure DATABASE_URL is set in apps/api/.env or current environment
if ! grep -q "^DATABASE_URL=" "$API_DIR/.env" 2>/dev/null && [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "❌ Error: DATABASE_URL is missing in apps/api/.env!"
  echo "👉 Please edit apps/api/.env and provide your PostgreSQL connection string:"
  echo "   DATABASE_URL=\"postgresql://user:password@host:5432/dbname?schema=public&sslmode=require\""
  echo ""
  exit 1
fi

# 4. Deploy Backend (apps/api)
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

# 5. Deploy Frontend (apps/web) - Skipped until added
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

# 6. Save PM2 state
echo ""
echo "💾 [4/4] Saving PM2 state..."
pm2 save

echo ""
echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
pm2 status csp-manager-api
