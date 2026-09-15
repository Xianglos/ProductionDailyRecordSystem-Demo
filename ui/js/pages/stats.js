'use strict';

/** 统计看板（FR9）。仅班组长/质量管理员/系统管理员可见。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  let currentMonth = null;

  function metricCard(label, value, unit, danger) {
    return `
      <div class="metric-card${danger ? ' is-danger' : ''}">
        <div class="metric-label">${U.escapeHtml(label)}</div>
        <div class="metric-value">${U.escapeHtml(value)}<span class="metric-unit">${U.escapeHtml(unit || '')}</span></div>
      </div>`;
  }

  function shell() {
    return `
      <div class="filter-bar">
        <label class="field"><span>统计月份</span><input type="month" id="st-month" value="${U.escapeHtml(currentMonth)}" /></label>
        <button class="btn btn-primary" id="st-refresh">查询</button>
        ${NS.app.can('export') ? '<button class="btn btn-ghost" id="st-export">导出当月 Excel</button>' : ''}
        <span class="muted" id="st-tip" style="padding-bottom:6px"></span>
      </div>
      <div class="metric-grid" id="st-cards"></div>
      <div class="chart-card">
        <h3>品名产量汇总（kg，当月）</h3>
        <div id="st-bar"></div>
      </div>
      <div class="chart-card">
        <h3>超限趋势（次，当年 1–12 月）</h3>
        <div id="st-line"></div>
      </div>`;
  }

  async function refresh(container) {
    const tip = U.qs('#st-tip', container);
    tip.textContent = '加载中…';
    try {
      const data = await NS.api.invoke('stats.monthly', { month: currentMonth });
      const cards = data.cards;

      U.qs('#st-cards', container).innerHTML = [
        metricCard('月度日报数', cards.reportCount, '份'),
        metricCard('产量汇总', cards.outputSum, 'kg'),
        metricCard('KOH 消耗', cards.kohSum, 'kg'),
        metricCard('乳酸消耗', cards.lacticSum, 'kg'),
        metricCard('超限次数', cards.warnCount, '次', cards.warnCount > 0),
      ].join('');

      U.qs('#st-bar', container).innerHTML = NS.charts.barChart(
        data.productOutput.map((item) => ({ label: item.label, value: item.output })),
      );
      U.qs('#st-line', container).innerHTML = NS.charts.lineChart(
        data.trend.map((item) => ({ label: item.label, value: item.count })),
      );

      tip.textContent = `统计月份 ${data.month}（共 ${data.months.length} 个有数据的月份）`;
    } catch (err) {
      tip.textContent = '';
      U.toast(err.message, 'error');
      U.showEmpty(U.qs('#st-cards', container), '统计数据加载失败');
    }
  }

  async function exportMonth() {
    const [year, month] = currentMonth.split('-');
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    try {
      const result = await NS.api.invoke('report.exportExcel', {
        from: `${currentMonth}-01`,
        to: `${currentMonth}-${String(lastDay).padStart(2, '0')}`,
      });
      U.toast(`已导出 ${result.count} 条记录：${result.path}`, 'success');
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  async function mount(container, params) {
    currentMonth = (params && params.month) || currentMonth || U.todayGmt8().slice(0, 7);
    container.innerHTML = shell();

    U.qs('#st-refresh', container).addEventListener('click', () => {
      currentMonth = U.qs('#st-month', container).value || currentMonth;
      refresh(container);
    });
    const exportBtn = U.qs('#st-export', container);
    if (exportBtn) exportBtn.addEventListener('click', exportMonth);

    await refresh(container);
  }

  NS.pages = NS.pages || {};
  NS.pages.stats = { mount };
}(window));
