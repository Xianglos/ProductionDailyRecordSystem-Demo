'use strict';

/**
 * 操作类型字典服务（FR8）。填报下拉取启用项并按 sort 升序。
 */

const { ACTION, ENTITY, LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const { newId } = require('../utils/id');
const { nowText } = require('../utils/time');
const num = require('../utils/number');
const operationTypeStore = require('../store/operationTypeStore');
const auditService = require('./auditService');

function publicItem(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sort: row.sort,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function list(params = {}) {
  const keyword = String(params.keyword || '').trim().toLowerCase();
  const status = String(params.status === undefined || params.status === null ? '' : params.status).trim();

  let rows = await operationTypeStore.all();
  if (keyword) {
    rows = rows.filter((r) => String(r.code).toLowerCase().includes(keyword) || String(r.name).toLowerCase().includes(keyword));
  }
  if (status === '0' || status === '1') rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  return rows.map(publicItem);
}

async function save(params = {}, currentUser) {
  const id = num.toText(params.id);
  const code = num.toText(params.code);
  const name = num.toText(params.name);
  const sortText = num.toText(params.sort);
  const statusText = num.toText(params.status);
  const status = statusText === '' ? '1' : statusText;
  const sort = sortText === '' ? '0' : sortText;

  if (!code) throw BizError.badRequest('请输入操作类型编码');
  if (code.length > LIMITS.CODE_MAX) throw BizError.badRequest(`编码长度不能超过 ${LIMITS.CODE_MAX} 字符`);
  if (!name) throw BizError.badRequest('请输入操作类型名称');
  if (name.length > LIMITS.NAME_MAX) throw BizError.badRequest(`名称长度不能超过 ${LIMITS.NAME_MAX} 字`);
  if (!/^-?\d+$/.test(sort)) throw BizError.badRequest('排序号必须为整数');
  if (status !== '0' && status !== '1') throw BizError.badRequest('状态不合法');

  const now = nowText();

  if (!id) {
    const duplicated = await operationTypeStore.findByCode(code);
    if (duplicated) throw BizError.conflict('操作类型编码已存在');
    const row = { id: newId(), code, name, sort, status, created_at: now, updated_at: now };
    await operationTypeStore.insert(row);
    await auditService.record({
      entity: ENTITY.OPERATION_TYPE,
      entityId: row.id,
      action: ACTION.INSERT,
      after: publicItem(row),
      user: currentUser,
    });
    return publicItem(row);
  }

  const existing = await operationTypeStore.findById(id);
  if (!existing) throw BizError.notFound('操作类型不存在');
  const duplicated = await operationTypeStore.findByCode(code);
  if (duplicated && duplicated.id !== id) throw BizError.conflict('操作类型编码已存在');

  const before = publicItem(existing);
  const updated = await operationTypeStore.updateById(id, { code, name, sort, status, updated_at: now });
  const after = publicItem(updated);
  await auditService.recordUpdate(ENTITY.OPERATION_TYPE, id, before, after, currentUser);
  return after;
}

/** 启用项（按 sort 升序），填报下拉数据源 */
async function options() {
  const rows = await operationTypeStore.listActiveSorted();
  return rows.map((r) => ({ code: r.code, name: r.name, sort: r.sort }));
}

module.exports = { list, save, options };
