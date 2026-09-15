'use strict';

/**
 * 自绘 SVG 图表（无第三方依赖，7.1 统计看板）。
 * 浅色主题：浅底 + 深字，超限相关使用红色。
 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});

  const COLORS = {
    axis: '#94a3b8',
    grid: '#e5eaf1',
    text: '#1f2937',
    muted: '#6b7280',
    bar: '#2f7fe0',
    barTop: '#4f95ea',
    line: '#2f7fe0',
    area: 'rgba(47,127,224,0.14)',
    danger: '#c0392b',
  };

  const W = 680;
  const H = 260;
  const PAD = { top: 24, right: 24, bottom: 46, left: 56 };

  function esc(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function niceMax(value) {
    if (!value || value <= 0) return 10;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const normalized = value / base;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * base;
  }

  function frame(inner) {
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
  }

  function axisLines(max, formatTick) {
    const plotTop = PAD.top;
    const plotBottom = H - PAD.bottom;
    const plotHeight = plotBottom - plotTop;
    let out = '';
    for (let i = 0; i <= 4; i += 1) {
      const y = plotBottom - (plotHeight * i) / 4;
      const value = (max * i) / 4;
      out += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>`;
      out += `<text x="${PAD.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="${COLORS.muted}">${esc(formatTick ? formatTick(value) : Math.round(value))}</text>`;
    }
    return out;
  }

  /**
   * 柱状图。
   * @param {Array<{label:string, value:number}>} items
   * @param {{emptyText?:string, unit?:string}} [options]
   */
  function barChart(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return frame(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="${COLORS.muted}">暂无数据</text>`);
    }
    const max = niceMax(Math.max.apply(null, list.map((i) => Number(i.value) || 0)));
    const plotTop = PAD.top;
    const plotBottom = H - PAD.bottom;
    const plotWidth = W - PAD.left - PAD.right;
    const slot = plotWidth / list.length;
    const barWidth = Math.max(10, Math.min(46, slot * 0.55));

    let bars = '';
    list.forEach((item, index) => {
      const value = Number(item.value) || 0;
      const height = max === 0 ? 0 : ((plotBottom - plotTop) * value) / max;
      const x = PAD.left + slot * index + (slot - barWidth) / 2;
      const y = plotBottom - height;
      const label = String(item.label || '');
      const shortLabel = label.length > 10 ? `${label.slice(0, 9)}…` : label;
      bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(height, value > 0 ? 2 : 0)}" rx="3" fill="${COLORS.bar}"/>`;
      bars += `<text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="10.5" fill="${COLORS.text}">${esc(value)}</text>`;
      bars += `<text x="${x + barWidth / 2}" y="${plotBottom + 18}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${esc(shortLabel)}</text>`;
    });

    return frame(
      axisLines(max, (v) => `${Math.round(v)}`) +
      `<line x1="${PAD.left}" y1="${plotBottom}" x2="${W - PAD.right}" y2="${plotBottom}" stroke="${COLORS.axis}" stroke-width="1"/>` +
      bars,
    );
  }

  /**
   * 折线图。
   * @param {Array<{label:string, value:number}>} items
   * @param {{emptyText?:string}} [options]
   */
  function lineChart(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return frame(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="${COLORS.muted}">暂无数据</text>`);
    }
    const max = niceMax(Math.max.apply(null, list.map((i) => Number(i.value) || 0)));
    const plotTop = PAD.top;
    const plotBottom = H - PAD.bottom;
    const plotWidth = W - PAD.left - PAD.right;
    const step = list.length > 1 ? plotWidth / (list.length - 1) : 0;

    const points = list.map((item, index) => ({
      x: PAD.left + step * index,
      y: plotBottom - (max === 0 ? 0 : ((plotBottom - plotTop) * (Number(item.value) || 0)) / max),
      value: Number(item.value) || 0,
      label: String(item.label || ''),
    }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${plotBottom} L${points[0].x.toFixed(1)},${plotBottom} Z`;

    let marks = '';
    points.forEach((p) => {
      const isWarn = p.value > 0;
      marks += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${isWarn ? COLORS.danger : COLORS.line}" stroke="#ffffff" stroke-width="1.5"/>`;
      if (isWarn) {
        marks += `<text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${COLORS.danger}">${esc(p.value)}</text>`;
      }
      marks += `<text x="${p.x.toFixed(1)}" y="${plotBottom + 18}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${esc(p.label)}</text>`;
    });

    return frame(
      axisLines(max, (v) => `${Math.round(v)}`) +
      `<line x1="${PAD.left}" y1="${plotBottom}" x2="${W - PAD.right}" y2="${plotBottom}" stroke="${COLORS.axis}" stroke-width="1"/>` +
      `<path d="${areaPath}" fill="${COLORS.area}" stroke="none"/>` +
      `<path d="${linePath}" fill="none" stroke="${COLORS.line}" stroke-width="2"/>` +
      marks,
    );
  }

  NS.charts = { barChart, lineChart };
}(window));
