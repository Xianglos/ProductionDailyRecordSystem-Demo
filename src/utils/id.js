'use strict';

const crypto = require('crypto');

/** 主键：字符串 UUID */
function newId() {
  return crypto.randomUUID();
}

/** 会话令牌：32 字节随机十六进制（64 字符） */
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { newId, newToken };
