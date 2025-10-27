#!/bin/bash

# Start Solana Test Validator with Mainnet Fork
# This clones a real Meteora DLMM pool from mainnet to localnet for realistic testing

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "================================================================="
echo "Starting Localnet with Mainnet Fork"
echo "================================================================="
echo ""

# Known mainnet addresses to clone
METEORA_PROGRAM="LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
SOL_USDC_POOL="5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"  # Popular SOL/USDC DLMM pool
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
SOL_MINT="So11111111111111111111111111111111111111112"
RESERVE_X="EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o"  # SOL reserve
RESERVE_Y="CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz"  # USDC reserve
ORACLE="59YuGWPunbchD2mbi9U7qvjWQKQReGeepn4ZSr9zz9Li"     # Pool oracle
USDC_WHALE="GJcYN2khvAaq8KM2TqAw3HZcdQwvChmvPcUh8SUpump7"  # Large USDC holder (~3B USDC)

echo -e "${BLUE}Configuration:${NC}"
echo "  Meteora DLMM Program: $METEORA_PROGRAM"
echo "  SOL/USDC Pool: $SOL_USDC_POOL"
echo "  USDC Mint: $USDC_MINT"
echo "  SOL Mint: $SOL_MINT"
echo "  Reserve X (SOL): $RESERVE_X"
echo "  Reserve Y (USDC): $RESERVE_Y"
echo "  Oracle: $ORACLE"
echo "  USDC Whale Account: $USDC_WHALE"
echo ""

# Check if validator is already running
if pgrep -x "solana-test-validator" > /dev/null; then
  echo -e "${YELLOW}⚠️  Solana test validator is already running${NC}"
  echo "Do you want to stop it and restart? (y/n)"
  read -r response
  if [ "$response" = "y" ]; then
    echo "Stopping existing validator..."
    pkill solana-test-validator || true
    sleep 2
  else
    echo "Exiting..."
    exit 0
  fi
fi

# Clean up ledger (optional - comment out to preserve state)
echo -e "${BLUE}Cleaning up old ledger...${NC}"
rm -rf test-ledger

echo -e "${GREEN}Starting validator with mainnet clones...${NC}"
echo ""

# Start validator with clones
solana-test-validator \
  --clone-upgradeable-program $METEORA_PROGRAM \
  --clone $SOL_USDC_POOL \
  --clone $USDC_MINT \
  --clone $RESERVE_X \
  --clone $RESERVE_Y \
  --clone $ORACLE \
  --clone $USDC_WHALE \
  --url https://api.mainnet-beta.solana.com \
  --reset \
  --quiet &

# Wait for validator to start
echo -e "${YELLOW}Waiting for validator to start...${NC}"
sleep 5

# Check if validator is running
if ! pgrep -x "solana-test-validator" > /dev/null; then
  echo -e "${RED}❌ Failed to start validator${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}✅ Validator started successfully!${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo ""
echo "Configuration for .env.local:"
echo "  RPC_URL=http://127.0.0.1:8899"
echo "  METEORA_POOL_ADDRESS=$SOL_USDC_POOL"
echo ""
echo "Next steps:"
echo "  1. Airdrop SOL: solana airdrop 100"
echo "  2. Run test: NODE_ENV=local npx tsx src/test/local-meteora-test.ts"
echo ""
echo "To stop the validator: pkill solana-test-validator"
echo ""
