'use strict';

/**
 * 加解密工具（《开发详细设计书》9 安全设计）。
 *   - 密码：bcryptjs（纯 JS 实现，避免原生模块与打包兼容问题），cost = 10
 *   - 凭据：优先 Windows DPAPI；不可用时降级 AES-256-GCM
 *     （密钥由 hostname + 用户名 + 固定盐经 scrypt 派生，保证同机可用）
 */

const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { AUTH } = require('../config');

const TAG_DPAPI = Buffer.from('DPAPI1');
const TAG_AES = Buffer.from('AESGCM1');
const AES_SALT = 'pdr-desktop.session.v1';

let dpapi = null;
try {
  // 可选依赖；缺失时自动降级
  // eslint-disable-next-line global-require
  dpapi = require('dpapi');
} catch (_) {
  dpapi = null;
}

/* ------------------------------ 密码 ------------------------------ */

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), AUTH.BCRYPT_COST);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(plain), String(hash));
  } catch (_) {
    return false;
  }
}

/* ---------------------------- 凭据加解密 ---------------------------- */

function deriveKey() {
  let user = 'unknown';
  try {
    user = os.userInfo().username || user;
  } catch (_) {
    /* 忽略：无法获取用户名时退化为主机名派生 */
  }
  const seed = `${os.hostname()}::${user}::pdr`;
  return crypto.scryptSync(seed, AES_SALT, 32);
}

function aesEncrypt(plainBuffer) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([TAG_AES, iv, authTag, ciphertext]);
}

function aesDecrypt(raw) {
  const body = raw.subarray(TAG_AES.length);
  const iv = body.subarray(0, 12);
  const authTag = body.subarray(12, 28);
  const ciphertext = body.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 加密任意 Buffer，返回带算法标识的 Buffer */
function protectBuffer(plainBuffer) {
  if (dpapi && typeof dpapi.protectData === 'function') {
    try {
      const protectedData = dpapi.protectData(plainBuffer);
      if (Buffer.isBuffer(protectedData)) {
        return Buffer.concat([TAG_DPAPI, protectedData]);
      }
    } catch (_) {
      /* 降级到 AES */
    }
  }
  return aesEncrypt(plainBuffer);
}

/** 解密 protectBuffer 的产物；失败返回 null */
function unprotectBuffer(raw) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) return null;
  try {
    if (raw.subarray(0, TAG_DPAPI.length).equals(TAG_DPAPI)) {
      if (!dpapi || typeof dpapi.unprotectData !== 'function') return null;
      return dpapi.unprotectData(raw.subarray(TAG_DPAPI.length));
    }
    if (raw.subarray(0, TAG_AES.length).equals(TAG_AES)) {
      return aesDecrypt(raw);
    }
  } catch (_) {
    return null;
  }
  return null;
}

/** 加密 JSON 对象 */
function encryptJson(obj) {
  return protectBuffer(Buffer.from(JSON.stringify(obj), 'utf8'));
}

/** 解密 JSON 对象；失败返回 null */
function decryptJson(raw) {
  const buf = unprotectBuffer(raw);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (_) {
    return null;
  }
}

/** 当前实际使用的凭据加密算法，用于启动日志 */
function credentialCipherName() {
  return dpapi && typeof dpapi.protectData === 'function' ? 'Windows DPAPI' : 'AES-256-GCM';
}

module.exports = {
  hashPassword,
  verifyPassword,
  protectBuffer,
  unprotectBuffer,
  encryptJson,
  decryptJson,
  credentialCipherName,
};
