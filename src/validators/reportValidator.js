'use strict';

/**
 * 日报校验器：字段规整 + R1–R7 权威校验（《开发详细设计书》4.3 / 6.5）。
 *
 * 本模块只做"纯判定"：需要的外部数据（模板、同日报其余明细、批号扫描结果）
 * 一律由服务层查询后作为参数传入，保证校验逻辑可独立推理与测试。
 */

const { LIMITS, WRITE_ROLES } = require('../constants');
const { BizError } = require('../utils/error');
const num = require('../utils/number');
const time = require('../utils/time');

/** 温压字段 → 模板字段前缀 */
const RANGE_FIELDS = [
  { field: 'top_temp', label: '顶温', prefix: 'top', unit: '℃' },
  { field: 'bottom_temp', label: '底温', prefix: 'bottom', unit: '℃' },
  { field: 'pressure', label: '压力', prefix: 'pressure', unit: '' },
];

/* ------------------------------ 通用规整 ------------------------------ */

function sanitizeText(raw, label, maxLength) {
  const text = num.toText(raw);
  if (maxLength && text.length > maxLength) {
    throw BizError.badRequest(`${label}长度不能超过 ${maxLength} 字`);
  }
  return text;
}

function sanitizeNumber(raw, label, options = {}) {
  const { allowNegative = false, max = 1e9 } = options;
  const text = num.toText(raw);
  if (text === '') return '';
  const value = num.toFixed2(text);
  if (value === null) throw BizError.badRequest(`${label}必须为数字`);
  const n = Number(value);
  if (!allowNegative && n < 0) throw BizError.badRequest(`${label}不能为负数`);
  if (Math.abs(n) > max) throw BizError.badRequest(`${label}超出合理范围`);
  return value;
}

/* ------------------------------ 头部规整 ------------------------------ */

/**
 * 规整日报头部入参。
 * 注意：product_name 由服务层依据 product_code 反规范化写入，不接受客户端传入。
 */
function sanitizeHeader(input) {
  const raw = input || {};
  const header = {
    product_code: sanitizeText(raw.product_code, '品名编码', LIMITS.CODE_MAX),
    batch_no: sanitizeText(raw.batch_no, '批号', LIMITS.BATCH_MAX),
    raw_weight: sanitizeNumber(raw.raw_weight, '原料净重'),
    eo_weight: sanitizeNumber(raw.eo_weight, 'EO净重'),
    output_weight: sanitizeNumber(raw.output_weight, '产量'),
    koh: sanitizeNumber(raw.koh, 'KOH用量'),
    lactic_acid: sanitizeNumber(raw.lactic_acid, '乳酸用量'),
    summary: sanitizeText(raw.summary, '工作小结', LIMITS.SUMMARY_MAX),
  };
  return header;
}

/* ------------------------------ 明细规整 ------------------------------ */

function sanitizeDetail(input) {
  const raw = input || {};
  const recordTime = sanitizeText(raw.record_time, '记录时间');
  if (recordTime && !LIMITS.MINUTE_RE.test(recordTime)) {
    throw BizError.badRequest('记录时间格式应为 yyyy-MM-dd HH:mm');
  }
  return {
    id: sanitizeText(raw.id, '明细标识'),
    operator_id: sanitizeText(raw.operator_id, '操作员'),
    record_time: recordTime,
    operation_code: sanitizeText(raw.operation_code, '操作类型', LIMITS.CODE_MAX),
    top_temp: sanitizeNumber(raw.top_temp, '顶温', { allowNegative: true }),
    bottom_temp: sanitizeNumber(raw.bottom_temp, '底温', { allowNegative: true }),
    pressure: sanitizeNumber(raw.pressure, '压力', { allowNegative: true, max: 1000 }),
    eo_cum: sanitizeNumber(raw.eo_cum, 'EO累计量'),
    warn_reason: sanitizeText(raw.warn_reason, '超限原因', LIMITS.WARN_REASON_MAX),
    remark: sanitizeText(raw.remark, '备注', LIMITS.REMARK_MAX),
  };
}

/** 判断明细行是否填写了实质内容（用于界面判定是否触发保存） */
function hasSubstance(detail) {
  const fields = ['operator_id', 'top_temp', 'bottom_temp', 'pressure', 'eo_cum', 'remark', 'warn_reason'];
  return fields.some((f) => num.toText(detail[f]) !== '');
}

/* ------------------------------ 超限计算 ------------------------------ */

