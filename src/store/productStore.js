'use strict';

const { PATHS } = require('../config');
const { createTable } = require('./tableStore');

const COLUMNS = ['id', 'code', 'name', 'unit', 'status', 'created_at', 'updated_at'];

const table = createTable(PATHS.products, COLUMNS);

module.exports = {
  COLUMNS,
  file: PATHS.products,
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

  async listActive() {
    const rows = await table.all();
    return rows.filter((r) => r.status === '1');
  },
};
