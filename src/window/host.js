'use strict';

/**
 * 窗口宿主层：把「单一 Windows 窗口 + WebView2」的具体绑定实现收敛到本文件，
 * 其余各层（桥接/服务/存储）与宿主实现无关。
 *
 * 说明：设计书原定桥接库 `@webview/webview` 在 npm 上不存在，
 * 实际采用 `@webviewjs/webview`（基于 tao + wry 的 N-API 绑定，Windows 下封装 WebView2，
 * 提供预编译原生模块，无需本地 C++ 编译链）。能力等价：单窗口、无端口、无 HTTP 服务。
 *
 * WebView2 用户数据目录（User Data Folder）必须显式指定为可写路径：
 * 其默认位置在可执行文件同级目录，开发态 process.execPath 指向 Program Files 下的
 * node.exe，写入被系统拒绝（HRESULT 0x80070005 → E_ACCESSDENIED），窗口创建会失败。
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { APP, PATHS } = require('../config');
const logger = require('../utils/logger');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
};

const state = { app: null, context: null, window: null, webview: null };

/* ---------------------- WebView2 用户数据目录 ---------------------- */

/**
 * 解析浏览器数据目录（仅存放 WebView2 自身的缓存与配置，不含业务数据）。
 * 优先级：PDR_WEBVIEW_DATA_DIR → %LOCALAPPDATA%\PdrDesktop\WebView2 → 系统临时目录。
 * 刻意不放在 data/ 内，避免 WebView2 缓存污染业务数据的备份。
 */
function resolveWebviewDataDir() {
  const override = process.env.PDR_WEBVIEW_DATA_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && String(localAppData).trim()) {
    return path.join(String(localAppData).trim(), 'PdrDesktop', 'WebView2');
  }
  return path.join(os.tmpdir(), 'PdrDesktop-WebView2');
}

/** 建立目录并做一次写入探测，提前暴露权限问题 */
function ensureWritableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
  return dir;
}

function readWebviewRuntimeVersion(binding) {
  try {
    if (binding && typeof binding.getWebviewVersion === 'function') {
      return String(binding.getWebviewVersion() || '') || '未知';
    }
  } catch (_) {
    /* 运行时缺失时忽略，由后续创建流程给出错误 */
  }
  return '未检测到（可能未安装 WebView2 Evergreen Runtime）';
}

/* ------------------------------ 绑定加载 ------------------------------ */

function loadBinding() {
  try {
    // eslint-disable-next-line global-require
    return require('@webviewjs/webview');
  } catch (err) {
    const message = [
      '无法加载 WebView2 绑定库 @webviewjs/webview。',
      '请确认：',
      '  1) 已在工程根目录执行 npm install；',
      '  2) 使用 Node.js 24 或更高版本运行（node -v 检查）；',
      '  3) 可选依赖未被禁用（--no-optional 会导致原生模块缺失）；',
      '  4) 系统已安装 WebView2 Evergreen Runtime（Win11 自带）。',
      `原始错误：${err.message}`,
    ].join('\n');
    const wrapped = new Error(message);
    wrapped.cause = err;
    throw wrapped;
  }
}

/* ------------------------------ 静态资源 ------------------------------ */

/**
 * 自定义协议静态资源处理器（serve ui/ 目录）。
 * 路径穿越防护见《开发详细设计书》9 安全设计。
 */
