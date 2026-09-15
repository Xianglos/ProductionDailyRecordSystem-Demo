'use strict';

/**
 * 用户管理服务（FR12）。
 * 账号唯一且不可修改；删除为逻辑删除；不允许删除当前登录账号。
 */

const { ACTION, ENTITY, LIMITS, ROLE_LABEL, ROLE_ORDER } = require('../constants');
const { AUTH } = require('../config');
const { BizError } = require('../utils/error');
const { newId } = require('../utils/id');
const { hashPassword } = require('../utils/crypto');
const { nowText } = require('../utils/time');
const num = require('../utils/number');
const userStore = require('../store/userStore');
const auditService = require('./auditService');
const authService = require('./authService');

function publicUser(row) {
  return {
    id: row.id,
    account: row.account,
    name: row.name,
    role: row.role,
    role_label: ROLE_LABEL[row.role] || row.role,
    phone: row.phone,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateAccount(account) {
  if (!LIMITS.ACCOUNT_RE.test(account)) {
    throw BizError.badRequest(`账号需为 ${LIMITS.ACCOUNT_MIN}–${LIMITS.ACCOUNT_MAX} 位字母、数字或下划线`);
  }
}

function validateRole(role) {
  if (!ROLE_ORDER.includes(role)) throw BizError.badRequest('角色不合法');
}

function validatePassword(password) {
  if (password.length < LIMITS.PASSWORD_MIN || password.length > LIMITS.PASSWORD_MAX) {
    throw BizError.badRequest(`密码长度需为 ${LIMITS.PASSWORD_MIN}–${LIMITS.PASSWORD_MAX} 位`);
  }
}

/** 分页查询（账号/姓名模糊、角色、状态） */
async function list(params = {}) {
  const account = String(params.account || '').trim().toLowerCase();
  const name = String(params.name || '').trim();
  const role = String(params.role || '').trim();
  const status = String(params.status === undefined || params.status === null ? '' : params.status).trim();
  const page = Math.max(1, Number(params.page) || 1);
  const size = Math.max(1, Math.min(200, Number(params.size) || 20));

  let rows = (await userStore.all()).filter((r) => r.deleted !== '1');
  if (account) rows = rows.filter((r) => String(r.account).toLowerCase().includes(account));
  if (name) rows = rows.filter((r) => String(r.name).includes(name));
  if (role) rows = rows.filter((r) => r.role === role);
  if (status === '0' || status === '1') rows = rows.filter((r) => r.status === status);

  rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const total = rows.length;
  const start = (page - 1) * size;
  return { total, page, size, rows: rows.slice(start, start + size).map(publicUser) };
}

/** 新增或编辑（编辑时账号不可改） */
async function save(params = {}, currentUser) {
  const id = num.toText(params.id);
  const name = num.toText(params.name);
  const role = num.toText(params.role);
  const phone = num.toText(params.phone);
  const statusText = num.toText(params.status);
  const status = statusText === '' ? '1' : statusText;

  if (!name) throw BizError.badRequest('请输入姓名');
  if (name.length > LIMITS.NAME_MAX) throw BizError.badRequest(`姓名长度不能超过 ${LIMITS.NAME_MAX} 字`);
  if (phone.length > LIMITS.PHONE_MAX) throw BizError.badRequest(`电话长度不能超过 ${LIMITS.PHONE_MAX} 字`);
  validateRole(role);
  if (status !== '0' && status !== '1') throw BizError.badRequest('状态不合法');

  const now = nowText();

  if (!id) {
    const account = num.toText(params.account).toLowerCase();
    validateAccount(account);
    if (await userStore.findByAccount(account)) throw BizError.conflict('账号已存在');
    const password = num.toText(params.password) || AUTH.DEFAULT_PASSWORD;
    validatePassword(password);
    const row = {
      id: newId(),
      account,
      name,
      password_hash: hashPassword(password),
      role,
      phone,
      status,
      deleted: '0',
      created_at: now,
      updated_at: now,
    };
    await userStore.insert(row);
    await auditService.record({
      entity: ENTITY.USER,
      entityId: row.id,
      action: ACTION.INSERT,
      after: publicUser(row),
      user: currentUser,
    });
    return publicUser(row);
  }

  const existing = await userStore.findById(id);
  if (!existing || existing.deleted === '1') throw BizError.notFound('用户不存在');
  if (existing.id === (currentUser && currentUser.id)) {
    if (status === '0') throw BizError.badRequest('不能禁用当前登录账号');
    if (role !== existing.role) throw BizError.badRequest('不能修改当前登录账号的角色');
  }
  const before = publicUser(existing);
  const updated = await userStore.updateById(id, { name, role, phone, status, updated_at: now });
  const after = publicUser(updated);
  if (status === '0') authService.invalidateUser(id);
  await auditService.recordUpdate(ENTITY.USER, id, before, after, currentUser);
  return after;
}

/** 逻辑删除；不允许删除当前登录账号 */
async function remove(id, currentUser) {
  const existing = await userStore.findById(num.toText(id));
  if (!existing || existing.deleted === '1') throw BizError.notFound('用户不存在');
  if (existing.id === (currentUser && currentUser.id)) {
    throw BizError.badRequest('不允许删除当前登录账号');
  }
  const before = publicUser(existing);
  await userStore.updateById(existing.id, { deleted: '1', status: '0', updated_at: nowText() });
  authService.invalidateUser(existing.id);
  await auditService.record({
    entity: ENTITY.USER,
    entityId: existing.id,
    action: ACTION.DELETE,
    before,
    user: currentUser,
  });
  return {};
}

/** 重置密码；留空重置为默认密码 */
async function resetPassword(params = {}, currentUser) {
  const id = num.toText(params.id);
  const existing = await userStore.findById(id);
  if (!existing || existing.deleted === '1') throw BizError.notFound('用户不存在');
  const password = num.toText(params.password) || AUTH.DEFAULT_PASSWORD;
  validatePassword(password);
  await userStore.updateById(id, { password_hash: hashPassword(password), updated_at: nowText() });
  authService.invalidateUser(id);
  await auditService.record({
    entity: ENTITY.USER,
    entityId: id,
    action: ACTION.UPDATE,
    after: { account: existing.account, password_reset: '1' },
    user: currentUser,
  });
  return {};
}

/** 启用用户列表（填报所需，登录用户均可使用） */
async function options() {
  const rows = await userStore.listActive();
  return rows
    .map((r) => ({ id: r.id, account: r.account, name: r.name, role: r.role }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

module.exports = { list, save, remove, resetPassword, options, publicUser };
