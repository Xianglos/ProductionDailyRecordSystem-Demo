'use strict';

const { PATHS } = require('../config');
const { createTable } = require('./tableStore');

const COLUMNS = [
  'id',
  'account',
  'name',
  'password_hash',
  'role',
  'phone',
  'status',
  'deleted',
  'created_at',
  'updated_at',
];

const table = createTable(PATHS.users, COLUMNS);

module.exports = {
  COLUMNS,
  file: PATHS.users,
  ensure: table.ensure,
  all: table.all,
  replaceAll: table.replaceAll,
  insert: table.insert,
  updateById: table.updateById,

  async findById(id) {
    if (!id) return null;
    return table.findBy((r) => r.id === id);
  },

  async findByAccount(account) {
    if (!account) return null;
    const key = String(account).toLowerCase();
    return table.findBy((r) => String(r.account).toLowerCase() === key);
  },

  async listActive() {
    const rows = await table.all();
    return rows.filter((r) => r.deleted !== '1' && r.status === '1');
  },
};
