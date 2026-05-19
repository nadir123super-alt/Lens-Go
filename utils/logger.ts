/**
 * Logger utility - 生产环境日志控制
 * 
 * 在开发环境输出所有日志，在生产环境只输出警告和错误
 */

const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  /**
   * 调试日志 - 仅在开发环境输出
   */
  log: (...args: any[]) => {
    if (!isProduction) {
      console.log(...args);
    }
  },

  /**
   * 信息日志 - 仅在开发环境输出
   */
  info: (...args: any[]) => {
    if (!isProduction) {
      console.info(...args);
    }
  },

  /**
   * 警告日志 - 始终输出
   */
  warn: (...args: any[]) => {
    console.warn(...args);
  },

  /**
   * 错误日志 - 始终输出
   */
  error: (...args: any[]) => {
    console.error(...args);
  },
};

export default logger;