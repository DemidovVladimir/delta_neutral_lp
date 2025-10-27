import winston from 'winston';
import { LOG_CONFIG } from '../config/constants.js';
import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
if (!fs.existsSync(LOG_CONFIG.logDir)) {
  fs.mkdirSync(LOG_CONFIG.logDir, { recursive: true });
}

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Human-readable format for console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const { timestamp, level, message, ...meta } = info;
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: structuredFormat,
  transports: [
    // Write all logs to file in JSON format
    new winston.transports.File({
      filename: path.join(LOG_CONFIG.logDir, 'error.log'),
      level: 'error',
      maxsize: LOG_CONFIG.maxFileSize,
      maxFiles: LOG_CONFIG.maxFiles,
    }),
    new winston.transports.File({
      filename: path.join(LOG_CONFIG.logDir, 'combined.log'),
      maxsize: LOG_CONFIG.maxFileSize,
      maxFiles: LOG_CONFIG.maxFiles,
    }),
  ],
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
} else {
  // In production, use JSON format for console too (for log aggregation)
  logger.add(
    new winston.transports.Console({
      format: structuredFormat,
    })
  );
}

// Helper functions for common log patterns
export const log = {
  debug: (message: string, meta?: Record<string, any>) => logger.debug(message, meta),
  info: (message: string, meta?: Record<string, any>) => logger.info(message, meta),
  warn: (message: string, meta?: Record<string, any>) => logger.warn(message, meta),
  error: (message: string, meta?: Record<string, any>) => logger.error(message, meta),

  // Domain-specific logging helpers
  transaction: (signature: string, action: string, meta?: Record<string, any>) => {
    logger.info('Transaction', {
      signature,
      action,
      ...meta,
    });
  },

  hedge: (delta: number, targetSol: number, currentSol: number, meta?: Record<string, any>) => {
    logger.info('Hedge Adjustment', {
      delta,
      targetSol,
      currentSol,
      adjustment: targetSol - currentSol,
      ...meta,
    });
  },

  risk: (event: string, value: number, threshold: number, meta?: Record<string, any>) => {
    logger.warn('Risk Event', {
      event,
      value,
      threshold,
      breach: value > threshold,
      ...meta,
    });
  },

  emergency: (reason: string, meta?: Record<string, any>) => {
    logger.error('Emergency Flow Triggered', {
      reason,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  },

  performance: (action: string, durationMs: number, meta?: Record<string, any>) => {
    logger.debug('Performance', {
      action,
      durationMs,
      ...meta,
    });
  },

  state: (state: string, data: Record<string, any>) => {
    logger.info('State Update', {
      state,
      ...data,
    });
  },
};

// Export the underlying logger for advanced usage
export default logger;
