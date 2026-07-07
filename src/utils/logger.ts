import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Detect if running in GCP (Cloud Run, Compute Engine, etc.)
const isGCP = process.env.NODE_ENV === 'production' ||
              process.env.GCP_PROJECT ||
              process.env.K_SERVICE || // Cloud Run
              process.env.GAE_SERVICE; // App Engine

// Structured JSON format for GCP Cloud Logging
// GCP automatically parses these fields: severity, message, timestamp, etc.
const gcpFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // Map Winston levels to GCP severity levels
    const levelMap: Record<string, string> = {
      error: 'ERROR',
      warn: 'WARNING',
      info: 'INFO',
      debug: 'DEBUG',
    };

    // Add GCP severity field
    if (info.level && typeof info.level === 'string') {
      (info as any).severity = levelMap[info.level] || info.level.toUpperCase();
    }

    return info;
  })(),
  winston.format.json()
);

// Human-readable format for console (local development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const { timestamp, level, message, ...meta } = info;
    let msg = `${timestamp} [${level}] ${message}`;
    // Only show metadata if it exists and is not empty
    if (meta && Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Use structured JSON logging in GCP, console format locally
const format = isGCP ? gcpFormat : consoleFormat;

// Console-only logging - GCP captures stdout/stderr automatically
const transports: winston.transport[] = [
  new winston.transports.Console({
    format,
  })
];

// Persistent file log (operator order 2026-07-07): docker container logs die
// on every deploy/recreate — a file under data/ survives both (data/ is the
// bind mount, excluded from rsync --delete). Rotation caps disk use at
// ~100 MB ≈ 2 weeks of history at the current log volume. Full ISO
// timestamps because the file spans days. Failures here must never break
// the bot — logging is not worth dying for.
const FILE_LOG_PATH = process.env.LOG_FILE_PATH || 'data/logs/bot.log';
const fileFormat = winston.format.combine(
  winston.format.uncolorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    // Own full-ISO timestamp: the logger-level format may have already set a
    // short HH:mm:ss one, and this file spans days.
    const { timestamp: _short, level, message, ...meta } = info as any;
    let msg = `${new Date().toISOString()} [${level}] ${message}`;
    if (meta && Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);
try {
  fs.mkdirSync(path.dirname(FILE_LOG_PATH), { recursive: true });
  transports.push(
    new winston.transports.File({
      filename: FILE_LOG_PATH,
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      tailable: true,
    })
  );
} catch {
  // no file log — console/docker logs still work
}

// Create the logger with appropriate log level
// In production/GCP, default to 'info' to reduce log volume
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isGCP ? 'info' : 'debug'),
  format,
  transports,
  // Reduce log noise in production
  silent: false,
  exitOnError: false,
});

// Log sampling for production (reduce cost)
// Only log 1 out of N routine check cycles in production
const LOG_SAMPLE_RATE = parseInt(process.env.LOG_SAMPLE_RATE || '10'); // Log 1 in 10 by default
let logCounter = 0;

// Helper to determine if we should sample this log
const shouldSample = (forceLog: boolean = false): boolean => {
  if (!isGCP || forceLog) return true; // Always log locally or if forced
  logCounter++;
  return logCounter % LOG_SAMPLE_RATE === 0;
};

// Helper functions for common log patterns
export const log = {
  debug: (message: string, meta?: Record<string, any>) => logger.debug(message, meta),
  info: (message: string, meta?: Record<string, any>) => logger.info(message, meta),
  warn: (message: string, meta?: Record<string, any>) => logger.warn(message, meta),
  error: (message: string, meta?: Record<string, any>) => logger.error(message, meta),

  // Sampled info log - only logs 1 in N times in production (saves money!)
  infoSampled: (message: string, meta?: Record<string, any>) => {
    if (shouldSample()) {
      logger.info(message, { ...meta, sampled: true });
    }
  },

  /**
   * Red banner error logging - highly visible for critical failures
   * Use this for transaction failures that require immediate attention
   */
  errorBanner: (message: string, meta?: Record<string, any>) => {
    const banner = '═'.repeat(80);
    const padding = '║';

    // Log to console with red color
    console.error('\n');
    console.error(`\x1b[41m\x1b[37m${banner}\x1b[0m`);
    console.error(`\x1b[41m\x1b[37m${padding} ❌ ERROR ❌${' '.repeat(80 - padding.length - ' ❌ ERROR ❌'.length)}${padding}\x1b[0m`);
    console.error(`\x1b[41m\x1b[37m${banner}\x1b[0m`);
    console.error(`\x1b[31m\x1b[1m${message}\x1b[0m`);

    if (meta && Object.keys(meta).length > 0) {
      console.error('\x1b[33mDetails:\x1b[0m', JSON.stringify(meta, null, 2));
    }

    console.error(`\x1b[41m\x1b[37m${banner}\x1b[0m`);
    console.error('\n');

    // The raw console banner above bypasses winston — mirror the message
    // through the logger so file/JSON transports (and anything grepping the
    // persistent log, e.g. incident forensics) see banner-level events too.
    logger.error(message, meta);
  },
};

// Export the underlying logger for advanced usage
export default logger;
