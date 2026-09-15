'use strict';

/**
 * 日报页（FR2 / FR3 / FR5）。
 *   - 头部字段失焦/下拉变更后 300ms 防抖自动保存
 *   - 明细行字段变更后 400ms 防抖自动保存，保存后仅同步该行
 *   - 超限单元格红色高亮并展开"超限原因"输入
 *   - 跨日只读；删除生产记录需二次确认
 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  const ROW_COUNT = 15;
  const COLSPAN = 10;

  const state = {
    date: null,
    header: null,
    rows: [],
    template: null,
    editable: false,
    options: { users: [], operationTypes: [], products: [] },
    headerSaving: false,
    headerDirty: false,
    mounted: false,
  };

  const rowTimers = new Map();
  let root = null;

  /* ------------------------------ 数据构造 ------------------------------ */

  function blankRow(index) {
    const base = {
      id: '',
      operator_id: '',
      operator_name: '',
      record_time: '',
      operation_code: '',
      operation_name: '',
      top_temp: '',
      bottom_temp: '',
      pressure: '',
      eo_cum: '',
      warn: 0,
      warn_reason: '',
      remark: '',
      saved: false,
      saving: false,
      slot: index,
    };
    if (state.editable) {
      base.record_time = U.nowMinuteGmt8();
      const first = state.options.operationTypes[0];
      if (first) {
        base.operation_code = first.code;
        base.operation_name = first.name;
      }
    }
    return base;
  }

  function rowHasSubstance(row) {
    const fields = ['operator_id', 'top_temp', 'bottom_temp', 'pressure', 'eo_cum', 'remark', 'warn_reason'];
    return fields.some((key) => String(row[key] === undefined || row[key] === null ? '' : row[key]).trim() !== '');
  }

  /* ------------------------------ 超限判定 ------------------------------ */

  function overDirection(field, value) {
    const template = state.template;
    if (!template) return null;
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (text === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const prefix = field === 'top_temp' ? 'top' : field === 'bottom_temp' ? 'bottom' : 'pressure';
    const max = Number(template[`${prefix}_max`]);
    const min = Number(template[`${prefix}_min`]);
    const hasMax = template[`${prefix}_max`] !== undefined && String(template[`${prefix}_max`]).trim() !== '' && Number.isFinite(max);
    const hasMin = template[`${prefix}_min`] !== undefined && String(template[`${prefix}_min`]).trim() !== '' && Number.isFinite(min);
    if (hasMax && n > max) return 'high';
    if (hasMin && n < min) return 'low';
    return null;
  }

  function localWarn(row) {
    return ['top_temp', 'bottom_temp', 'pressure'].some((field) => overDirection(field, row[field]) !== null) ? 1 : 0;
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function buildShell() {
    const readonlyTip = state.editable
      ? ''
      : '<span class="pill pill-warn" id="rp-readonly">该日报已跨日，仅当日可编辑</span>';
    const todayPill = state.date === U.todayGmt8() ? '<span class="pill pill-today">今日</span>' : '';

    root.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>日报头部信息</h3>
          <div class="card-head-right">
            <span class="muted" id="hd-status"></span>
            <span class="pill" id="rp-date">${U.escapeHtml(state.date)}</span>
            ${todayPill}
            ${readonlyTip}
          </div>
        </div>
        <div class="form-grid">
          <label class="field"><span>品名</span><select id="hd-product"></select></label>
          <label class="field"><span>批号</span><input id="hd-batch" type="text" maxlength="64" placeholder="全局唯一，可空" /></label>
          <label class="field"><span>原料净重(kg)</span><input id="hd-raw" type="number" step="0.01" min="0" /></label>
          <label class="field"><span>EO净重(kg)</span><input id="hd-eo" type="number" step="0.01" min="0" /></label>
          <label class="field"><span>产量(kg)</span><input id="hd-output" type="number" step="0.01" min="0" /></label>
          <label class="field"><span>KOH用量(kg)</span><input id="hd-koh" type="number" step="0.01" min="0" /></label>
          <label class="field"><span>乳酸用量(kg)</span><input id="hd-lactic" type="number" step="0.01" min="0" /></label>
          <label class="field field-wide"><span>工作小结（≤1000 字）</span><textarea id="hd-summary" maxlength="1000"></textarea></label>
        </div>
        <div class="template-hint" id="template-hint"></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>生产记录（固定 ${ROW_COUNT} 行，按记录时间升序展示）</h3>
          <div class="card-head-right"><span class="muted" id="detail-hint"></span></div>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="width:38px">#</th>
                <th style="width:104px">操作员</th>
                <th style="width:158px">记录时间</th>
                <th style="width:118px">操作类型</th>
                <th style="width:84px">顶温(℃)</th>
                <th style="width:84px">底温(℃)</th>
                <th style="width:84px">压力</th>
                <th style="width:102px">EO累计量</th>
                <th>备注</th>
                <th style="width:62px">操作</th>
              </tr>
            </thead>
            <tbody id="detail-body"></tbody>
          </table>
        </div>
      </div>`;
  }

  function optionList(items, selected, placeholder, disabled, fieldName) {
    const head = `<option value="">${U.escapeHtml(placeholder)}</option>`;
    const body = items
      .map((item) => {
        const value = String(item.value);
        const isSelected = value === String(selected === undefined || selected === null ? '' : selected);
        return `<option value="${U.escapeHtml(value)}"${isSelected ? ' selected' : ''}>${U.escapeHtml(item.label)}</option>`;
      })
      .join('');
    return `<select data-field="${U.escapeHtml(fieldName || '')}"${disabled ? ' disabled' : ''}>${head}${body}</select>`;
  }

  function rowHtml(row, index) {
    const disabled = state.editable ? '' : ' disabled';
    const warnVisible = row.warn === 1;
    const operatorOptions = state.options.users.map((u) => ({ value: u.id, label: u.name }));
    const typeOptions = state.options.operationTypes.map((o) => ({ value: o.code, label: o.name }));

    return `
      <tr data-slot="${index}" class="${warnVisible ? 'row-warn' : ''}">
        <td class="row-index">${index + 1}</td>
        <td>${optionList(operatorOptions, row.operator_id, '选择操作员', !state.editable, 'operator_id')}</td>
        <td><input type="datetime-local" data-field="record_time" value="${U.escapeHtml(U.toInputDateTime(row.record_time))}"${disabled} /></td>
        <td>${optionList(typeOptions, row.operation_code, '选择类型', !state.editable, 'operation_code')}</td>
        <td><input type="number" step="0.01" data-field="top_temp" value="${U.escapeHtml(row.top_temp)}"${disabled} /></td>
        <td><input type="number" step="0.01" data-field="bottom_temp" value="${U.escapeHtml(row.bottom_temp)}"${disabled} /></td>
        <td><input type="number" step="0.01" data-field="pressure" value="${U.escapeHtml(row.pressure)}"${disabled} /></td>
        <td><input type="number" step="0.01" min="0" data-field="eo_cum" value="${U.escapeHtml(row.eo_cum)}"${disabled} /></td>
        <td><input type="text" maxlength="200" data-field="remark" value="${U.escapeHtml(row.remark)}"${disabled} /></td>
        <td class="ops">
          <button class="btn btn-ghost btn-sm" data-action="delete"${!state.editable || !row.saved ? ' disabled' : ''}>删除</button>
        </td>
      </tr>
      <tr data-slot="${index}" class="warn-reason-row${warnVisible ? '' : ' hidden'}">
        <td colspan="${COLSPAN}">
          <div class="warn-reason-box">
            <strong>超限原因<span class="required">*</span></strong>
            <input type="text" maxlength="200" data-field="warn_reason" value="${U.escapeHtml(row.warn_reason)}" placeholder="顶温/底温/压力超限时必须填写原因"${disabled} />
          </div>
        </td>
      </tr>`;
  }

  function renderRows() {
    const body = U.qs('#detail-body', root);
    body.innerHTML = state.rows.map((row, index) => rowHtml(row, index)).join('');
    state.rows.forEach((row, index) => patchRowVisual(index));
  }

  /** 仅重绘单个行槽（避免整表刷新导致其他行未提交的编辑内容丢失） */
  function renderSlot(slot) {
    const nodes = slotNodes(slot);
    if (!nodes.main) return;
    const holder = document.createElement('tbody');
    holder.innerHTML = rowHtml(state.rows[slot], slot);
    const newMain = holder.children[0];
    const newWarn = holder.children[1];
    nodes.main.replaceWith(newMain);
    if (newWarn) {
      if (nodes.warn) nodes.warn.replaceWith(newWarn);
      else newMain.after(newWarn);
    }
    patchRowVisual(slot);
  }

  function slotNodes(slot) {
    const main = U.qs(`tr[data-slot="${slot}"]:not(.warn-reason-row)`, root);
    const warn = U.qs(`tr.warn-reason-row[data-slot="${slot}"]`, root);
    return { main, warn };
  }

  function patchRowVisual(slot) {
    const row = state.rows[slot];
    const nodes = slotNodes(slot);
    if (!nodes.main) return;

    nodes.main.classList.toggle('row-warn', row.warn === 1);
    if (nodes.warn) nodes.warn.classList.toggle('hidden', row.warn !== 1);

    U.qsa('[data-field]', nodes.main).forEach((input) => {
      const field = input.dataset.field;
      if (!field) return;
      if (['top_temp', 'bottom_temp', 'pressure'].includes(field)) {
        input.classList.toggle('over', overDirection(field, row[field]) !== null);
      }
    });

    const deleteBtn = U.qs('button[data-action="delete"]', nodes.main);
    if (deleteBtn) deleteBtn.disabled = !state.editable || !row.saved;
  }

  function renderHeaderValues() {
    const header = state.header || {};
    const set = (id, value) => {
      const input = U.qs(id, root);
      if (input && document.activeElement !== input) input.value = value === undefined || value === null ? '' : value;
    };
    const productSelect = U.qs('#hd-product', root);
    productSelect.innerHTML = optionList(
      state.options.products.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })),
      header.product_code,
      '未选择品名',
      !state.editable,
    );
    set('#hd-batch', header.batch_no);
    set('#hd-raw', header.raw_weight);
    set('#hd-eo', header.eo_weight);
    set('#hd-output', header.output_weight);
    set('#hd-koh', header.koh);
    set('#hd-lactic', header.lactic_acid);
    const summary = U.qs('#hd-summary', root);
    if (summary && document.activeElement !== summary) summary.value = header.summary || '';
    renderTemplateHint();
  }

  function fmtRange(min, max, unit) {
    const hasMin = min !== undefined && min !== null && String(min).trim() !== '';
    const hasMax = max !== undefined && max !== null && String(max).trim() !== '';
    if (!hasMin && !hasMax) return '不限';
    if (hasMin && hasMax) return `${min} ~ ${max}${unit || ''}`;
    if (hasMin) return `≥ ${min}${unit || ''}`;
    return `≤ ${max}${unit || ''}`;
  }

  function renderTemplateHint() {
    const box = U.qs('#template-hint', root);
    const template = state.template;
    if (!template) {
      box.className = 'template-hint';
      box.innerHTML = state.header && state.header.product_code
        ? '所选品名<strong>未配置工艺模板</strong>，本次填报不触发超限比对。'
        : '尚未选择品名：未选择品名前不启用超限比对，建议先选择品名再填写生产记录。';
      return;
    }
    const overCount = computeOverCount();
    box.className = overCount > 0 ? 'template-hint is-over' : 'template-hint';
    box.innerHTML = `工艺模板　顶温 <strong>${U.escapeHtml(fmtRange(template.top_min, template.top_max, ' ℃'))}</strong>　`
      + `底温 <strong>${U.escapeHtml(fmtRange(template.bottom_min, template.bottom_max, ' ℃'))}</strong>　`
      + `压力 <strong>${U.escapeHtml(fmtRange(template.pressure_min, template.pressure_max, ''))}</strong>`
      + (overCount > 0 ? `　<span style="color:var(--danger)">当前有 ${overCount} 处数值超限，需填写超限原因</span>` : '');
  }

  function computeOverCount() {
    let count = 0;
    state.rows.forEach((row) => {
      ['top_temp', 'bottom_temp', 'pressure'].forEach((field) => {
        if (overDirection(field, row[field]) !== null) count += 1;
      });
    });
    return count;
  }

  /* ------------------------------ 读取与写入 ------------------------------ */

  function collectHeaderPayload() {
    const value = (id) => {
      const input = U.qs(id, root);
      return input ? input.value.trim() : '';
    };
    return {
      date: state.date,
      product_code: value('#hd-product'),
      batch_no: value('#hd-batch'),
      raw_weight: value('#hd-raw'),
      eo_weight: value('#hd-eo'),
      output_weight: value('#hd-output'),
      koh: value('#hd-koh'),
      lactic_acid: value('#hd-lactic'),
      summary: value('#hd-summary'),
    };
  }

  function setHeaderStatus(text, tone) {
    const box = U.qs('#hd-status', root);
    if (!box) return;
    box.textContent = text;
    box.style.color = tone === 'error' ? 'var(--danger)' : tone === 'ok' ? 'var(--success)' : '';
  }

  async function saveHeaderNow() {
    if (!state.editable) return;
    if (state.headerSaving) {
      state.headerDirty = true;
      return;
    }
    state.headerSaving = true;
    setHeaderStatus('保存中…');
    try {
      const data = await NS.api.invoke('report.saveHeader', collectHeaderPayload());
      state.header = data.header;
      state.template = data.template;
      renderHeaderValues();
      // 模板变化后重算所有已保存行的超限状态
      state.rows.forEach((row, index) => {
        if (!row.saved) return;
        row.warn = localWarn(row);
        patchRowVisual(index);
      });
      setHeaderStatus('已自动保存', 'ok');
      NS.app.scheduleTreeRefresh();
    } catch (err) {
      setHeaderStatus(err.message, 'error');
      U.toast(err.message, 'error');
    } finally {
      state.headerSaving = false;
      if (state.headerDirty) {
        state.headerDirty = false;
        saveHeaderNow();
      }
    }
  }

  const saveHeaderDebounced = U.debounce(saveHeaderNow, 300);

  function setRowStatus(slot, text) {
    const nodes = slotNodes(slot);
    if (!nodes.main) return;
    const cell = U.qs('td.ops', nodes.main);
    if (!cell) return;
    let tag = U.qs('.row-status', cell);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'row-status muted';
      tag.style.fontSize = '11px';
      tag.style.marginTop = '2px';
      cell.appendChild(tag);
    }
    tag.textContent = text || '';
    tag.title = text || '';
  }

  function selectedText(select) {
    const option = select.selectedOptions && select.selectedOptions[0];
    return option && select.value ? String(option.textContent || '').trim() : '';
  }

  function readRowFromDom(slot) {
    const nodes = slotNodes(slot);
    if (!nodes.main) return;
    const row = state.rows[slot];
    U.qsa('[data-field]', nodes.main).forEach((input) => {
      const field = input.dataset.field;
      if (!field) return;
      if (field === 'record_time') {
        row.record_time = U.fromInputDateTime(input.value);
      } else if (field === 'operator_id') {
        row.operator_id = input.value;
        row.operator_name = selectedText(input);
      } else if (field === 'operation_code') {
        row.operation_code = input.value;
        row.operation_name = selectedText(input);
      } else {
        row[field] = String(input.value === undefined || input.value === null ? '' : input.value).trim();
      }
    });
    const warnInput = nodes.warn ? U.qs('input[data-field="warn_reason"]', nodes.warn) : null;
    if (warnInput) row.warn_reason = warnInput.value.trim();
    row.warn = localWarn(row);
  }

  async function saveDetailRow(slot) {
    const row = state.rows[slot];
    if (!state.editable || !row) return;
    readRowFromDom(slot);
    patchRowVisual(slot);
    renderTemplateHint();

    if (!rowHasSubstance(row)) return;
    if (!row.record_time) {
      setRowStatus(slot, '请填写记录时间');
      return;
    }
    if (!row.operation_code) {
      setRowStatus(slot, '请选择操作类型');
      return;
    }
    if (row.warn === 1 && !row.warn_reason) {
      setRowStatus(slot, '超限需填写原因');
      return;
    }

    setRowStatus(slot, '保存中…');
    try {
      const data = await NS.api.invoke('report.saveDetail', {
        date: state.date,
        id: row.id,
        operator_id: row.operator_id,
        record_time: row.record_time,
        operation_code: row.operation_code,
        top_temp: row.top_temp,
        bottom_temp: row.bottom_temp,
        pressure: row.pressure,
        eo_cum: row.eo_cum,
        warn_reason: row.warn_reason,
        remark: row.remark,
      });
      const saved = data.detail;
      Object.assign(row, saved, { saved: true });
      // 回填服务端规整后的数值
      const nodes = slotNodes(slot);
      U.qsa('input[data-field]', nodes.main).forEach((input) => {
        const field = input.dataset.field;
        if (!field || field === 'record_time') return;
        if (document.activeElement !== input) input.value = row[field];
      });
      const warnInput = nodes.warn ? U.qs('input[data-field="warn_reason"]', nodes.warn) : null;
      if (warnInput && document.activeElement !== warnInput) warnInput.value = row.warn_reason;
      patchRowVisual(slot);
      renderTemplateHint();
      setRowStatus(slot, '已保存');
      NS.app.refreshTree();
    } catch (err) {
      setRowStatus(slot, '未保存');
      U.toast(err.message, 'error');
    }
  }

  function scheduleDetailSave(slot) {
    if (!rowTimers.has(slot)) {
      rowTimers.set(slot, U.debounce(() => saveDetailRow(slot), 400));
    }
    rowTimers.get(slot)();
  }

  async function deleteRow(slot) {
    const row = state.rows[slot];
    if (!row || !row.saved) return;
    const confirmed = await U.confirmDialog({
      title: '删除生产记录',
      message: `确认删除第 ${slot + 1} 行（${row.record_time || '无时间'}）的生产记录？该操作会记入审计日志且不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await NS.api.invoke('report.deleteDetail', { date: state.date, id: row.id });
      state.rows[slot] = blankRow(slot);
      renderSlot(slot);
      U.toast('生产记录已删除', 'success');
      NS.app.scheduleTreeRefresh();
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  const HEADER_INPUTS = ['#hd-product', '#hd-batch', '#hd-raw', '#hd-eo', '#hd-output', '#hd-koh', '#hd-lactic', '#hd-summary'];

  function bindEvents() {
    HEADER_INPUTS.forEach((selector) => {
      const input = U.qs(selector, root);
      if (!input) return;
      input.addEventListener('input', () => {
        if (selector === '#hd-product') return;
        saveHeaderDebounced();
      });
      input.addEventListener('change', saveHeaderDebounced);
      input.addEventListener('blur', saveHeaderDebounced);
    });

    const body = U.qs('#detail-body', root);
    body.addEventListener('input', (event) => {
      const cell = event.target.closest('tr[data-slot]');
      if (!cell) return;
      const slot = Number(cell.dataset.slot);
      scheduleDetailSave(slot);
    });
    body.addEventListener('change', (event) => {
      const cell = event.target.closest('tr[data-slot]');
      if (!cell) return;
      const slot = Number(cell.dataset.slot);
      scheduleDetailSave(slot);
    });
    body.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="delete"]');
      if (!button) return;
      const cell = button.closest('tr[data-slot]');
      if (!cell) return;
      deleteRow(Number(cell.dataset.slot));
    });
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  async function loadReport(date) {
    const user = NS.app.state.user;
    const isToday = date === U.todayGmt8();
    const writable = user && (user.role === 'OPERATOR' || user.role === 'ADMIN');
    if (isToday && writable) return NS.api.invoke('report.ensureToday');
    return NS.api.invoke('report.getByDate', { date });
  }

  async function mount(container, params) {
    root = container;
    const requested = (params && params.date) || U.todayGmt8();
    root.innerHTML = '<div class="empty-state">正在加载日报…</div>';

    try {
      const [options, data] = await Promise.all([
        NS.data.loadOptions(),
        loadReport(requested),
      ]);
      state.options = options;
      state.date = data.date;
      state.header = data.header;
      state.template = data.template;
      state.editable = !!data.editable;

      const details = data.details || [];
      state.rows = [];
      for (let i = 0; i < ROW_COUNT; i += 1) {
        state.rows.push(details[i] ? Object.assign({ saved: true, saving: false, slot: i }, details[i]) : blankRow(i));
      }

      state.mounted = true;
      buildShell();
      renderHeaderValues();
      renderRows();
      bindEvents();
    } catch (err) {
      U.toast(err.message, 'error');
      root.innerHTML = `<div class="empty-state">日报加载失败：${U.escapeHtml(err.message)}</div>`;
    }
  }

  NS.pages = NS.pages || {};
  NS.pages.report = { mount };
}(window));
