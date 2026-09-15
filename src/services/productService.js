'use strict';

/**
 * 品名维护服务（FR7）。
 * 编码全局唯一；已被日报引用的品名禁止删除（改用停用）；删除时级联删除其工艺模板。
 */

const { ACTION, ENTITY, LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const { newId } = require('../utils/id');
const { nowText } = require('../utils/time');
const num = require('../utils/number');
const productStore = require('../store/productStore');
const templateStore = require('../store/templateStore');
const reportStore = require('../store/reportStore');
const auditService = require('./auditService');

function publicProduct(row, used) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    used: !!used,
  };
}

/** 被日报引用的品名编码集合 */
async function usedCodeSet() {
  const headers = await reportStore.listHeaders();
  const set = new Set();
  for (const header of headers) {
    const code = String(header.product_code || '').trim().toLowerCase();
    if (code) set.add(code);
  }
  return set;
}

async function list(params = {}) {
  const keyword = String(params.keyword || '').trim().toLowerCase();
  const status = String(params.status === undefined || params.status === null ? '' : params.status).trim();

  const used = await usedCodeSet();
  let rows = await productStore.all();
  if (keyword) {
    rows = rows.filter((r) => String(r.code).toLowerCase().includes(keyword) || String(r.name).toLowerCase().includes(keyword));
  }
  if (status === '0' || status === '1') rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return rows.map((r) => publicProduct(r, used.has(String(r.code).toLowerCase())));
}

async function save(params = {}, currentUser) {
  const id = num.toText(params.id);
  const code = num.toText(params.code);
  const name = num.toText(params.name);
  const unit = num.toText(params.unit);
  const statusText = num.toText(params.status);
  const status = statusText === '' ? '1' : statusText;

  if (!code) throw BizError.badRequest('请输入品名编码');
  if (code.length > LIMITS.CODE_MAX) throw BizError.badRequest(`品名编码长度不能超过 ${LIMITS.CODE_MAX} 字符`);
  if (!name) throw BizError.badRequest('请输入品名名称');
  if (name.length > LIMITS.NAME_MAX) throw BizError.badRequest(`品名名称长度不能超过 ${LIMITS.NAME_MAX} 字`);
  if (unit.length > LIMITS.UNIT_MAX) throw BizError.badRequest(`计量单位长度不能超过 ${LIMITS.UNIT_MAX} 字`);
  if (status !== '0' && status !== '1') throw BizError.badRequest('状态不合法');

  const now = nowText();

  if (!id) {
    const duplicated = await productStore.findByCode(code);
    if (duplicated) throw BizError.conflict('品名编码已存在');
    const row = { id: newId(), code, name, unit, status, created_at: now, updated_at: now };
    await productStore.insert(row);
    await auditService.record({
      entity: ENTITY.PRODUCT,
      entityId: row.id,
      action: ACTION.INSERT,
      after: publicProduct(row, false),
      user: currentUser,
    });
    return publicProduct(row, false);
  }

  const existing = await productStore.findById(id);
  if (!existing) throw BizError.notFound('品名不存在');
  const duplicated = await productStore.findByCode(code);
  if (duplicated && duplicated.id !== id) throw BizError.conflict('品名编码已存在');

  const before = publicProduct(existing, false);
  const updated = await productStore.updateById(id, { code, name, unit, status, updated_at: now });
  const after = publicProduct(updated, false);
  await auditService.recordUpdate(ENTITY.PRODUCT, id, before, after, currentUser);

  // 品名编码变更时同步其工艺模板的关联编码，保持"一品一模板"关系不悬空
  if (before.code !== after.code) {
    const template = await templateStore.findByProductCode(before.code);
    if (template) {
      await templateStore.updateById(template.id, {
        product_code: after.code,
        updated_at: now,
      });
      await auditService.record({
        entity: ENTITY.TEMPLATE,
        entityId: template.id,
        action: ACTION.UPDATE,
        before: { product_code: before.code },
        after: { product_code: after.code, reason: '品名编码变更同步' },
        user: currentUser,
      });
    }
  }
  return after;
}

async function remove(id, currentUser) {
  const existing = await productStore.findById(num.toText(id));
  if (!existing) throw BizError.notFound('品名不存在');

  const used = await usedCodeSet();
  if (used.has(String(existing.code).toLowerCase())) {
    throw BizError.badRequest('该品名已被日报引用，禁止删除，请改为停用');
  }

  const before = publicProduct(existing, false);
  await productStore.replaceAll((await productStore.all()).filter((r) => r.id !== existing.id));
  await auditService.record({
    entity: ENTITY.PRODUCT,
    entityId: existing.id,
    action: ACTION.DELETE,
    before,
    user: currentUser,
  });

  // 级联删除工艺模板
  const removed = await templateStore.removeByProductCode(existing.code);
  if (removed) {
    await auditService.record({
      entity: ENTITY.TEMPLATE,
      entityId: existing.code,
      action: ACTION.DELETE,
      before: { product_code: existing.code, reason: '品名删除级联' },
      user: currentUser,
    });
  }
  return {};
}

/** 启用品名列表（登录用户均可使用） */
async function options() {
  const rows = await productStore.listActive();
  return rows
    .map((r) => ({ code: r.code, name: r.name, unit: r.unit, label: `${r.code} ${r.name}` }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

module.exports = { list, save, remove, options };
