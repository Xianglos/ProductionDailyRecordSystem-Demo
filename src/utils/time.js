'use strict';

/**
 * GMT+8（北京时间）时间工具。
 * 实现方式：对 UTC 时间戳整体偏移 +8h 后使用 UTC 取值器，
 * 因此结果与运行主机所在时区无关（《开发详细设计书》3.1）。
 */

const OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function shifted(input) {
  const base = input === undefined ? new Date() : input;
  const ms = base instanceof Date ? base.getTime() : Number(base);
  return new Date(ms + OFFSET_MS);
}

/** yyyy-MM-dd */
function formatDate(input) {
  const d = shifted(input);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** yyyy-MM-dd HH:mm */
function formatMinute(input) {
  const d = shifted(input);
  return `${formatDate(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** yyyy-MM-dd HH:mm:ss */
function formatDateTime(input) {
  const d = shifted(input);
  return `${formatMinute(d)}:${pad2(d.getUTCSeconds())}`;
}

/** 今日日期（GMT+8） */
function today() {
  return formatDate(new Date());
}

/** 当前分钟（GMT+8） */
function nowMinute() {
  return formatMinute(new Date());
}

/** 当前时间戳文本（GMT+8） */
function nowText() {
  return formatDateTime(new Date());
}

/** yyyy-MM-dd → yyyy */
function yearOf(date) {
  return String(date || '').slice(0, 4);
}

/** yyyy-MM-dd → yyyy-MM */
function monthOf(date) {
  return String(date || '').slice(0, 7);
}

/** 某年某月的天数 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

module.exports = {
  OFFSET_MS,
  formatDate,
  formatMinute,
  formatDateTime,
  today,
  nowMinute,
  nowText,
  yearOf,
  monthOf,
  daysInMonth,
};
