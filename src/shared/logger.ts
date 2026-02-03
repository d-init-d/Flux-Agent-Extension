/**
 * Simple logger utility
 */

const LOG_PREFIX = '[Flux Agent]';

export const logger = {
  info(...args: any[]) {
    console.log(LOG_PREFIX, ...args);
  },
  
  warn(...args: any[]) {
    console.warn(LOG_PREFIX, ...args);
  },
  
  error(...args: any[]) {
    console.error(LOG_PREFIX, ...args);
  },
  
  debug(...args: any[]) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(LOG_PREFIX, ...args);
    }
  },
};
