'use strict';

/**
 * 表存储工厂：在 csvStore 之上提供"表"级的通用读写。
 * 所有写操作均通过 csvStore 的串行写队列完成，保证原子性与顺序性。
 */

const csvStore = require('./csvStore');

/**
 * @param {string} file CSV 绝对路径
 * @param {string[]} columns 列顺序（决定表头）
 */
function createTable(file, columns) {
  const all = () => csvStore.read(file);
  const ensure = () => csvStore.ensureFile(file, columns);

  const findBy = async (predicate) => (await all()).find(predicate) || null;
  const filter = async (predicate) => (await all()).filter(predicate);

  const insert = async (row) => {
    await csvStore.update(file, columns, (rows) => {
      rows.push(row);
    });
    return row;
  };

  /** 按主键 id 局部更新，返回更新后的行（不存在返回 null） */
  const updateById = async (id, patch) => {
    let saved = null;
    await csvStore.update(file, columns, (rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) {
        Object.assign(rows[idx], patch);
        saved = rows[idx];
      }
    });
    return saved;
  };

  const replaceAll = (rows) => csvStore.write(file, rows, columns);
  const appendRow = (row) => csvStore.append(file, row, columns);

  return { file, columns, all, ensure, findBy, filter, insert, updateById, replaceAll, appendRow };
}

module.exports = { createTable };
