'use strict';

/**
 * 日报存储：头部（一天一行）与生产记录明细（0–15 行）。
 * 文件布局见《开发详细设计书》3.2：
 *   data/reports/YYYY/YYYY-MM-DD.csv          日报头部
 *   data/reports/YYYY/YYYY-MM-DD.details.csv  日报生产记录明细
 */

const fsp = require('fs').promises;
const path = require('path');

const csvStore = require('./csvStore');
const { PATHS } = require('../config');
const { LIMITS } = require('../constants');
const { BizError } = require('../utils/error');

const HEADER_COLUMNS = [
  'report_date',
  'product_code',
  'product_name',
  'batch_no',
  'raw_weight',
  'eo_weight',
  'output_weight',
  'koh',
  'lactic_acid',
  'summary',
  'created_at',
  'updated_at',
];

const DETAIL_COLUMNS = [
  'id',
  'report_date',
  'operator_id',
  'operator_name',
  'record_time',
  'operation_code',
  'operation_name',
  'top_temp',
  'bottom_temp',
  'pressure',
  'eo_cum',
  'warn',
  'warn_reason',
  'remark',
  'recorder_id',
  'recorder_name',
  'created_at',
  'updated_at',
];

/** 日期白名单校验，防路径穿越（9 安全设计） */
function assertDate(date) {
  const value = String(date || '');
  if (!LIMITS.DATE_RE.test(value)) {
    throw BizError.badRequest('报告日期格式非法');
  }
  return value;
}

function yearDir(date) {
  return path.join(PATHS.reports, date.slice(0, 4));
}

function headerFile(date) {
  return path.join(yearDir(assertDate(date)), `${date}.csv`);
}

function detailFile(date) {
  return path.join(yearDir(assertDate(date)), `${date}.details.csv`);
}

async function headerExists(date) {
  return csvStore.exists(headerFile(date));
}

/** 读取日报头部；不存在返回 null */
async function readHeader(date) {
  const rows = await csvStore.read(headerFile(date));
  return rows[0] || null;
}

/** 创建仅含表头的空日报文件（懒创建，6.1） */
async function createEmpty(date) {
  await csvStore.write(headerFile(date), [], HEADER_COLUMNS);
}

/** 写入日报头部（存在即覆盖该行） */
async function writeHeader(row) {
  await csvStore.update(headerFile(row.report_date), HEADER_COLUMNS, (rows) => {
    if (rows.length) rows[0] = row;
    else rows.push(row);
  });
  return row;
}

async function readDetails(date) {
  return csvStore.read(detailFile(date));
}

async function writeDetails(date, rows) {
  await csvStore.write(detailFile(date), rows, DETAIL_COLUMNS);
  return rows;
}

/** 明细的原子读改写 */
async function updateDetails(date, mutator) {
  return csvStore.update(detailFile(date), DETAIL_COLUMNS, mutator);
}

/** 扫描 data/reports 下全部日报日期（升序） */
async function listDates() {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(PATHS.reports, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !LIMITS.YEAR_RE.test(entry.name)) continue;
    const dir = path.join(PATHS.reports, entry.name);
    let files = [];
    try {
      files = await fsp.readdir(dir);
    } catch (_) {
      continue;
    }
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.csv')) continue;
      if (file.includes('.details.')) continue;
      const date = file.slice(0, -4);
      if (LIMITS.DATE_RE.test(date)) out.push(date);
    }
  }
  return out.sort();
}

/** 全部日报头部（日期升序）；无头部数据的日期以最小对象占位 */
async function listHeaders() {
  const dates = await listDates();
  const headers = [];
  for (const date of dates) {
    const header = await readHeader(date);
    headers.push(header || { report_date: date });
  }
  return headers;
}

/**
 * 批号全局唯一（R1）：跨 reports/ 全量扫描，排除自身、跳过空值。
 * @returns {Promise<string|null>} 冲突所在日期
 */
async function findBatchOwner(batchNo, excludeDate) {
  const batch = String(batchNo || '').trim();
  if (!batch) return null;
  const dates = await listDates();
  for (const date of dates) {
    if (excludeDate && date === excludeDate) continue;
    const header = await readHeader(date);
    if (header && String(header.batch_no).trim() === batch) return date;
  }
  return null;
}

module.exports = {
  HEADER_COLUMNS,
  DETAIL_COLUMNS,
  assertDate,
  headerFile,
  detailFile,
  headerExists,
  readHeader,
  createEmpty,
  writeHeader,
  readDetails,
  writeDetails,
  updateDetails,
  listDates,
  listHeaders,
  findBatchOwner,
};
