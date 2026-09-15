'use strict';

/**
 * 日报服务（FR2 / FR3 / FR5）。业务校验与事务边界的唯一落点。
 * 关键逻辑见《开发详细设计书》6.1–6.5。
 */

const { ACTION, ENTITY, LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const { newId } = require('../utils/id');
const { nowText, today } = require('../utils/time');
const num = require('../utils/number');
const reportValidator = require('../validators/reportValidator');
const reportStore = require('../store/reportStore');
const userStore = require('../store/userStore');
const operationTypeStore = require('../store/operationTypeStore');
const productStore = require('../store/productStore');
const templateService = require('./templateService');
const auditService = require('./auditService');

/* ------------------------------ 出参组装 ------------------------------ */

function emptyHeader(date) {
  return {
    report_date: date,
    product_code: '',
    product_name: '',
    batch_no: '',
    raw_weight: '',
    eo_weight: '',
    output_weight: '',
    koh: '',
    lactic_acid: '',
    summary: '',
    created_at: '',
    updated_at: '',
  };
}

function publicHeader(row, date) {
  const base = emptyHeader(date || row.report_date);
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (row[key] !== undefined && row[key] !== null) out[key] = String(row[key]);
  }
  out.report_date = date || row.report_date;
  return out;
}

function publicDetail(row) {
  return {
    id: row.id,
    report_date: row.report_date,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    record_time: row.record_time,
    operation_code: row.operation_code,
    operation_name: row.operation_name,
    top_temp: row.top_temp,
    bottom_temp: row.bottom_temp,
    pressure: row.pressure,
    eo_cum: row.eo_cum,
    warn: Number(row.warn) === 1 ? 1 : 0,
    warn_reason: row.warn_reason || '',
    remark: row.remark || '',
    recorder_id: row.recorder_id,
    recorder_name: row.recorder_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function byRecordTime(a, b) {
  const ta = String(a.record_time || '');
  const tb = String(b.record_time || '');
  if (ta === tb) return 0;
  return ta < tb ? -1 : 1;
}

/* ------------------------------ 通用守卫 ------------------------------ */

/** R6：仅当日且角色可写（服务层二次校验，避免仅依赖界面） */
function assertEditable(date, user) {
  reportStore.assertDate(date);
  if (reportValidator.isEditableDate(date, user)) return;
  if (date !== today()) throw BizError.forbidden('该日报已跨日，仅当日可编辑');
  throw BizError.forbidden('当前角色无日报填报权限');
}

/* ------------------------------ 读取 ------------------------------ */

/**
 * 懒创建（6.1）：当日日报不存在则仅创建表头，未点击"写今日日报"的日期不产生数据文件。
 */
async function ensureToday(user) {
  const date = today();
  if (!(await reportStore.headerExists(date))) {
    await reportStore.createEmpty(date);
  }
  return getByDate(date, user);
}

async function getByDate(date, user) {
  const value = reportStore.assertDate(date);
  const stored = await reportStore.readHeader(value);
  const header = stored ? publicHeader(stored, value) : emptyHeader(value);
  const details = (await reportStore.readDetails(value)).sort(byRecordTime).map(publicDetail);
  const template = header.product_code ? await templateService.getByProduct(header.product_code) : null;
  return {
    date: value,
    exists: !!stored,
    today: value === today(),
    editable: reportValidator.isEditableDate(value, user),
    header,
    details,
    template,
  };
}

/** 全量日报摘要（列表展示与 Excel 导出用，按日期倒序） */
async function list(user) {
  const headers = await reportStore.listHeaders();
  return headers
    .map((h) => ({
      date: h.report_date,
      product_code: h.product_code || '',
      product_name: h.product_name || '',
      batch_no: h.batch_no || '',
      output_weight: h.output_weight || '',
      today: h.report_date === today(),
      editable: reportValidator.isEditableDate(h.report_date, user),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* ------------------------------ 头部写入 ------------------------------ */

/**
 * 写入日报头部（6.2）。
 * 入参规整 → R1 批号唯一 → R7 长度 → 写文件 → 审计
 */
async function saveHeader(date, payload, user) {
  const value = reportStore.assertDate(date);
  assertEditable(value, user);

  const existing = await reportStore.readHeader(value);
  const fields = reportValidator.sanitizeHeader(payload);

  // 品名反规范化：名称以字典为准，不接受客户端传入
  // 按编码直查字典（含已停用品名），避免历史日报因品名停用而无法再次保存
  let productName = '';
  if (fields.product_code) {
    const product = await productStore.findByCode(fields.product_code);
    if (!product) throw BizError.badRequest('所选品名不存在，请刷新后重试');
    productName = product.name;
  }

  // R1：批号全局唯一（排除自身、空值跳过）
  const conflictDate = await reportStore.findBatchOwner(fields.batch_no, value);
  reportValidator.assertBatchUnique(fields.batch_no, conflictDate);

  const now = nowText();
  const row = {
    report_date: value,
    product_code: fields.product_code,
    product_name: productName,
    batch_no: fields.batch_no,
    raw_weight: fields.raw_weight,
    eo_weight: fields.eo_weight,
    output_weight: fields.output_weight,
    koh: fields.koh,
    lactic_acid: fields.lactic_acid,
    summary: fields.summary,
    created_at: existing && existing.created_at ? existing.created_at : now,
    updated_at: now,
  };
  await reportStore.writeHeader(row);

  // 品名变更导致模板变化时，重算既有明细的超限标记（6.4）
  if (existing && existing.product_code !== row.product_code) {
    await recomputeWarn(value, user);
  }

  await auditService.record({
    entity: ENTITY.REPORT_HEADER,
    entityId: value,
    action: existing ? ACTION.UPDATE : ACTION.INSERT,
    before: existing ? publicHeader(existing, value) : undefined,
    after: publicHeader(row, value),
    user,
  });

  return getByDate(value, user);
}

/**
 * 依据当前模板重算该日报全部明细的 warn。
 * 说明：若重算后某行变为超限且尚未填写原因，此处先落 warn=1（界面会立即展开"超限原因"输入框），
 * 待用户补填原因后经 saveDetail 的 R2 校验通过；统计口径按实际超限行数计算。
 */
async function recomputeWarn(date, user) {
  const header = await reportStore.readHeader(date);
  const template = header && header.product_code ? await templateService.getByProduct(header.product_code) : null;
  const changes = [];
  await reportStore.updateDetails(date, (rows) => {
    for (const row of rows) {
      const { warn, reasons } = reportValidator.computeWarn(row, template);
      if (Number(row.warn || 0) !== warn) {
        changes.push({ id: row.id, before: { warn: row.warn }, after: { warn, warn_reason: row.warn_reason, reasons: reasons.join('；') } });
        row.warn = String(warn);
        row.updated_at = nowText();
      }
    }
  });
  for (const change of changes) {
    await auditService.record({
      entity: ENTITY.REPORT_DETAIL,
      entityId: change.id,
      action: ACTION.UPDATE,
      before: change.before,
      after: change.after,
      user,
    });
  }
}

/* ------------------------------ 明细写入 ------------------------------ */

/**
 * 保存生产记录（6.3）。
 * 规整 → computeWarn → R2 → R3 → R4 → R5 → 新增/修改 → 写文件 → 审计
 */
async function saveDetail(date, payload, user) {
  const value = reportStore.assertDate(date);
  assertEditable(value, user);

  const fields = reportValidator.sanitizeDetail(payload);
  if (!fields.record_time) throw BizError.badRequest('请填写记录时间');
  if (!fields.operation_code) throw BizError.badRequest('请选择操作类型');

  const header = await reportStore.readHeader(value);
  const details = await reportStore.readDetails(value);

  // 反规范化：操作员与操作类型名称以字典为准
  let operatorName = '';
  if (fields.operator_id) {
    const operator = await userStore.findById(fields.operator_id);
    if (!operator || operator.deleted === '1') throw BizError.badRequest('所选操作员不存在，请刷新后重试');
    operatorName = operator.name;
  }
  const operationType = await operationTypeStore.findByCode(fields.operation_code);
  if (!operationType) throw BizError.badRequest('操作类型不存在，请刷新后重试');

  const template = header && header.product_code ? await templateService.getByProduct(header.product_code) : null;
  const { warn } = reportValidator.computeWarn(fields, template);

  // R2 / R3 / R4 / R5
  reportValidator.assertWarnReason(warn, fields.warn_reason);
  reportValidator.assertEoMonotonic(fields.eo_cum, fields.record_time, details, fields.id);
  reportValidator.assertEoWithinWeight(fields.eo_cum, header ? header.eo_weight : '');
  reportValidator.assertRecordTimeUnique(fields.record_time, details, fields.id);

  const existingRow = fields.id ? details.find((d) => d.id === fields.id) : null;
  if (fields.id && !existingRow) throw BizError.notFound('生产记录不存在或已被删除');
  if (!existingRow && details.length >= LIMITS.DETAIL_ROWS) {
    throw BizError.badRequest(`生产记录最多 ${LIMITS.DETAIL_ROWS} 行`);
  }

  const now = nowText();
  const row = {
    id: existingRow ? existingRow.id : newId(),
    report_date: value,
    operator_id: fields.operator_id,
    operator_name: operatorName,
    record_time: fields.record_time,
    operation_code: fields.operation_code,
    operation_name: operationType.name,
    top_temp: fields.top_temp,
    bottom_temp: fields.bottom_temp,
    pressure: fields.pressure,
    eo_cum: fields.eo_cum,
    warn: String(warn),
    warn_reason: warn === 1 ? fields.warn_reason : '',
    remark: fields.remark,
    recorder_id: user.id,
    recorder_name: user.name,
    created_at: existingRow ? existingRow.created_at : now,
    updated_at: now,
  };

  await reportStore.updateDetails(value, (rows) => {
    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
  });

  await auditService.record({
    entity: ENTITY.REPORT_DETAIL,
    entityId: row.id,
    action: existingRow ? ACTION.UPDATE : ACTION.INSERT,
    before: existingRow ? publicDetail(existingRow) : undefined,
    after: publicDetail(row),
    user,
  });

  return { detail: publicDetail(row) };
}

/** 删除生产记录（唯一需二次确认的操作） */
async function deleteDetail(date, id, user) {
  const value = reportStore.assertDate(date);
  assertEditable(value, user);

  const detailId = num.toText(id);
  if (!detailId) throw BizError.badRequest('缺少生产记录标识');

  const details = await reportStore.readDetails(value);
  const target = details.find((d) => d.id === detailId);
  if (!target) throw BizError.notFound('生产记录不存在');

  await reportStore.updateDetails(value, (rows) => {
    const idx = rows.findIndex((r) => r.id === detailId);
    if (idx >= 0) rows.splice(idx, 1);
  });

  await auditService.record({
    entity: ENTITY.REPORT_DETAIL,
    entityId: detailId,
    action: ACTION.DELETE,
    before: publicDetail(target),
    user,
  });

  return {};
}

module.exports = {
  ensureToday,
  getByDate,
  list,
  saveHeader,
  saveDetail,
  deleteDetail,
  publicHeader,
  publicDetail,
};