/**
 * 超限计算（6.4）：无模板或字段为空则不计该项；单边留空表示不限。
 * @returns {{warn: 0|1, reasons: string[]}}
 */
function computeWarn(detail, template) {
  if (!template) return { warn: 0, reasons: [] };
  const reasons = [];
  for (const { field, label, prefix, unit } of RANGE_FIELDS) {
    const text = num.toText(detail[field]);
    if (text === '') continue;
    const value = Number(text);
    if (!Number.isFinite(value)) continue;
    const max = num.toNumber(template[`${prefix}_max`]);
    const min = num.toNumber(template[`${prefix}_min`]);
    if (max !== null && Number.isFinite(max) && value > max) {
      reasons.push(`${label} ${value}${unit} 高于上限 ${max}${unit}`);
    }
    if (min !== null && Number.isFinite(min) && value < min) {
      reasons.push(`${label} ${value}${unit} 低于下限 ${min}${unit}`);
    }
  }
  return { warn: reasons.length ? 1 : 0, reasons };
}

/** 单字段超限方向，供界面单元格高亮使用 */
function fieldOverDirection(template, field, value) {
  if (!template) return null;
  const text = num.toText(value);
  if (text === '') return null;
  const meta = RANGE_FIELDS.find((item) => item.field === field);
  if (!meta) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const max = num.toNumber(template[`${meta.prefix}_max`]);
  const min = num.toNumber(template[`${meta.prefix}_min`]);
  if (max !== null && Number.isFinite(max) && n > max) return 'high';
  if (min !== null && Number.isFinite(min) && n < min) return 'low';
  return null;
}

/* ------------------------------ R1–R7 ------------------------------ */

/** R1：批号全局唯一（冲突日期由服务层扫描得出） */
function assertBatchUnique(batchNo, conflictDate) {
  if (batchNo && conflictDate) {
    throw BizError.conflict(`批号「${batchNo}」已在 ${conflictDate} 的日报中使用，批号必须全局唯一`);
  }
}

/** R5：记录时间日报内唯一（精确到分钟） */
function assertRecordTimeUnique(recordTime, details, selfId) {
  if (!recordTime) return;
  const duplicated = details.some(
    (d) => d.id !== selfId && String(d.record_time).trim() === recordTime,
  );
  if (duplicated) {
    throw BizError.conflict(`记录时间 ${recordTime} 在本日报中已存在，记录时间不可重复`);
  }
}

/** R2：超限必须填写原因 */
function assertWarnReason(warn, warnReason) {
  if (warn === 1 && num.toText(warnReason) === '') {
    throw BizError.badRequest('顶温/底温/压力已超出工艺模板限值，请填写超限原因');
  }
}

/** R3：EO 累计量单调不减（按记录时间升序比较） */
function assertEoMonotonic(eoValue, recordTime, details, selfId) {
  const text = num.toText(eoValue);
  const points = details
    .filter((d) => d.id !== selfId && num.toText(d.eo_cum) !== '' && num.toText(d.record_time) !== '')
    .map((d) => ({ time: String(d.record_time).trim(), value: Number(d.eo_cum) }));
  if (text !== '' && recordTime) {
    points.push({ time: recordTime, value: Number(text) });
  }
  points.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].value < points[i - 1].value) {
      throw BizError.badRequest(
        `EO 累计量必须单调不减：${points[i].time} 的 ${points[i].value} 小于 ${points[i - 1].time} 的 ${points[i - 1].value}`,
      );
    }
  }
}

/** R4：EO 累计量 ≤ EO 净重（仅当头部已填 EO 净重） */
function assertEoWithinWeight(eoValue, eoWeight) {
  const weight = num.toNumber(eoWeight);
  if (weight === null || !Number.isFinite(weight)) return;
  const value = num.toNumber(eoValue);
  if (value === null || !Number.isFinite(value)) return;
  if (value > weight) {
    throw BizError.badRequest(`EO 累计量 ${value} 不能超过 EO 净重 ${weight}`);
  }
}

/** R6：仅当日且角色可写 */
function isEditableDate(date, user) {
  if (!user || !date) return false;
  return WRITE_ROLES.includes(user.role) && date === time.today();
}

module.exports = {
  RANGE_FIELDS,
  sanitizeHeader,
  sanitizeDetail,
  sanitizeText,
  sanitizeNumber,
  hasSubstance,
  computeWarn,
  fieldOverDirection,
  assertBatchUnique,
  assertRecordTimeUnique,
  assertWarnReason,
  assertEoMonotonic,
  assertEoWithinWeight,
  isEditableDate,
};
