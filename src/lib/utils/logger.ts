import { isDevMode } from '@angular/core';

/**
 * ZFlow Logger - Centralized logging with production safety
 */
export class Logger {
  private static readonly PREFIX = '[ZFlow]';

  /**
   * Log standard info only in dev mode
   */
  static log(message: string, ...args: any[]): void {
    if (isDevMode()) {
      console.log(`${this.PREFIX} ${message}`, ...args);
    }
  }

  /**
   * Log warning in dev mode
   */
  static warn(message: string, ...args: any[]): void {
    if (isDevMode()) {
      console.warn(`${this.PREFIX} ${message}`, ...args);
    }
  }

  /**
   * Log errors even in production (important for debugging prod issues)
   * but formatted professionally
   */
  static error(message: string, ...args: any[]): void {
    console.error(`${this.PREFIX} ERROR: ${message}`, ...args);
  }

  /**
   * Explicit debug log (can be enabled via global flag/localStorage)
   */
  static debug(message: string, ...args: any[]): void {
    if (this.isDebugEnabled()) {
      console.debug(`${this.PREFIX} [DEBUG] ${message}`, ...args);
    }
  }

  private static isDebugEnabled(): boolean {
    try {
      return (
        isDevMode() ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('zflow_debug') === 'true')
      );
    } catch {
      return false;
    }
  }
}
