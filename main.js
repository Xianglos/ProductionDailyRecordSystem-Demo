'use strict';

/**
 * 进程入口（《开发详细设计书》2.3）：
 * 初始化配置 → 建目录 → 初始化数据 → 创建主窗口（WebView2）→ 加载内置界面 → 挂载桥接。
 */

const { APP, PATHS, ensureDataDirs } = require('./src/config');
const logger = require('./src/utils/logger');
const { credentialCipherName } = require('./src/utils/crypto');
const seed = require('./src/seed');
const bridge = require('./src/bridge');
const host = require('./src/window/host');

async function main() {
  logger.info(`${APP.NAME} v${APP.VERSION} 启动中…`);

  await ensureDataDirs();
  logger.info('数据目录：', PATHS.data);

  await seed.ensureInitialized();
  logger.info('凭据加密算法：', credentialCipherName());
  logger.info('已注册桥接方法：', bridge.methods().length, '个');

  const windowHost = host.createHost({
    onInvoke: async (raw) => JSON.stringify(await bridge.dispatch(raw)),
  });

  bridge.setEventSink((event, payload) => windowHost.emitEvent(event, payload));

  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常：', err && err.stack ? err.stack : err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝：', reason);
  });

  windowHost.run();
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  // 启动期错误直接输出到控制台，便于定位（打包态无控制台时由系统对话框提示）
  console.error(`\n[启动失败] ${message}\n`);
  if (err && err.stack && process.env.PDR_DEBUG === '1') console.error(err.stack);
  process.exitCode = 1;
});
