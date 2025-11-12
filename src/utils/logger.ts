import winston from 'winston';

// Human-readable format for console - simplified output
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

// Console-only logging - no file output
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
  })
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: consoleFormat,
  transports,
});

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
  },
};

// Export the underlying logger for advanced usage
export default logger;
