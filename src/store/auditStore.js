'use strict';

const { PATHS } = require('../config');
const { createTable } = require('./tableStore');

const COLUMNS = [
  'id',
  'entity',
  'entity_id',
  'action',
  'operator_id',
  'operator_account',
  'host',
  'before',
  'after',
  'created_at',
];

const table = createTable(PATHS.audit, COLUMNS);

module.exports = {
  COLUMNS,
  file: PATHS.audit,
  ensure: table.ensure,
  all: table.all,

  /**
   * 仅追加写入（审计不可篡改：不提供任何修改/删除入口）。
   */
  append(row) {
    return table.appendRow(row);
  },
};
