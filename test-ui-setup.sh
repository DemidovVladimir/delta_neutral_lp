#!/bin/bash

# Test UI Setup Script
# Verifies all components are ready

echo "🧪 Testing Meteora LP UI Setup..."
echo ""

# Add Bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Test 1: Bun installation
echo "Test 1: Bun installation"
if command -v bun &> /dev/null || [ -f "$HOME/.bun/bin/bun" ]; then
    echo "  ✅ Bun found: $(bun --version 2>/dev/null || echo 'installed')"
else
    echo "  ❌ Bun not found"
    echo "     Run: curl -fsSL https://bun.sh/install | bash"
fi
echo ""

# Test 2: Environment configuration
echo "Test 2: Environment configuration"
if [ -f .env ]; then
    echo "  ✅ .env file exists"
    if grep -q "RPC_URL" .env && grep -q "PRIVATE_KEY" .env; then
        echo "  ✅ Required variables found"
    else
        echo "  ⚠️  Some required variables may be missing"
    fi
else
    echo "  ❌ .env file not found"
    echo "     See UI_FIXED_SETUP.md for configuration"
fi
echo ""

# Test 3: Dependencies
echo "Test 3: Dependencies"
if [ -d node_modules ]; then
    echo "  ✅ Project dependencies installed"
else
    echo "  ❌ Project dependencies missing"
    echo "     Run: npm install"
fi

if [ -d ui/node_modules ]; then
    echo "  ✅ UI dependencies installed"
else
    echo "  ❌ UI dependencies missing"
    echo "     Run: cd ui && bun install"
fi
echo ""

# Test 4: File structure
echo "Test 4: File structure"
REQUIRED_FILES=(
    "src/api/hono-server.ts"
    "ui/server.ts"
    "ui/src/App.tsx"
    "ui/src/index.tsx"
    "ui/src/config.ts"
    "ui/public/index.html"
)

ALL_PRESENT=true
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ $file missing"
        ALL_PRESENT=false
    fi
done
echo ""

# Test 5: Can build UI?
echo "Test 5: Can build UI?"
cd ui
if bun build src/index.tsx --outdir dist 2>/dev/null; then
    echo "  ✅ UI builds successfully"
    if [ -f dist/index.js ]; then
        SIZE=$(ls -lh dist/index.js | awk '{print $5}')
        echo "  ✅ Bundle created: $SIZE"
    fi
else
    echo "  ❌ UI build failed"
fi
cd ..
echo ""

# Test 6: Can API start? (quick test)
echo "Test 6: Can API start? (quick test)"
timeout 3 bun run src/api/hono-server.ts &>/dev/null &
API_PID=$!
sleep 2

if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "  ✅ API server can start"
    kill $API_PID 2>/dev/null
    wait $API_PID 2>/dev/null
else
    echo "  ⚠️  Could not verify API (may need manual test)"
    kill $API_PID 2>/dev/null || true
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary:"
echo ""

if [ ! -f .env ]; then
    echo "⚠️  Missing configuration: Create .env file"
    echo "   See: UI_FIXED_SETUP.md"
elif [ ! -d node_modules ] || [ ! -d ui/node_modules ]; then
    echo "⚠️  Missing dependencies:"
    [ ! -d node_modules ] && echo "   Run: npm install"
    [ ! -d ui/node_modules ] && echo "   Run: cd ui && bun install"
elif ! command -v bun &> /dev/null && [ ! -f "$HOME/.bun/bin/bun" ]; then
    echo "⚠️  Bun not installed"
    echo "   Run: curl -fsSL https://bun.sh/install | bash"
else
    echo "✅ Setup looks good!"
    echo ""
    echo "Ready to start? Run:"
    echo "  ./start-ui.sh"
    echo ""
    echo "Or manually:"
    echo "  Terminal 1: bun run src/api/hono-server.ts"
    echo "  Terminal 2: cd ui && bun run server.ts"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
