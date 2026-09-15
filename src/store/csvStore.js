'use strict';

/**
 * 通用 CSV 存储（《开发详细设计书》4.2）。
 *   - 编码 UTF-8 带 BOM；所有字段双引号包裹（RFC4180）；LF 换行
 *   - 原子写：先写 .tmp 再 rename 覆盖
 *   - 串行写队列：以文件路径为键，保证同一文件的写操作按序、不交叉
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const BOM = '\uFEFF';

/** 写队列：filePath -> Promise */
const queues = new Map();
let tmpSeq = 0;

/**
 * 将任务排入指定文件的串行队列。
 * @param {string} key 队列键（文件绝对路径）
 * @param {() => Promise<any>} task 延迟执行的任务
 */
function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(() => task());
  // 队列自身永不 reject，避免一次失败阻塞后续写入
  queues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function unserialize(text) {
  if (!text) return [];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!body.trim()) return [];
  const rows = parse(body, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  // 补齐缺失列，统一为字符串
  return rows.map((row) => {
    const normalized = {};
    for (const key of Object.keys(row)) {
      normalized[key] = row[key] === undefined || row[key] === null ? '' : String(row[key]);
    }
    return normalized;
  });
}

function serialize(rows, columns) {
  const cols = columns && columns.length
    ? columns
    : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = rows.length
    ? stringify(rows, {
      header: true,
      columns: cols,
      quoted: true,
      quoted_empty: true,
      quoted_string: true,
      record_delimiter: '\n',
    })
    : `${cols.map((c) => `"${c}"`).join(',')}\n`;
  return BOM + body;
}

async function writeAtomic(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  tmpSeq += 1;
  const tmpPath = `${filePath}.${process.pid}.${tmpSeq}.tmp`;
  await fsp.writeFile(tmpPath, content, 'utf8');
  await fsp.rename(tmpPath, filePath);
}

/**
 * 读取 CSV → 对象数组；文件不存在返回 []。
 * @param {string} filePath
 * @returns {Promise<Array<Record<string,string>>>}
 */
async function read(filePath) {
  if (!(await exists(filePath))) return [];
  const text = await fsp.readFile(filePath, 'utf8');
  return unserialize(text);
}

/**
 * 覆盖写整表（原子 + 串行）。
 * @param {string} filePath
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} [columns] 列顺序；行数据为空时仍需表头
 */
function write(filePath, rows, columns) {
  return enqueue(filePath, () => writeAtomic(filePath, serialize(rows || [], columns)));
}

/**
 * 原子读改写：整个"读—改—写"在同一队列任务内完成，避免并发覆盖。
 * @param {string} filePath
 * @param {string[]} columns
 * @param {(rows: Array<Record<string,string>>) => (Array<Record<string,any>>|void|Promise<Array<Record<string,any>>|void>)} mutator
 *        返回新的行数组则整体替换；返回空则使用就地修改后的 rows。
 */
function update(filePath, columns, mutator) {
  return enqueue(filePath, async () => {
    const rows = (await exists(filePath))
      ? unserialize(await fsp.readFile(filePath, 'utf8'))
      : [];
    const result = await mutator(rows);
    const next = Array.isArray(result) ? result : rows;
    await writeAtomic(filePath, serialize(next, columns));
    return next;
  });
}

/**
 * 追加单行（供审计使用）。文件不存在时先写表头。
 */
function append(filePath, row, columns) {
  return enqueue(filePath, async () => {
    if (!(await exists(filePath))) {
      await writeAtomic(filePath, serialize([row], columns));
      return;
    }
    const line = stringify([row], {
      header: false,
      columns,
      quoted: true,
      record_delimiter: '\n',
    });
    await fsp.appendFile(filePath, line, 'utf8');
  });
}

/** 确保文件存在（不存在则写入仅含表头的空文件） */
function ensureFile(filePath, columns) {
  return enqueue(filePath, async () => {
    if (await exists(filePath)) return;
    await writeAtomic(filePath, serialize([], columns));
  });
}

module.exports = {
  BOM,
  exists,
  read,
  write,
  update,
  append,
  ensureFile,
};
