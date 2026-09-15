'use strict';

/**
 * 全局常量：角色、实体、操作类型、错误码、字段长度限制。
 * 对应《开发详细设计书》3.3 字段定义、5.2 错误码表、5.3 方法清单。
 */

const ROLE = Object.freeze({
  OPERATOR: 'OPERATOR',
  LEADER: 'LEADER',
  QA: 'QA',
  ADMIN: 'ADMIN',
});

const ROLE_LABEL = Object.freeze({
  OPERATOR: '操作工',
  LEADER: '班组长',
  QA: '质量管理员',
  ADMIN: '系统管理员',
});

const ROLE_ORDER = [ROLE.OPERATOR, ROLE.LEADER, ROLE.QA, ROLE.ADMIN];

/** 可写角色（R6：仅操作工与系统管理员，且仅限当日） */
const WRITE_ROLES = Object.freeze([ROLE.OPERATOR, ROLE.ADMIN]);
/** 统计看板可见角色 */
const STATS_ROLES = Object.freeze([ROLE.LEADER, ROLE.QA, ROLE.ADMIN]);
/** 报表导出 / 审计日志可见角色 */
const EXPORT_ROLES = Object.freeze([ROLE.QA, ROLE.ADMIN]);
const AUDIT_ROLES = Object.freeze([ROLE.QA, ROLE.ADMIN]);
/** 系统管理角色 */
const ADMIN_ROLES = Object.freeze([ROLE.ADMIN]);

const ENTITY = Object.freeze({
  REPORT_HEADER: 'report_header',
  REPORT_DETAIL: 'report_detail',
  PRODUCT: 'product',
  TEMPLATE: 'template',
  OPERATION_TYPE: 'operation_type',
  USER: 'user',
});

const ENTITY_LABEL = Object.freeze({
  report_header: '日报头部',
  report_detail: '生产记录',
  product: '品名',
  template: '工艺模板',
  operation_type: '操作类型',
  user: '用户',
});

const ACTION = Object.freeze({
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
});

const ACTION_LABEL = Object.freeze({
  INSERT: '新增',
  UPDATE: '修改',
  DELETE: '删除',
});

/** 统一错误码（5.2） */
const CODE = Object.freeze({
  OK: 0,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
});

/** 字段与业务限制 */
const LIMITS = Object.freeze({
  DETAIL_ROWS: 15,
  SUMMARY_MAX: 1000,
  REMARK_MAX: 200,
  WARN_REASON_MAX: 200,
  ACCOUNT_MIN: 3,
  ACCOUNT_MAX: 50,
  ACCOUNT_RE: /^[A-Za-z0-9_]{3,50}$/,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 32,
  CODE_MAX: 64,
  NAME_MAX: 100,
  UNIT_MAX: 20,
  PHONE_MAX: 30,
  BATCH_MAX: 64,
  DATE_RE: /^\d{4}-\d{2}-\d{2}$/,
  MONTH_RE: /^\d{4}-\d{2}$/,
  YEAR_RE: /^\d{4}$/,
  MINUTE_RE: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
});

/** 逻辑布尔值在 CSV 中的字面量 */
const FLAG = Object.freeze({ ON: '1', OFF: '0' });

module.exports = {
  ROLE,
  ROLE_LABEL,
  ROLE_ORDER,
  WRITE_ROLES,
  STATS_ROLES,
  EXPORT_ROLES,
  AUDIT_ROLES,
  ADMIN_ROLES,
  ENTITY,
  ENTITY_LABEL,
  ACTION,
  ACTION_LABEL,
  CODE,
  LIMITS,
  FLAG,
};
