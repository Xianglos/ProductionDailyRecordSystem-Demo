'use strict';

/**
 * 界面 ↔ Node 桥接封装（《开发详细设计书》5.1 / 5.4）。
 *   api.invoke(method, params) → Promise<data>，非 0 返回码抛出带 code 的异常
 *   window.__onEvent(event, payload) 由宿主进程注入调用
 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});

  const TOKEN_KEY = 'pdr.token';
  const handlers = {};

  let token = null;

  function getToken() {
    if (token) return token;
    try {
      token = global.sessionStorage ? global.sessionStorage.getItem(TOKEN_KEY) : null;
    } catch (_) {
      token = null;
    }
    return token;
  }

  function setToken(value) {
    token = value || null;
    try {
      if (!global.sessionStorage) return;
      if (token) global.sessionStorage.setItem(TOKEN_KEY, token);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {
      /* 忽略存储异常 */
    }
  }

  function makeError(code, message) {
    const err = new Error(message || '操作失败');
    err.code = code;
    return err;
  }

  /**
   * 调用宿主方法。
   * @param {string} method 例如 'report.saveDetail'
   * @param {object} [params]
   * @returns {Promise<any>} 统一返回结构的 data 部分
   */
  async function invoke(method, params) {
    const payload = JSON.stringify({ method, params: params || {}, token: getToken() });
    let raw;
    if (global.pdr && typeof global.pdr.invoke === 'function') {
      raw = await global.pdr.invoke(payload);
    } else if (typeof global.__invoke === 'function') {
      raw = await global.__invoke(payload);
    } else {
      throw makeError(500, '桥接通道不可用，请通过桌面程序启动本系统');
    }

    let response;
    try {
      response = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (_) {
      throw makeError(500, '宿主返回报文解析失败');
    }
    if (!response || response.code !== 0) {
      const code = response ? response.code : 500;
      if (code === 401) onSessionExpired();
      throw makeError(code, response ? response.message : '操作失败');
    }
    return response.data;
  }

  function on(handler, callback) {
    handlers[handler] = handlers[handler] || [];
    handlers[handler].push(callback);
  }

  function onSessionExpired() {
    setToken(null);
    (handlers['session.expired'] || []).forEach((fn) => {
      try {
        fn();
      } catch (_) {
        /* 忽略单个处理器异常 */
      }
    });
  }

  /**
   * 宿主注入的事件入口（设计书 4.3：webview 侧调用 window.__onEvent(event, payload)）。
   * 由宿主经 evaluateScript 注入调用，非界面主动触发。
   */
  global.__onEvent = function (event, payload) {
    if (event === 'session.expired') setToken(null);
    const list = handlers[event] || [];
    list.forEach((fn) => {
      try {
        fn(payload || {});
      } catch (_) {
        /* 忽略单个处理器异常 */
      }
    });
  };

  NS.api = {
    invoke,
    on,
    getToken,
    setToken,
    onSessionExpired,
    /** 宿主注入的应用信息（由 expose 提供，可缺失） */
    appInfo: (global.pdr && global.pdr.appInfo) || { name: '生产日报系统', tag: '示例系统', version: '1.0.0' },
  };
}(window));
