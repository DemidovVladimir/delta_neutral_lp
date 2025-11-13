import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { RPC_CONFIG, MIN_SOL_BALANCE } from '../config/constants.js';
import { ConfigError } from '../types/index.js';

/**
 * Parse private key from various formats
 */
function parsePrivateKey(privateKeyStr: string): Keypair {
  try {
    // Try base58 format first
    if (privateKeyStr.length === 87 || privateKeyStr.length === 88) {
      const decoded = bs58.decode(privateKeyStr);
      return Keypair.fromSecretKey(decoded);
    }

    // Try JSON array format: [1,2,3,...]
    if (privateKeyStr.startsWith('[')) {
      const arr = JSON.parse(privateKeyStr);
      const uint8Array = new Uint8Array(arr);
      return Keypair.fromSecretKey(uint8Array);
    }

    // Try comma-separated bytes: 1,2,3,...
    if (privateKeyStr.includes(',')) {
      const arr = privateKeyStr.split(',').map((s) => parseInt(s.trim(), 10));
      const uint8Array = new Uint8Array(arr);
      return Keypair.fromSecretKey(uint8Array);
    }

    throw new Error('Unrecognized private key format');
  } catch (error) {
    throw new ConfigError(
      'Failed to parse PRIVATE_KEY. Expected base58 string, JSON array, or comma-separated bytes',
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Get the wallet keypair
 */
export function getWalletKeypair(): Keypair {
  const config = getConfig();
  return parsePrivateKey(config.privateKey);
}

/**
 * Get the Solana connection
 */
export function getConnection(): Connection {
  const config = getConfig();
  return new Connection(config.rpcUrl, {
    commitment: RPC_CONFIG.commitment,
    confirmTransactionInitialTimeout: RPC_CONFIG.confirmationTimeout,
  });
}

/**
 * Initialize Solana connection and validate wallet
 * Used for startup validation and logging
 */
export async function initializeSolana(): Promise<void> {
  const config = getConfig();

  log.info('Initializing Solana connection', {
    rpcUrl: config.rpcUrl,
    lpOwner: config.lpOwner,
  });

  // Parse private key
  const keypair = parsePrivateKey(config.privateKey);
  const walletAddress = keypair.publicKey.toBase58();

  log.info('Wallet loaded', { address: walletAddress });

  // Create connection
  const connection = new Connection(config.rpcUrl, {
    commitment: RPC_CONFIG.commitment,
    confirmTransactionInitialTimeout: RPC_CONFIG.confirmationTimeout,
  });

  // Check connection
  try {
    const version = await connection.getVersion();
    log.info('Connected to Solana RPC', { version: version['solana-core'] });
  } catch (error) {
    throw new ConfigError('Failed to connect to RPC', {
      rpcUrl: config.rpcUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Check wallet balance
  try {
    const balance = await connection.getBalance(keypair.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    log.info('Wallet balance', {
      address: walletAddress,
      balance: balanceSol,
      balanceLamports: balance,
    });

    if (balanceSol < MIN_SOL_BALANCE) {
      log.warn('Wallet balance low', {
        balance: balanceSol,
        minimum: MIN_SOL_BALANCE,
      });
    }
  } catch (error) {
    log.warn('Failed to fetch wallet balance', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  log.info('Solana initialized successfully', {
    wallet: walletAddress,
  });
}
