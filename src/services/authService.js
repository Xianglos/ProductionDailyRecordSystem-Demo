'use strict';

/**
 * 认证服务（FR1 / 5.4）。
 *   - 会话态：进程内存 Map<token, {userId, account, name, role, expireAt}>
 *   - 记住账号：token + 过期时间经加密写入 data/session.dat，7 天有效
 *   - 未勾选：仅进程内有效，关闭程序即失效
 */

const fs = require('fs').promises;

const { AUTH, PATHS } = require('../config');
const { LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const { newToken } = require('../utils/id');
const { hashPassword, verifyPassword, encryptJson, decryptJson } = require('../utils/crypto');
const logger = require('../utils/logger');
const userStore = require('../store/userStore');

/** token -> session */
const sessions = new Map();

function publicUser(user) {
  return {
    id: user.id,
    account: user.account,
    name: user.name,
    role: user.role,
    phone: user.phone,
    status: user.status,
  };
}

async function writeSessionFile(payload) {
  try {
    await fs.writeFile(PATHS.session, encryptJson(payload));
  } catch (err) {
    logger.warn('凭据写入失败：', err.message);
  }
}

async function clearSessionFile() {
  try {
    await fs.unlink(PATHS.session);
  } catch (_) {
    /* 文件不存在时忽略 */
  }
}

/** 登录 */
async function login(params = {}) {
  const account = String(params.account || '').trim();
  const password = String(params.password === undefined || params.password === null ? '' : params.password);
  const remember = params.remember === true || params.remember === 'true' || params.remember === 1;

  if (!account || !password) throw BizError.badRequest('请输入账号与密码');

  const user = await userStore.findByAccount(account);
  // 账号不存在与密码错误统一提示（FR1）
  if (!user || user.deleted === '1') throw BizError.badRequest('账号或密码错误');
  if (!verifyPassword(password, user.password_hash)) throw BizError.badRequest('账号或密码错误');
  if (user.status !== '1') throw BizError.badRequest('账号已禁用，请联系管理员');

  const token = newToken();
  const ttl = remember ? AUTH.REMEMBER_DAYS * 24 * 60 * 60 * 1000 : AUTH.SESSION_TTL_MS;
  const expireAt = Date.now() + ttl;
  sessions.set(token, {
    userId: user.id,
    account: user.account,
    name: user.name,
    role: user.role,
    expireAt,
  });

  if (remember) await writeSessionFile({ token, userId: user.id, expireAt });
  else await clearSessionFile();

  return { token, expireAt, remember, user: publicUser(user) };
}

/** 解析会话（异步：同时校验账号可用性，实现"禁用/删除即时失效"） */
async function resolveSession(token) {
  const session = token ? sessions.get(String(token)) : null;
  if (!session) throw BizError.unauthorized('登录状态已失效，请重新登录');
  if (session.expireAt <= Date.now()) {
    sessions.delete(String(token));
    throw BizError.unauthorized('登录状态已过期，请重新登录');
  }
  const user = await userStore.findById(session.userId);
  if (!user || user.deleted === '1' || user.status !== '1') {
    sessions.delete(String(token));
    throw BizError.unauthorized('账号不可用，请重新登录');
  }
  session.account = user.account;
  session.name = user.name;
  session.role = user.role;
  return { id: user.id, account: user.account, name: user.name, role: user.role };
}

/** 当前登录用户 */
async function me(token) {
  const identity = await resolveSession(token);
  const user = await userStore.findById(identity.id);
  if (!user) throw BizError.unauthorized();
  return publicUser(user);
}

/** 退出登录 */
async function logout(token) {
  if (token) sessions.delete(String(token));
  await clearSessionFile();
  return {};
}

/** 修改密码：需原密码校验，新密码 6–32 位，成功后强制重新登录 */
async function changePassword(token, params = {}) {
  const identity = await resolveSession(token);
  const user = await userStore.findById(identity.id);
  if (!user) throw BizError.unauthorized();

  const oldPassword = String(params.oldPassword === undefined || params.oldPassword === null ? '' : params.oldPassword);
  const newPassword = String(params.newPassword === undefined || params.newPassword === null ? '' : params.newPassword);

  if (!oldPassword) throw BizError.badRequest('请输入原密码');
  if (!verifyPassword(oldPassword, user.password_hash)) throw BizError.badRequest('原密码不正确');
  if (newPassword.length < LIMITS.PASSWORD_MIN || newPassword.length > LIMITS.PASSWORD_MAX) {
    throw BizError.badRequest(`新密码长度需为 ${LIMITS.PASSWORD_MIN}–${LIMITS.PASSWORD_MAX} 位`);
  }
  if (newPassword === oldPassword) throw BizError.badRequest('新密码不能与原密码相同');

  await userStore.updateById(user.id, { password_hash: hashPassword(newPassword) });
  invalidateUser(user.id);
  await clearSessionFile();
  return {};
}

/** 使某用户的全部会话失效 */
function invalidateUser(userId) {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) sessions.delete(token);
  }
}

/** 启动时恢复会话；无有效凭据返回 null */
async function restore() {
  let raw;
  try {
    raw = await fs.readFile(PATHS.session);
  } catch (_) {
    return null;
  }
  const payload = decryptJson(raw);
  if (!payload || !payload.token || !payload.userId) {
    await clearSessionFile();
    return null;
  }
  if (!payload.expireAt || payload.expireAt <= Date.now()) {
    await clearSessionFile();
    return null;
  }
  const user = await userStore.findById(payload.userId);
  if (!user || user.deleted === '1' || user.status !== '1') {
    await clearSessionFile();
    return null;
  }
  sessions.set(String(payload.token), {
    userId: user.id,
    account: user.account,
    name: user.name,
    role: user.role,
    expireAt: Number(payload.expireAt),
  });
  return { token: String(payload.token), expireAt: Number(payload.expireAt), user: publicUser(user) };
}

module.exports = {
  login,
  logout,
  me,
  changePassword,
  resolveSession,
  invalidateUser,
  restore,
};
