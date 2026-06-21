#!/usr/bin/env bash
#
# ─────────────────────────────────────────────────────────────────────────────
#  Kestrel AI Gateway — Development Environment Setup Script
# ─────────────────────────────────────────────────────────────────────────────
#
#  Quick setup for developers cloning the repo for the first time.
#
#  USAGE:  ./scripts/dev-setup.sh
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo "╔══════════════════════════════════════════════════╗"
echo "║  Kestrel AI Gateway — Dev Setup                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Node.js ─────────────────────────────────────────────────────────────────
NODE_MIN=18
NODE_VER=$(node -v 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")

if [ "$NODE_VER" -lt "$NODE_MIN" ]; then
  echo "❌ Node.js >= v$NODE_MIN required (found v$NODE_VER)."
  echo "   Install:  https://nodejs.org/"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ── Install deps ────────────────────────────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"

# ── .env file ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo "🔐 Creating .env from .env.example..."
  cp .env.example .env
  
  # Auto-generate a random proxy key
  if command -v openssl &>/dev/null; then
    KEY=$(openssl rand -hex 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/sk-your-secret-key-here/$KEY/" .env
    else
      sed -i "s/sk-your-secret-key-here/$KEY/" .env
    fi
    echo "✅ .env created with auto-generated PROXY_API_KEY"
    echo "   Key: $KEY"
  else
    echo "✅ .env created (edit $ to set your PROXY_API_KEY)"
  fi
  
  echo ""
  echo "⚠️  Add your provider API keys to .env:"
  echo "   KIMI_API_KEY=sk-..."
  echo "   DEEPSEEK_API_KEY=sk-..."
  echo "   GLM_API_KEY=..."
  echo "   XIAOMI_API_KEY=..."
else
  echo "ℹ️  .env already exists, skipping"
fi

# ── Build ───────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building project..."
npm run build
echo "✅ Build successful"

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "✨ Dev setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env — add your provider API keys"
echo "  2. Start dev mode:    npm run dev"
echo "  3. Or production:      npm start"
echo "  4. Health check:       curl http://localhost:3456/v1/models"
echo ""
echo "Docs: README.md | SETUP.md | CONTRIBUTING.md"
echo "═══════════════════════════════════════════════════"
