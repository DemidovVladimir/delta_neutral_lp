#!/bin/bash

echo "🔍 Diagnosing API Server Issues..."
echo ""

# Add Bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

echo "=== Step 1: Check if Bun is available ==="
if command -v bun &> /dev/null; then
    echo "✅ Bun found: $(bun --version)"
else
    echo "❌ Bun not found in PATH"
    echo "   PATH: $PATH"
fi
echo ""

echo "=== Step 2: Check .env file ==="
if [ -f .env ]; then
    echo "✅ .env exists"
    echo "   RPC_URL: $(grep RPC_URL .env | cut -d'=' -f1)"
    echo "   METEORA_POOL_ADDRESS: $(grep METEORA_POOL_ADDRESS .env | wc -c) chars"
    echo "   AUTO_CREATE_POSITIONS: $(grep AUTO_CREATE_POSITIONS .env | cut -d'=' -f2)"
else
    echo "❌ .env not found"
fi
echo ""

echo "=== Step 3: Check if hono-server.ts exists ==="
if [ -f src/api/hono-server.ts ]; then
    echo "✅ src/api/hono-server.ts exists"
else
    echo "❌ src/api/hono-server.ts not found"
fi
echo ""

echo "=== Step 4: Check for running processes ==="
PROCESSES=$(ps aux | grep -E "bun.*hono-server" | grep -v grep | wc -l)
if [ "$PROCESSES" -gt 0 ]; then
    echo "✅ Found $PROCESSES Bun process(es)"
    ps aux | grep -E "bun.*hono-server" | grep -v grep
else
    echo "⚠️  No Bun API server process found"
fi
echo ""

echo "=== Step 5: Check port 3001 ==="
if command -v lsof &> /dev/null; then
    PORT_CHECK=$(lsof -i :3001 2>/dev/null | wc -l)
    if [ "$PORT_CHECK" -gt 1 ]; then
        echo "✅ Something is listening on port 3001"
        lsof -i :3001 2>/dev/null
    else
        echo "❌ Nothing listening on port 3001"
    fi
else
    echo "⚠️  lsof not available, skipping port check"
fi
echo ""

echo "=== Step 6: Test API connection ==="
if curl -s http://localhost:3001/api/health > /tmp/api-health.json 2>&1; then
    if [ -s /tmp/api-health.json ]; then
        echo "✅ API responded:"
        cat /tmp/api-health.json
        echo ""
    else
        echo "❌ API responded but empty"
    fi
else
    echo "❌ Cannot connect to API on port 3001"
    echo "   Response: $(cat /tmp/api-health.json 2>/dev/null || echo 'No response')"
fi
echo ""

echo "=== Step 7: Try starting API manually ==="
echo "Attempting to start API server for 3 seconds..."
echo ""

# Try to start the API and capture any immediate errors
bun run src/api/hono-server.ts > /tmp/api-startup.log 2>&1 &
API_PID=$!
echo "Started API with PID: $API_PID"
echo "Waiting 3 seconds..."
sleep 3

# Check if it's still running
if kill -0 $API_PID 2>/dev/null; then
    echo "✅ API server started successfully!"
    echo ""
    echo "Testing endpoints:"

    # Test health
    echo -n "  /api/health: "
    if curl -s http://localhost:3001/api/health | head -c 50; then
        echo " ✅"
    else
        echo " ❌"
    fi

    # Test prices
    echo -n "  /api/prices: "
    if curl -s http://localhost:3001/api/prices > /tmp/prices.json 2>&1; then
        if grep -q "sol" /tmp/prices.json 2>/dev/null; then
            echo "✅"
        else
            echo "❌ Error: $(cat /tmp/prices.json | head -c 100)"
        fi
    else
        echo "❌"
    fi

    # Test positions
    echo -n "  /api/positions: "
    if curl -s http://localhost:3001/api/positions > /tmp/positions.json 2>&1; then
        if grep -q "exposure" /tmp/positions.json 2>/dev/null; then
            echo "✅"
        else
            echo "❌ Error: $(cat /tmp/positions.json | head -c 100)"
        fi
    else
        echo "❌"
    fi

    echo ""
    echo "Stopping test server..."
    kill $API_PID 2>/dev/null
    wait $API_PID 2>/dev/null
else
    echo "❌ API server crashed immediately!"
    echo ""
    echo "Startup logs:"
    cat /tmp/api-startup.log
fi
echo ""

echo "=== Summary ==="
echo ""
echo "To start the API server manually:"
echo "  export PATH=\"\$HOME/.bun/bin:\$PATH\""
echo "  bun run src/api/hono-server.ts"
echo ""
echo "To view detailed logs, check /tmp/api-startup.log"
echo ""
echo "If the API crashes immediately, the error will be in the startup logs above."
