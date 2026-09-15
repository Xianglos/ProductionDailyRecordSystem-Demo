'use strict';

/**
 * 数值规整工具。
 * 约定（3.1）：统一规整为 2 位小数存储；空值存空字符串。
 */

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/** 是否可解析为有限数值 */
function isNumeric(value) {
  if (isEmpty(value)) return false;
  const n = Number(String(value).trim());
  return Number.isFinite(n);
}

/**
 * 规整为 2 位小数字符串；空值返回 ''。
 * @returns {string} 规整结果；非法数值返回 null（由调用方判定为校验失败）
 */
function toFixed2(value) {
  if (isEmpty(value)) return '';
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** 转数值，空值返回 null，非法返回 NaN */
function toNumber(value) {
  if (isEmpty(value)) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : NaN;
}

/** 规整为纯文本（去除首尾空白），空值返回 '' */
function toText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** 规整为 0/1 标记，非法返回 '' */
function toFlag(value) {
  const s = toText(value);
  if (s === '1' || s === 'true' || s === 'TRUE') return '1';
  if (s === '0' || s === 'false' || s === 'FALSE') return '0';
  return '';
}

/** 数值求和（空值按 0 计） */
function sum(values) {
  let total = 0;
  for (const v of values) {
    const n = toNumber(v);
    if (n !== null && !Number.isNaN(n)) total += n;
  }
  return Number(total.toFixed(2));
}

module.exports = {
  isEmpty,
  isNumeric,
  toFixed2,
  toNumber,
  toText,
  toFlag,
  sum,
};
