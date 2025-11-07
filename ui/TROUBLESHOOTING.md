# Troubleshooting Guide - UI Not Working

## Issue: 404 Not Found Error

If you're seeing a 404 error when accessing the UI, follow these steps:

### Step 1: Verify API Server is Running

```bash
# Test API health endpoint
curl http://localhost:3001/api/health

# Expected output:
# {"status":"ok","timestamp":1234567890}
```

If this fails, the API server isn't running. Start it:

```bash
# Make sure you're in the project root
cd /Users/vladimirdemidov/development/delta_neutral_bot

# Start API server
export PATH="$HOME/.bun/bin:$PATH"
bun run src/api/hono-server.ts
```

### Step 2: Verify UI Server is Running

```bash
# In a new terminal
cd /Users/vladimirdemidov/development/delta_neutral_bot/ui
export PATH="$HOME/.bun/bin:$PATH"
bun run server.ts
```

You should see:
```
✅ Build successful
🎨 UI Server running on http://localhost:3000
```

### Step 3: Check if Files Exist

```bash
# Check UI components
ls -la ui/src/components/

# Check API server
ls -la src/api/hono-server.ts

# Check if .env exists
ls -la .env
```

### Step 4: Test Individual Components

**Test 1: Can Bun run?**
```bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
# Should output: 1.3.1 or similar
```

**Test 2: Can the UI build?**
```bash
cd ui
bun build src/index.tsx --outdir dist
# Should create dist/index.js
ls -la dist/
```

**Test 3: Can the API start?**
```bash
cd /Users/vladimirdemidov/development/delta_neutral_bot
bun run src/api/hono-server.ts
# Should output: 🚀 Bun + Hono API server starting on port 3001
```

### Step 5: Common Issues

**Issue**: `command not found: bun`

**Solution**:
```bash
# Add Bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Add to shell profile permanently
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Issue**: `Module not found: react`

**Solution**:
```bash
cd ui
bun install
```

**Issue**: `.env not found`

**Solution**:
```bash
# Create .env in project root
cat > .env << 'EOF'
RPC_URL=https://api.mainnet-beta.solana.com
PRIVATE_KEY=your_private_key_here
METEORA_POOL_ADDRESS=Agxw5VTjEaUt4NcK9r6cA5HuVVcpJFcbw6LZG5tbxvcT
AUTO_CREATE_POSITIONS=true
INITIAL_DEPOSIT_SOL=0.1
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100
EOF
```

**Issue**: `Failed to fetch data from API`

**Solution**:
1. Check API is running on port 3001
2. Check no firewall blocking localhost
3. Check browser console for CORS errors
4. Verify `ui/src/config.ts` has correct API URL:
```typescript
export const API_BASE_URL = 'http://localhost:3001';
```

### Step 6: Start from Scratch

If nothing works, try a clean restart:

```bash
# 1. Stop all servers (Ctrl+C in terminals)

# 2. Clean build artifacts
cd /Users/vladimirdemidov/development/delta_neutral_bot
rm -rf ui/dist ui/node_modules node_modules

# 3. Reinstall dependencies
npm install
cd ui && bun install && cd ..

# 4. Start API server
export PATH="$HOME/.bun/bin:$PATH"
bun run src/api/hono-server.ts &

# 5. Wait 2 seconds for API to start
sleep 2

# 6. Start UI server
cd ui
bun run server.ts &

# 7. Open browser
open http://localhost:3000
```

### Step 7: Manual Testing

If UI still doesn't work, test the API manually:

```bash
# Test prices endpoint
curl http://localhost:3001/api/prices | jq

# Test pool analytics
curl http://localhost:3001/api/pool/analytics | jq

# Test positions
curl http://localhost:3001/api/positions | jq
```

If these work, the API is fine and the issue is with the UI build/serve.

### Step 8: Alternative - Use npm run dev

Instead of running servers manually:

```bash
cd /Users/vladimirdemidov/development/delta_neutral_bot
npm run dev
```

This uses `concurrently` to run both servers. Check output for errors.

### Step 9: Check Browser Console

Open browser DevTools (F12) and check:

1. **Console tab**: Look for JavaScript errors
2. **Network tab**: Check if requests to localhost:3001 are successful
3. **Elements tab**: Check if `<div id="root"></div>` is empty or has content

### Step 10: Get Help

If still stuck, provide these details:

```bash
# System info
uname -a
node --version
bun --version

# Check what's running on ports
lsof -i :3000
lsof -i :3001

# Check UI files
ls -la ui/src/
ls -la ui/dist/

# Check API
ls -la src/api/

# Check .env
cat .env | head -5  # Don't share PRIVATE_KEY!
```

## Quick Fixes

### Fix 1: Restart Everything

```bash
# Kill any running servers
pkill -f "bun run"

# Restart
npm run dev
```

### Fix 2: Clear Browser Cache

- Chrome/Edge: Ctrl+Shift+Delete → Clear cache
- Firefox: Ctrl+Shift+Delete → Cached Web Content
- Safari: Cmd+Option+E

### Fix 3: Try Different Browser

Sometimes browser extensions block localhost. Try:
- Chrome Incognito mode
- Firefox Private mode
- Different browser entirely

### Fix 4: Check Firewall

```bash
# macOS: Allow localhost traffic
sudo pfctl -d  # Disable firewall temporarily

# If that fixes it, add firewall rules for ports 3000 and 3001
```

## Still Not Working?

Create a minimal test:

```bash
# Test 1: Can Bun serve static HTML?
cd ui
echo '<h1>Test</h1>' > test.html
bun run -e 'Bun.serve({port:3000,fetch:(req)=>new Response(Bun.file("test.html"))})'
# Open http://localhost:3000 - should see "Test"

# Test 2: Can API respond?
cd ..
bun run -e 'import {Hono} from "hono"; const app = new Hono(); app.get("/test", c=>c.json({ok:true})); export default {port:3001,fetch:app.fetch};'
# curl http://localhost:3001/test - should see {"ok":true}
```

If these simple tests work, the issue is with the React build/config.

## Contact

If you're completely stuck, check:
1. UI_QUICKSTART.md for setup instructions
2. UI_README.md for detailed documentation
3. GitHub Issues for similar problems
