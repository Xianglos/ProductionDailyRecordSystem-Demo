'use strict';

/**
 * 运行日志（极简）：仅用于宿主进程控制台的诊断输出，不落盘。
 */

function ts() {
  return new Date().toISOString();
}

function info(...args) {
  console.log(`[${ts()}] [INFO ]`, ...args);
}

function warn(...args) {
  console.warn(`[${ts()}] [WARN ]`, ...args);
}

function error(...args) {
  console.error(`[${ts()}] [ERROR]`, ...args);
}

module.exports = { info, warn, error };
