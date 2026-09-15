'use strict';

/**
 * 配置与路径解析。
 * data/ 目录定位规则见《开发详细设计书》2.5：
 *   1. 环境变量 PDR_DATA_DIR（测试/备份重定向）
 *   2. 打包态：path.dirname(process.execPath) + '/data'
 *   3. 开发态：工程根目录 + '/data'
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** 判断当前是否由 node.exe 直接运行（开发态） */
function isPackagedRuntime() {
  const exe = path.basename(process.execPath || '').toLowerCase();
  return exe !== 'node.exe' && exe !== 'node';
}

function resolveDataDir() {
  const override = process.env.PDR_DATA_DIR;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  const base = isPackagedRuntime() ? path.dirname(process.execPath) : PROJECT_ROOT;
  return path.join(base, 'data');
}

const DATA_DIR = resolveDataDir();

const PATHS = Object.freeze({
  data: DATA_DIR,
  reports: path.join(DATA_DIR, 'reports'),
  exports: path.join(DATA_DIR, 'exports'),
  users: path.join(DATA_DIR, 'users.csv'),
  products: path.join(DATA_DIR, 'products.csv'),
  templates: path.join(DATA_DIR, 'templates.csv'),
  operationTypes: path.join(DATA_DIR, 'operation_types.csv'),
  audit: path.join(DATA_DIR, 'audit.csv'),
  session: path.join(DATA_DIR, 'session.dat'),
  ui: path.join(PROJECT_ROOT, 'ui'),
  assets: path.join(PROJECT_ROOT, 'ui', 'assets'),
});

const APP = Object.freeze({
  NAME: '生产日报系统',
  TAG: '示例系统',
  VERSION: '1.0.0',
  /** WebView2 自定义协议 scheme（Windows 下 file:// 无法使用 IPC，必须走自定义协议） */
  SCHEME: 'pdr',
  WINDOW: Object.freeze({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
  }),
  /** 生产（打包）态关闭开发者工具 */
  DEVTOOLS: process.env.PDR_DEVTOOLS === '1' || !isPackagedRuntime(),
});

const AUTH = Object.freeze({
  BCRYPT_COST: 10,
  DEFAULT_PASSWORD: '123456',
  REMEMBER_DAYS: 7,
  /** 未勾选"记住账号"时的进程内会话有效期 */
  SESSION_TTL_MS: 12 * 60 * 60 * 1000,
});

/** 界面交互参数（7.2） */
const UI = Object.freeze({
  HEADER_DEBOUNCE_MS: 300,
  DETAIL_DEBOUNCE_MS: 400,
  PAGE_SIZES: [10, 20, 50],
});

/** 首次启动演示数据开关（PDR_SEED_DEMO=0 可关闭） */
const SEED_DEMO = process.env.PDR_SEED_DEMO !== '0';

/** 导出保存对话框开关（PDR_NO_DIALOG=1 时直接落到 data/exports/） */
const USE_SAVE_DIALOG = process.env.PDR_NO_DIALOG !== '1';

async function ensureDataDirs() {
  await fsp.mkdir(PATHS.data, { recursive: true });
  await fsp.mkdir(PATHS.reports, { recursive: true });
  await fsp.mkdir(PATHS.exports, { recursive: true });
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  PATHS,
  APP,
  AUTH,
  UI,
  SEED_DEMO,
  USE_SAVE_DIALOG,
  isPackagedRuntime,
  ensureDataDirs,
};
