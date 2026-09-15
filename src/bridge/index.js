'use strict';

/**
 * 桥接层（《开发详细设计书》4.3 / 5 章）。
 *   - 唯一入口 __invoke / window.pdr.invoke(method, params)
 *   - 分发 → 会话与角色鉴权 → 调用服务 → 统一封装 {code, message, data}
 *   - 会话失效时向界面推送 session.expired 事件
 */

const { CODE, EXPORT_ROLES, ADMIN_ROLES, AUDIT_ROLES, STATS_ROLES, WRITE_ROLES } = require('../constants');
const { BizError } = require('../utils/error');
const logger = require('../utils/logger');

const authService = require('../services/authService');
const reportService = require('../services/reportService');
const statsService = require('../services/statsService');
const exportService = require('../services/exportService');
const auditService = require('../services/auditService');
const userService = require('../services/userService');
const productService = require('../services/productService');
const templateService = require('../services/templateService');
const operationTypeService = require('../services/operationTypeService');
const reportStore = require('../store/reportStore');

/* ------------------------------ 事件通道 ------------------------------ */

let eventSink = null;

function setEventSink(sink) {
  eventSink = typeof sink === 'function' ? sink : null;
}

function notify(event, payload) {
  if (!eventSink) return;
  try {
    eventSink(event, payload || {});
  } catch (err) {
    logger.warn('事件推送失败：', err.message);
  }
}

/* ------------------------------ 路由表 ------------------------------ */

const ROUTES = {
  /* 认证 */
  'auth.login': { public: true, handler: (p) => authService.login(p) },
  'auth.restore': { public: true, handler: () => authService.restore() },
  'auth.logout': { handler: (p, ctx) => authService.logout(ctx.token) },
  'auth.me': { handler: (p, ctx) => authService.me(ctx.token) },
  'auth.changePassword': { handler: (p, ctx) => authService.changePassword(ctx.token, p) },

  /* 日报 */
  'report.ensureToday': { roles: WRITE_ROLES, handler: (p, ctx) => reportService.ensureToday(ctx.user) },
  'report.getByDate': { handler: (p, ctx) => reportService.getByDate(p.date, ctx.user) },
  'report.list': { handler: (p, ctx) => reportService.list(ctx.user) },
  'report.saveHeader': { roles: WRITE_ROLES, handler: (p, ctx) => reportService.saveHeader(p.date, p, ctx.user) },
  'report.saveDetail': { roles: WRITE_ROLES, handler: (p, ctx) => reportService.saveDetail(p.date, p, ctx.user) },
  'report.deleteDetail': { roles: WRITE_ROLES, handler: (p, ctx) => reportService.deleteDetail(p.date, p.id, ctx.user) },

  /* 统计 */
  'stats.monthly': { roles: STATS_ROLES, handler: (p, ctx) => statsService.monthly(p) },

  /* 导出 */
  'report.exportPdf': {
    roles: EXPORT_ROLES,
    handler: async (p, ctx) => {
      const date = reportStore.assertDate(p.date);
      const report = await reportService.getByDate(date, ctx.user);
      return exportService.exportPdf(date, ctx.user, report);
    },
  },
  'report.exportExcel': {
    roles: EXPORT_ROLES,
    handler: async (p, ctx) => {
      const summaries = await reportService.list(ctx.user);
      return exportService.exportExcel(p, ctx.user, summaries);
    },
  },

  /* 品名 */
  'product.list': { roles: ADMIN_ROLES, handler: (p) => productService.list(p) },
  'product.save': { roles: ADMIN_ROLES, handler: (p, ctx) => productService.save(p, ctx.user) },
  'product.delete': { roles: ADMIN_ROLES, handler: (p, ctx) => productService.remove(p.id, ctx.user) },
  'product.options': { handler: () => productService.options() },

  /* 工艺模板 */
  'template.list': { roles: ADMIN_ROLES, handler: () => templateService.list() },
  'template.getByProduct': { handler: (p) => templateService.getByProduct(p.productCode) },
  'template.save': { roles: ADMIN_ROLES, handler: (p, ctx) => templateService.save(p, ctx.user) },

  /* 操作类型字典 */
  'operationType.list': { roles: ADMIN_ROLES, handler: (p) => operationTypeService.list(p) },
  'operationType.save': { roles: ADMIN_ROLES, handler: (p, ctx) => operationTypeService.save(p, ctx.user) },
  'operationType.options': { handler: () => operationTypeService.options() },

  /* 用户 */
  'user.list': { roles: ADMIN_ROLES, handler: (p) => userService.list(p) },
  'user.save': { roles: ADMIN_ROLES, handler: (p, ctx) => userService.save(p, ctx.user) },
  'user.delete': { roles: ADMIN_ROLES, handler: (p, ctx) => userService.remove(p.id, ctx.user) },
  'user.resetPassword': { roles: ADMIN_ROLES, handler: (p, ctx) => userService.resetPassword(p, ctx.user) },
  'user.options': { handler: () => userService.options() },

  /* 审计 */
  'audit.query': { roles: AUDIT_ROLES, handler: (p) => auditService.query(p) },
};

/* ------------------------------ 分发 ------------------------------ */

function ok(data) {
  return { code: CODE.OK, message: 'ok', data: data === undefined ? null : data };
}

function fail(code, message) {
  return { code, message, data: null };
}

/**
 * 处理一次界面调用。
 * @param {string|object} raw JSON 报文 { method, params, token }
 * @returns {Promise<{code:number, message:string, data:any}>}
 */
async function dispatch(raw) {
  let request;
  try {
    request = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch (_) {
    return fail(CODE.BAD_REQUEST, '请求报文格式错误');
  }

  const method = String(request.method || '');
  const params = request.params && typeof request.params === 'object' ? request.params : {};
  const token = request.token ? String(request.token) : '';

  try {
    const route = ROUTES[method];
    if (!route) return fail(CODE.NOT_FOUND, `未支持的方法：${method || '(空)'}`);

    const ctx = { token, user: null };
    if (!route.public) {
      ctx.user = await authService.resolveSession(token);
      if (route.roles && route.roles.length > 0 && !route.roles.includes(ctx.user.role)) {
        throw BizError.forbidden('当前角色无该功能权限');
      }
    }

    const data = await route.handler(params, ctx);
    return ok(data);
  } catch (err) {
    if (err instanceof BizError) {
      if (err.code === CODE.UNAUTHORIZED) {
        notify('session.expired', { message: err.message });
      }
      return fail(err.code, err.message);
    }
    logger.error(`[${method}] 未捕获异常：`, err && err.stack ? err.stack : err);
    return fail(CODE.INTERNAL, '系统内部错误，请稍后重试');
  }
}

/** 已注册的方法名（供诊断使用） */
function methods() {
  return Object.keys(ROUTES).sort();
}

module.exports = { dispatch, methods, setEventSink, notify };
