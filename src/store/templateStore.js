'use strict';

const { PATHS } = require('../config');
const { createTable } = require('./tableStore');

const COLUMNS = [
  'id',
  'product_code',
  'top_max',
  'top_min',
  'bottom_max',
  'bottom_min',
  'pressure_max',
  'pressure_min',
  'valid_from',
  'valid_to',
  'created_at',
  'updated_at',
];

const table = createTable(PATHS.templates, COLUMNS);

module.exports = {
  COLUMNS,
  file: PATHS.templates,
  ensure: table.ensure,
  all: table.all,
  replaceAll: table.replaceAll,
  insert: table.insert,
  updateById: table.updateById,

  /** 一品一模板：按品名编码查询 */
  async findByProductCode(code) {
    if (!code) return null;
    const key = String(code).toLowerCase();
    return table.findBy((r) => String(r.product_code).toLowerCase() === key);
  },

  async removeByProductCode(code) {
    if (!code) return 0;
    const key = String(code).toLowerCase();
    let removed = 0;
    await table.replaceAll(
      (await table.all()).filter((r) => {
        if (String(r.product_code).toLowerCase() === key) {
          removed += 1;
          return false;
        }
        return true;
      }),
    );
    return removed;
  },
};
