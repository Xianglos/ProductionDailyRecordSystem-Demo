'use strict';

/**
 * 审计服务（FR11 / 6.6）。
 * 原则：仅追加、不可篡改；不记录密码等敏感字段；写入失败不阻断业务主流程。
 */

const os = require('os');

const auditStore = require('../store/auditStore');
const { ACTION_LABEL, ENTITY_LABEL } = require('../constants');
const { newId } = require('../utils/id');
const { nowText } = require('../utils/time');
const logger = require('../utils/logger');

/** 永不落审计的敏感字段 */
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'newPassword',
  'oldPassword',
  'token',
  'confirmPassword',
]);

function summarize(payload) {
  if (payload === undefined || payload === null) return '';
  if (typeof payload !== 'object') return '';
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return '';
  try {
    return JSON.stringify(clean);
  } catch (_) {
    return '';
  }
}

/** 取两次记录的差异字段（UPDATE 场景，6.6） */
function diff(before, after) {
  if (!before || !after) return { before: summarize(before), after: summarize(after) };
  const changedBefore = {};
  const changedAfter = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (SENSITIVE_KEYS.has(key)) continue;
    const a = before[key] === undefined ? '' : String(before[key]);
    const b = after[key] === undefined ? '' : String(after[key]);
    if (a !== b) {
      changedBefore[key] = a;
      changedAfter[key] = b;
    }
  }
  return { before: summarize(changedBefore), after: summarize(changedAfter) };
}

/**
 * 记录一条审计。失败仅告警。
 * @param {{entity:string, entityId:string, action:string, before?:object, after?:object, user?:object}} entry
 */
async function record(entry) {
  try {
    await auditStore.ensure();
    await auditStore.append({
      id: newId(),
      entity: entry.entity || '',
      entity_id: String(entry.entityId === undefined || entry.entityId === null ? '' : entry.entityId),
      action: entry.action || '',
      operator_id: entry.user ? entry.user.id : '',
      operator_account: entry.user ? entry.user.account : '',
      host: safeHost(),
      before: summarize(entry.before),
      after: summarize(entry.after),
      created_at: nowText(),
    });
  } catch (err) {
    logger.warn('审计写入失败（不影响业务主流程）：', err.message);
  }
}

/** 记录一次"改前/改后"差异 */
async function recordUpdate(entity, entityId, before, after, user) {
  const delta = diff(before, after);
  return record({ entity, entityId, action: 'UPDATE', before: parse(delta.before), after: parse(delta.after), user });
}

function parse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function safeHost() {
  try {
    return os.hostname();
  } catch (_) {
    return '';
  }
}

/**
 * 分页查询审计日志（FR11）。
 */
async function query(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const size = Math.max(1, Math.min(200, Number(params.size) || 20));
  const entity = String(params.entity || '').trim();
  const action = String(params.action || '').trim();
  const entityId = String(params.entityId || '').trim().toLowerCase();
  const operatorId = String(params.operatorId || '').trim();

  let rows = await auditStore.all();
  if (entity) rows = rows.filter((r) => r.entity === entity);
  if (action) rows = rows.filter((r) => r.action === action);
  if (operatorId) rows = rows.filter((r) => r.operator_id === operatorId);
  if (entityId) rows = rows.filter((r) => String(r.entity_id).toLowerCase().includes(entityId));

  // 倒序：最新在前
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const total = rows.length;
  const start = (page - 1) * size;
  const pageRows = rows.slice(start, start + size).map((r) => ({
    ...r,
    entity_label: ENTITY_LABEL[r.entity] || r.entity,
    action_label: ACTION_LABEL[r.action] || r.action,
  }));

  return { total, page, size, rows: pageRows };
}

module.exports = { record, recordUpdate, query, summarize, diff };
