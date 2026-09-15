'use strict';

/** 审计日志（FR11）：仅追加、不可改删；支持业务类型/操作类型/记录标识/操作人过滤与分页。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  const ENTITIES = [
    { value: 'report_header', label: '日报头部' },
    { value: 'report_detail', label: '生产记录' },
    { value: 'product', label: '品名' },
    { value: 'template', label: '工艺模板' },
    { value: 'operation_type', label: '操作类型' },
    { value: 'user', label: '用户' },
  ];

  const ACTIONS = [
    { value: 'INSERT', label: '新增' },
    { value: 'UPDATE', label: '修改' },
    { value: 'DELETE', label: '删除' },
  ];

  const query = { entity: '', action: '', entityId: '', operatorId: '', page: 1, size: 20 };
  let containerRef = null;
  let operatorOptions = [{ value: '', label: '全部' }];

  function selectHtml(id, options, value) {
    return `<select id="${id}">${options
      .map((item) => `<option value="${U.escapeHtml(item.value)}"${String(item.value) === String(value || '') ? ' selected' : ''}>${U.escapeHtml(item.label)}</option>`)
      .join('')}</select>`;
  }

  function actionPill(action, label) {
    const cls = action === 'DELETE' ? 'pill-warn' : action === 'INSERT' ? 'pill-ok' : 'pill';
    return `<span class="pill ${cls}">${U.escapeHtml(label || action)}</span>`;
  }

  function preview(json) {
    if (!json) return '<span class="muted">—</span>';
    const text = String(json);
    const short = text.length > 46 ? `${text.slice(0, 45)}…` : text;
    return `<span class="audit-json" title="${U.escapeHtml(text)}">${U.escapeHtml(short)}</span>`;
  }

  function showJson(title, json) {
    let pretty = json || '';
    try {
      pretty = JSON.stringify(JSON.parse(json), null, 2);
    } catch (_) {
      pretty = String(json || '');
    }
    U.openModal({
      title,
      width: 620,
      bodyHtml: `<pre class="json-view">${U.escapeHtml(pretty)}</pre>`,
      footer: [{ text: '关闭', className: 'btn-ghost' }],
    });
  }

  function shell() {
    return `
      <div class="card">
        <div class="filter-bar">
          <label class="field"><span>业务类型</span>${selectHtml('a-entity', [{ value: '', label: '全部' }].concat(ENTITIES), query.entity)}</label>
          <label class="field"><span>操作类型</span>${selectHtml('a-action', [{ value: '', label: '全部' }].concat(ACTIONS), query.action)}</label>
          <label class="field"><span>记录标识</span><input type="text" id="a-entity-id" value="${U.escapeHtml(query.entityId)}" placeholder="模糊匹配" /></label>
          <label class="field"><span>操作人</span>${selectHtml('a-operator', operatorOptions, query.operatorId)}</label>
          <button class="btn btn-primary" id="a-search">查询</button>
          <button class="btn btn-ghost" id="a-reset">重置</button>
        </div>
        <div class="toolbar"><span class="muted" id="a-total"></span><span class="muted">审计日志仅追加，不提供修改与删除入口</span></div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="width:158px">操作时间</th>
                <th style="width:100px">业务类型</th>
                <th style="width:72px">操作</th>
                <th style="width:190px">记录标识</th>
                <th style="width:130px">操作人</th>
                <th style="width:130px">来源主机</th>
                <th>改前 / 改后</th>
              </tr>
            </thead>
            <tbody id="a-rows"></tbody>
          </table>
        </div>
        <div class="pager">
          <span id="a-page-info"></span>
          <span class="spacer"></span>
          <label class="field" style="margin:0"><span>每页</span>${selectHtml('a-size', [10, 20, 50].map((n) => ({ value: String(n), label: String(n) })), String(query.size))}</label>
          <button class="btn btn-ghost btn-sm" id="a-prev">上一页</button>
          <button class="btn btn-ghost btn-sm" id="a-next">下一页</button>
        </div>
      </div>`;
  }

  async function load() {
    const body = containerRef;
    try {
      const result = await NS.api.invoke('audit.query', query);
      const totalPages = Math.max(1, Math.ceil(result.total / result.size));
      if (query.page > totalPages) query.page = totalPages;
      U.qs('#a-total', body).textContent = `共 ${result.total} 条，第 ${result.page} / ${totalPages} 页`;
      U.qs('#a-page-info', body).textContent = `当前显示 ${result.rows.length} 条`;

      const tbody = U.qs('#a-rows', body);
      if (result.rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">暂无审计记录</div></td></tr>';
        return;
      }
      tbody.innerHTML = result.rows
        .map((row) => `
          <tr>
            <td>${U.escapeHtml(row.created_at)}</td>
            <td>${U.escapeHtml(row.entity_label)}</td>
            <td>${actionPill(row.action, row.action_label)}</td>
            <td title="${U.escapeHtml(row.entity_id)}">${U.escapeHtml(String(row.entity_id).slice(0, 26))}</td>
            <td>${U.escapeHtml(row.operator_account || '—')}</td>
            <td>${U.escapeHtml(row.host || '—')}</td>
            <td data-id="${U.escapeHtml(row.id)}">${preview(row.before)} ${preview(row.after)}</td>
          </tr>`)
        .join('');

      U.qsa('#a-rows tr', body).forEach((tr, index) => {
        tr.addEventListener('click', () => {
          const row = result.rows[index];
          showJson(`审计详情 · ${row.entity_label} / ${row.action_label}`, JSON.stringify({
            业务类型: row.entity_label,
            操作类型: row.action_label,
            记录标识: row.entity_id,
            操作人: row.operator_account,
            来源主机: row.host,
            操作时间: row.created_at,
            改前: row.before || null,
            改后: row.after || null,
          }, null, 2));
        });
      });
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  async function mount(container) {
    containerRef = container;
    try {
      const options = await NS.api.invoke('user.options');
      operatorOptions = [{ value: '', label: '全部' }].concat(
        options.map((u) => ({ value: u.id, label: `${u.name}（${u.account}）` })),
      );
    } catch (_) {
      operatorOptions = [{ value: '', label: '全部' }];
    }

    container.innerHTML = shell();

    U.qs('#a-search', container).addEventListener('click', () => {
      query.entity = U.qs('#a-entity', container).value;
      query.action = U.qs('#a-action', container).value;
      query.entityId = U.qs('#a-entity-id', container).value.trim();
      query.operatorId = U.qs('#a-operator', container).value;
      query.page = 1;
      load();
    });
    U.qs('#a-reset', container).addEventListener('click', () => {
      query.entity = '';
      query.action = '';
      query.entityId = '';
      query.operatorId = '';
      query.page = 1;
      mount(container);
    });
    U.qs('#a-size', container).addEventListener('change', (event) => {
      query.size = Number(event.target.value) || 20;
      query.page = 1;
      load();
    });
    U.qs('#a-prev', container).addEventListener('click', () => {
      if (query.page > 1) {
        query.page -= 1;
        load();
      }
    });
    U.qs('#a-next', container).addEventListener('click', () => {
      query.page += 1;
      load();
    });

    await load();
  }

  NS.pages = NS.pages || {};
  NS.pages.audit = { mount };
}(window));
