'use strict';

/**
 * 统计服务（FR9 / 6.7）。统计口径：按日报日期归属月份。
 */

const { LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const num = require('../utils/number');
const time = require('../utils/time');
const reportStore = require('../store/reportStore');

/**
 * 月度统计。
 * @param {{month?: string}} params month 形如 yyyy-MM，缺省为当前月
 */
async function monthly(params = {}) {
  const month = num.toText(params.month) || time.monthOf(time.today());
  if (!LIMITS.MONTH_RE.test(month)) throw BizError.badRequest('月份格式应为 yyyy-MM');
  const year = month.slice(0, 4);

  const headers = (await reportStore.listHeaders()).filter((h) => LIMITS.DATE_RE.test(h.report_date));
  const yearHeaders = headers.filter((h) => h.report_date.slice(0, 4) === year);
  const monthHeaders = yearHeaders.filter((h) => h.report_date.slice(0, 7) === month);

  /** 明细读取缓存，避免同一日期重复读盘 */
  const detailCache = new Map();
  async function detailsOf(date) {
    if (!detailCache.has(date)) {
      detailCache.set(date, await reportStore.readDetails(date));
    }
    return detailCache.get(date);
  }

  async function warnCountOf(list) {
    let count = 0;
    for (const header of list) {
      const rows = await detailsOf(header.report_date);
      count += rows.filter((r) => Number(r.warn) === 1).length;
    }
    return count;
  }

  // 指标卡片
  let outputSum = 0;
  let kohSum = 0;
  let lacticSum = 0;
  for (const header of monthHeaders) {
    outputSum += safeNumber(header.output_weight);
    kohSum += safeNumber(header.koh);
    lacticSum += safeNumber(header.lactic_acid);
  }
  const warnCount = await warnCountOf(monthHeaders);

  // 品名产量：按 product_code 分组求和，降序
  const groups = new Map();
  for (const header of monthHeaders) {
    const code = String(header.product_code || '').trim();
    const key = code || '__UNFILLED__';
    if (!groups.has(key)) {
      groups.set(key, { code, name: String(header.product_name || '').trim(), output: 0 });
    }
    const group = groups.get(key);
    group.output += safeNumber(header.output_weight);
  }
  const productOutput = Array.from(groups.values())
    .map((g) => ({
      code: g.code,
      name: g.name,
      label: g.code ? `${g.code} ${g.name}`.trim() : '未填品名',
      output: Number(g.output.toFixed(2)),
    }))
    .sort((a, b) => b.output - a.output);

  // 超限趋势：当年 1–12 月逐月超限明细行数
  const trend = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const list = yearHeaders.filter((h) => h.report_date.slice(0, 7) === key);
    trend.push({ month: key, label: `${m}月`, count: await warnCountOf(list) });
  }

  // 有数据的月份，供界面月份选择
  const months = Array.from(new Set(headers.map((h) => h.report_date.slice(0, 7)))).sort().reverse();

  return {
    month,
    year,
    cards: {
      reportCount: monthHeaders.length,
      outputSum: Number(outputSum.toFixed(2)),
      kohSum: Number(kohSum.toFixed(2)),
      lacticSum: Number(lacticSum.toFixed(2)),
      warnCount,
    },
    productOutput,
    trend,
    months,
  };
}

function safeNumber(value) {
  const n = num.toNumber(value);
  return n === null || Number.isNaN(n) ? 0 : n;
}

module.exports = { monthly };
