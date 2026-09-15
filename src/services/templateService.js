'use strict';

/**
 * 工艺模板服务（FR6）。
 * 一品一模板：以 product_code 唯一标识，保存时 upsert。
 */

const { ACTION, ENTITY, LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const { newId } = require('../utils/id');
const { nowText } = require('../utils/time');
const num = require('../utils/number');
const reportValidator = require('../validators/reportValidator');
const templateStore = require('../store/templateStore');
const productStore = require('../store/productStore');
const auditService = require('./auditService');

const RANGE_KEYS = ['top_min', 'top_max', 'bottom_min', 'bottom_max', 'pressure_min', 'pressure_max'];

function publicTemplate(row, productName) {
  return {
    id: row.id,
    product_code: row.product_code,
    product_name: productName || '',
    top_min: row.top_min,
    top_max: row.top_max,
    bottom_min: row.bottom_min,
    bottom_max: row.bottom_max,
    pressure_min: row.pressure_min,
    pressure_max: row.pressure_max,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assertRange(label, min, max) {
  if (min !== '' && max !== '' && Number(min) > Number(max)) {
    throw BizError.badRequest(`${label}下限不能大于上限`);
  }
}

async function list() {
  const rows = await templateStore.all();
  const products = await productStore.all();
  const nameMap = new Map(products.map((p) => [String(p.code).toLowerCase(), p.name]));
  return rows
    .map((r) => publicTemplate(r, nameMap.get(String(r.product_code).toLowerCase()) || ''))
    .sort((a, b) => (a.product_code < b.product_code ? -1 : a.product_code > b.product_code ? 1 : 0));
}

/** 按品名编码查询模板；不存在返回 null */
async function getByProduct(productCode) {
  const code = num.toText(productCode);
  if (!code) return null;
  const row = await templateStore.findByProductCode(code);
  if (!row) return null;
  const product = await productStore.findByCode(row.product_code);
  return publicTemplate(row, product ? product.name : '');
}

/**
 * 保存（upsert）模板。
 * @param {object} params
 * @param {object} currentUser
 * @param {{silent?: boolean}} [opts] silent=true 时由调用方负责审计（用于品名改码同步）
 */
async function save(params = {}, currentUser, opts = {}) {
  const productCode = num.toText(params.product_code);
  if (!productCode) throw BizError.badRequest('请选择品名');
  if (productCode.length > LIMITS.CODE_MAX) throw BizError.badRequest('品名编码过长');

  const product = await productStore.findByCode(productCode);
  if (!product) throw BizError.badRequest('品名不存在，请先维护品名');

  const values = {};
  for (const key of RANGE_KEYS) {
    values[key] = reportValidator.sanitizeNumber(params[key], KEY_LABEL[key], { allowNegative: true, max: 100000 });
  }
  assertRange('顶温', values.top_min, values.top_max);
  assertRange('底温', values.bottom_min, values.bottom_max);
  assertRange('压力', values.pressure_min, values.pressure_max);

  const validFrom = num.toText(params.valid_from);
  const validTo = num.toText(params.valid_to);
  if (validFrom && !LIMITS.DATE_RE.test(validFrom)) throw BizError.badRequest('有效期起始日期格式非法');
  if (validTo && !LIMITS.DATE_RE.test(validTo)) throw BizError.badRequest('有效期截止日期格式非法');
  if (validFrom && validTo && validFrom > validTo) throw BizError.badRequest('有效期起始日期不能晚于截止日期');

  const now = nowText();
  const existing = await templateStore.findByProductCode(productCode);

  // 一品一模板：以 product_code 为自然主键，id 变化时清理历史行
  if (existing) {
    const before = publicTemplate(existing, product.name);
    const updated = await templateStore.updateById(existing.id, {
      ...values,
      valid_from: validFrom,
      valid_to: validTo,
      updated_at: now,
    });
    const after = publicTemplate(updated, product.name);
    if (!opts.silent) {
      await auditService.recordUpdate(ENTITY.TEMPLATE, existing.id, before, after, currentUser);
    }
    return after;
  }

  const row = {
    id: newId(),
    product_code: productCode,
    ...values,
    valid_from: validFrom,
    valid_to: validTo,
    created_at: now,
    updated_at: now,
  };
  await templateStore.insert(row);
  const created = publicTemplate(row, product.name);
  if (!opts.silent) {
    await auditService.record({
      entity: ENTITY.TEMPLATE,
      entityId: row.id,
      action: ACTION.INSERT,
      after: created,
      user: currentUser,
    });
  }
  return created;
}

const KEY_LABEL = {
  top_min: '顶温下限',
  top_max: '顶温上限',
  bottom_min: '底温下限',
  bottom_max: '底温上限',
  pressure_min: '压力下限',
  pressure_max: '压力上限',
};

module.exports = { list, getByProduct, save };
