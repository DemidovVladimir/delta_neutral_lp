#!/bin/bash

# Meteora LP UI Startup Script
# Starts both API and UI servers

set -e

echo "🚀 Starting Meteora LP UI..."
echo ""

# Check if Bun is installed
if ! command -v bun &> /dev/null && [ ! -f "$HOME/.bun/bin/bun" ]; then
    echo "❌ Bun is not installed!"
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Add Bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

echo "✅ Bun found: $(bun --version)"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Please create .env with required configuration."
    echo "See UI_QUICKSTART.md for details."
    exit 1
fi

echo "✅ Configuration found"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing project dependencies..."
    npm install
fi

if [ ! -d "ui/node_modules" ]; then
    echo "📦 Installing UI dependencies..."
    cd ui && bun install && cd ..
fi

echo "✅ Dependencies ready"
echo ""

# Start API server in background
echo "🔧 Starting API server (port 3001)..."
bun run src/api/hono-server.ts &
API_PID=$!

# Wait for API to start
sleep 2

# Check if API is running
if ! curl -s http://localhost:3001/api/health > /dev/null; then
    echo "❌ API server failed to start!"
    echo "Check logs above for errors"
    kill $API_PID 2>/dev/null || true
    exit 1
fi

echo "✅ API server running at http://localhost:3001"
echo ""

# Start UI server
echo "🎨 Starting UI server (port 3000)..."
cd ui
bun run server.ts &
UI_PID=$!
cd ..

# Wait for UI to start
sleep 3

# Check if UI is running
if ! curl -s http://localhost:3000/ > /dev/null; then
    echo "❌ UI server failed to start!"
    echo "Check logs above for errors"
    kill $API_PID 2>/dev/null || true
    kill $UI_PID 2>/dev/null || true
    exit 1
fi

echo "✅ UI server running at http://localhost:3000"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Meteora LP UI is ready!"
echo ""
echo "📍 UI:  http://localhost:3000"
echo "📍 API: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Open browser (optional)
if command -v open &> /dev/null; then
    echo "🌐 Opening browser..."
    open http://localhost:3000
fi

# Wait for Ctrl+C
trap "echo ''; echo '🛑 Shutting down...'; kill $API_PID $UI_PID 2>/dev/null; exit 0" INT

# Keep script running
wait