async function serveStatic(request) {
  const root = path.resolve(PATHS.ui);
  let pathname = '/';
  try {
    pathname = new URL(request.url).pathname;
  } catch (_) {
    pathname = '/';
  }
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(root, relative);

  if (path.relative(root, filePath).startsWith('..')) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  try {
    const body = await fsp.readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (_) {
    return new Response(`Not found: ${relative}`, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/* ------------------------------ 错误说明 ------------------------------ */

function buildWindowError(err, binding, webviewDataDir) {
  const raw = err && err.message ? err.message : String(err);
  const accessDenied = /0x80070005|E_ACCESSDENIED|拒绝访问/i.test(raw);

  const lines = [`创建 WebView2 窗口失败：${raw}`, '', '环境信息：'];
  lines.push(`  · WebView2 运行时：${readWebviewRuntimeVersion(binding)}`);
  lines.push(`  · 浏览器数据目录：${webviewDataDir}`);
  lines.push(`  · 当前 Node 可执行文件：${process.execPath}`);

  if (accessDenied) {
    lines.push('');
    lines.push('判定为访问被拒绝（HRESULT 0x80070005），常见原因与处置：');
    lines.push('  1. 浏览器数据目录不可写：核对上面"浏览器数据目录"路径，或用环境变量改到可写位置后重试：');
    lines.push('       set PDR_WEBVIEW_DATA_DIR=D:\\temp\\pdr-webview');
    lines.push('       npm start');
    lines.push('  2. 当前终端进程受安全策略限制（受管终端、受限令牌、杀软拦截子进程）：');
    lines.push('     换用普通 cmd / PowerShell 窗口重试。');
    lines.push('  3. 数据目录归属冲突（曾以其他用户或管理员运行过）：');
    lines.push('     删除上述浏览器数据目录后重试。');
    lines.push('  4. WebView2 Runtime 安装损坏：重新安装 Evergreen Runtime。');
  } else {
    lines.push('');
    lines.push('请确认系统已安装 WebView2 Evergreen Runtime（Win11 自带，Win10 需单独安装）。');
  }

  const wrapped = new Error(lines.join('\n'));
  wrapped.cause = err;
  return wrapped;
}

/* ------------------------------ 宿主创建 ------------------------------ */

/**
 * 创建主窗口并挂载桥接入口。
 * @param {{onInvoke: (raw:string) => Promise<string>}} options
 */
function createHost(options) {
  const binding = loadBinding();
  const { Application } = binding;
  const { onInvoke } = options;

  // 1) 浏览器数据目录：必须在创建窗口/视图之前就绪，
  //    否则 WebView2 会回落到"可执行文件同级"这一不可写的默认位置
  let webviewDataDir;
  try {
    webviewDataDir = ensureWritableDir(resolveWebviewDataDir());
  } catch (err) {
    throw new Error(
      `WebView2 用户数据目录不可写：${resolveWebviewDataDir()}\n`
      + `原始错误：${err.message}\n`
      + '请通过环境变量 PDR_WEBVIEW_DATA_DIR 指定一个可写目录后重试。',
    );
  }
  // 双保险：若绑定库未把上下文目录透传给加载器，WebView2 加载器会读取该环境变量
  process.env.WEBVIEW2_USER_DATA_FOLDER = webviewDataDir;
  logger.info('WebView2 浏览器数据目录：', webviewDataDir);

  const app = new Application();

  try {
    // 2) 显式上下文：把浏览器数据目录固定到可写位置
    let context = null;
    try {
      context = app.createWebContext({ dataDirectory: webviewDataDir });
    } catch (err) {
      logger.warn('创建 WebContext 失败，回退默认上下文（依赖 WEBVIEW2_USER_DATA_FOLDER 生效）：', err.message);
    }

    const win = app.createBrowserWindow({
      title: APP.NAME,
      width: APP.WINDOW.width,
      height: APP.WINDOW.height,
    });

    // 必须在 createWebview 之前注册自定义协议
    win.registerProtocol(APP.SCHEME, serveStatic);

    const webviewOptions = { url: `${APP.SCHEME}://localhost/index.html` };
    if (context) webviewOptions.webContext = context;
    const webview = win.createWebview(webviewOptions);

    // 向页面暴露桥接命名空间：window.pdr.invoke(payloadJson)
    webview.expose('pdr', {
      invoke: async (raw) => String(await onInvoke(typeof raw === 'string' ? raw : JSON.stringify(raw))),
      appInfo: { name: APP.NAME, tag: APP.TAG, version: APP.VERSION },
    });

    if (APP.DEVTOOLS) {
      webview.on('page-load-finished', () => {
        try {
          webview.openDevtools();
        } catch (err) {
          logger.warn('开发者工具打开失败：', err.message);
        }
      });
    }

    app.on('application-close-requested', () => app.exit());

    // 持有引用：上下文生命周期不得短于使用它的 webview
    state.app = app;
    state.context = context;
    state.window = win;
    state.webview = webview;
  } catch (err) {
    throw buildWindowError(err, binding, webviewDataDir);
  }

  return {
    /** 启动事件循环（阻塞至窗口关闭） */
    run() {
      logger.info(`${APP.NAME} 窗口已创建，尺寸 ${APP.WINDOW.width}×${APP.WINDOW.height}`);
      app.run();
    },
    /** 向界面推送事件：window.__onEvent(event, payload) */
    emitEvent(event, payload) {
      if (!state.webview) return;
      const script = `window.__onEvent && window.__onEvent(${JSON.stringify(String(event))}, ${JSON.stringify(payload || {})})`;
      try {
        state.webview.evaluateScript(script);
      } catch (err) {
        logger.warn('事件注入失败：', err.message);
      }
    },
    close() {
      try {
        app.exit();
      } catch (_) {
        /* 忽略关闭异常 */
      }
    },
  };
}

module.exports = { createHost, resolveWebviewDataDir };
