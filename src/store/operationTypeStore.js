'use strict';

const { PATHS } = require('../config');
const { createTable } = require('./tableStore');

const COLUMNS = ['id', 'code', 'name', 'sort', 'status', 'created_at', 'updated_at'];

const table = createTable(PATHS.operationTypes, COLUMNS);

module.exports = {
  COLUMNS,
  file: PATHS.operationTypes,
  ensure: table.ensure,
  all: table.all,
  replaceAll: table.replaceAll,
  insert: table.insert,
  updateById: table.updateById,

  async findById(id) {
    if (!id) return null;
    return table.findBy((r) => r.id === id);
  },

  async findByCode(code) {
    if (!code) return null;
    const key = String(code).toLowerCase();
    return table.findBy((r) => String(r.code).toLowerCase() === key);
  },

  /** 启用项，按 sort 升序（FR8） */
  async listActiveSorted() {
    const rows = await table.all();
    return rows
      .filter((r) => r.status === '1')
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  },
};
