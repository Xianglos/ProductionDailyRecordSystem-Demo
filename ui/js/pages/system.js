'use strict';

/** 系统管理（FR6 / FR7 / FR8 / FR12）：用户、品名、工艺模板、操作类型字典。仅系统管理员可见。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  const ROLES = [
    { value: 'OPERATOR', label: '操作工' },
    { value: 'LEADER', label: '班组长' },
    { value: 'QA', label: '质量管理员' },
    { value: 'ADMIN', label: '系统管理员' },
  ];

  const TABS = [
    { key: 'user', label: '用户管理' },
    { key: 'product', label: '品名维护' },
    { key: 'template', label: '工艺模板' },
    { key: 'operationType', label: '操作类型字典' },
  ];

  const state = { tab: 'user', container: null };

  function selectHtml(id, options, value, placeholder, disabled) {
    const head = placeholder ? `<option value="">${U.escapeHtml(placeholder)}</option>` : '';
    const body = options
      .map((item) => `<option value="${U.escapeHtml(item.value)}"${String(item.value) === String(value || '') ? ' selected' : ''}>${U.escapeHtml(item.label)}</option>`)
      .join('');
    return `<select id="${id}"${disabled ? ' disabled' : ''}>${head}${body}</select>`;
  }

  function statusText(value) {
    return value === '1'
      ? '<span class="pill pill-ok">启用</span>'
      : '<span class="pill">停用</span>';
  }

  function shell() {
    return `
      <div class="tabs">
        ${TABS.map((tab) => `<button class="tab${tab.key === state.tab ? ' active' : ''}" data-tab="${tab.key}">${tab.label}</button>`).join('')}
      </div>
      <div id="sys-body"></div>`;
  }

  function bindTabs(container) {
    U.qsa('.tab', container).forEach((button) => {
      button.addEventListener('click', () => {
        state.tab = button.dataset.tab;
        U.qsa('.tab', container).forEach((item) => item.classList.toggle('active', item === button));
        renderTab();
      });
    });
  }

  /* ============================== 用户 ============================== */

  const userQuery = { account: '', name: '', role: '', status: '', page: 1, size: 10 };

  async function renderUser() {
    const body = U.qs('#sys-body', state.container);
    body.innerHTML = `
      <div class="card">
        <div class="filter-bar">
          <label class="field"><span>账号</span><input type="text" id="q-account" value="${U.escapeHtml(userQuery.account)}" /></label>
          <label class="field"><span>姓名</span><input type="text" id="q-name" value="${U.escapeHtml(userQuery.name)}" /></label>
          <label class="field"><span>角色</span>${selectHtml('q-role', ROLES, userQuery.role, '全部')}</label>
          <label class="field"><span>状态</span>${selectHtml('q-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], userQuery.status, '全部')}</label>
          <button class="btn btn-primary" id="q-search">查询</button>
          <button class="btn btn-ghost" id="q-reset">重置</button>
        </div>
        <div class="toolbar">
          <span class="muted" id="user-total"></span>
          <button class="btn btn-primary btn-sm" id="user-add">新增用户</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>电话</th><th style="width:80px">状态</th><th style="width:230px">操作</th></tr></thead>
            <tbody id="user-rows"></tbody>
          </table>
        </div>
        <div class="pager">
          <span id="user-page-info"></span>
          <span class="spacer"></span>
          <label class="field" style="margin:0"><span>每页</span>${selectHtml('user-size', [10, 20, 50].map((n) => ({ value: String(n), label: String(n) })), String(userQuery.size), '')}</label>
          <button class="btn btn-ghost btn-sm" id="user-prev">上一页</button>
          <button class="btn btn-ghost btn-sm" id="user-next">下一页</button>
        </div>
      </div>`;

    U.qs('#q-search', body).addEventListener('click', () => {
      userQuery.account = U.qs('#q-account', body).value.trim();
      userQuery.name = U.qs('#q-name', body).value.trim();
      userQuery.role = U.qs('#q-role', body).value;
      userQuery.status = U.qs('#q-status', body).value;
      userQuery.page = 1;
      loadUsers();
    });
    U.qs('#q-reset', body).addEventListener('click', () => {
      userQuery.account = '';
      userQuery.name = '';
      userQuery.role = '';
      userQuery.status = '';
      userQuery.page = 1;
      renderUser();
    });
    U.qs('#user-size', body).addEventListener('change', (event) => {
      userQuery.size = Number(event.target.value) || 10;
      userQuery.page = 1;
      loadUsers();
    });
    U.qs('#user-add', body).addEventListener('click', () => openUserForm(null));
    U.qs('#user-prev', body).addEventListener('click', () => {
      if (userQuery.page > 1) {
        userQuery.page -= 1;
        loadUsers();
      }
    });
    U.qs('#user-next', body).addEventListener('click', () => {
      userQuery.page += 1;
      loadUsers();
    });

    U.qs('#user-rows', body).addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.act === 'edit') openUserForm(button.dataset.row ? userRowsCache[Number(button.dataset.row)] : null);
      if (button.dataset.act === 'reset') openResetPassword(id, button.dataset.account);
      if (button.dataset.act === 'del') removeUser(id, button.dataset.account);
    });

    await loadUsers();
  }

  let userRowsCache = [];

  async function loadUsers() {
    const body = U.qs('#sys-body', state.container);
    const result = await NS.api.invoke('user.list', userQuery);
    userRowsCache = result.rows;
    const totalPages = Math.max(1, Math.ceil(result.total / result.size));
    if (userQuery.page > totalPages) userQuery.page = totalPages;

    U.qs('#user-total', body).textContent = `共 ${result.total} 条，第 ${result.page} / ${totalPages} 页`;
    U.qs('#user-page-info', body).textContent = `当前显示 ${result.rows.length} 条`;

    const tbody = U.qs('#user-rows', body);
    if (result.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">暂无用户</div></td></tr>`;
      return;
    }
    tbody.innerHTML = result.rows
      .map((row, index) => `
        <tr>
          <td>${U.escapeHtml(row.account)}</td>
          <td>${U.escapeHtml(row.name)}</td>
          <td>${U.escapeHtml(row.role_label || U.roleLabel(row.role))}</td>
          <td>${U.escapeHtml(U.valueOrDash(row.phone))}</td>
          <td>${statusText(row.status)}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${U.escapeHtml(row.id)}" data-row="${index}">编辑</button>
            <button class="btn btn-ghost btn-sm" data-act="reset" data-id="${U.escapeHtml(row.id)}" data-account="${U.escapeHtml(row.account)}">重置密码</button>
            <button class="btn btn-ghost btn-sm" data-act="del" data-id="${U.escapeHtml(row.id)}" data-account="${U.escapeHtml(row.account)}">删除</button>
          </td>
        </tr>`)
      .join('');
  }

  function openUserForm(row) {
    const isEdit = !!row;
    const bodyHtml = `
      <div class="form-row">
        <label class="field"><span>账号</span><input type="text" id="f-account" maxlength="50" value="${U.escapeHtml(row ? row.account : '')}" ${isEdit ? 'readonly' : ''} placeholder="字母数字下划线 3–50 位" /></label>
        <label class="field"><span>姓名</span><input type="text" id="f-name" maxlength="100" value="${U.escapeHtml(row ? row.name : '')}" /></label>
        <label class="field"><span>角色</span>${selectHtml('f-role', ROLES, row ? row.role : 'OPERATOR', '')}</label>
        <label class="field"><span>电话</span><input type="text" id="f-phone" maxlength="30" value="${U.escapeHtml(row ? row.phone || '' : '')}" /></label>
        <label class="field"><span>状态</span>${selectHtml('f-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], row ? row.status : '1', '')}</label>
        ${isEdit ? '' : '<label class="field"><span>初始密码</span><input type="text" id="f-password" maxlength="32" placeholder="留空默认 123456" /></label>'}
        <div class="field-full form-error" id="f-error"></div>
      </div>`;

    U.openModal({
      title: isEdit ? `编辑用户 · ${row.account}` : '新增用户',
      bodyHtml,
      width: 620,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '保存',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            const payload = {
              id: row ? row.id : '',
              account: U.qs('#f-account', root).value.trim(),
              name: U.qs('#f-name', root).value.trim(),
              role: U.qs('#f-role', root).value,
              phone: U.qs('#f-phone', root).value.trim(),
              status: U.qs('#f-status', root).value,
            };
            const passwordInput = U.qs('#f-password', root);
            if (passwordInput) payload.password = passwordInput.value.trim();
            try {
              await NS.api.invoke('user.save', payload);
              ctx.modal.close();
              NS.data.invalidate();
              U.toast('用户已保存', 'success');
              loadUsers();
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  function openResetPassword(id, account) {
    U.openModal({
      title: `重置密码 · ${account}`,
      bodyHtml: `
        <label class="field"><span>新密码</span><input type="text" id="f-newpwd" maxlength="32" placeholder="留空重置为 123456" /></label>
        <p class="muted" style="font-size:12.5px;margin:0">重置后该账号的登录状态将立即失效，需使用新密码重新登录。</p>
        <div class="form-error" id="f-error"></div>`,
      width: 460,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '确认重置',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            try {
              await NS.api.invoke('user.resetPassword', { id, password: U.qs('#f-newpwd', root).value.trim() });
              ctx.modal.close();
              U.toast('密码已重置', 'success');
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  async function removeUser(id, account) {
    const confirmed = await U.confirmDialog({
      title: '删除用户',
      message: `确认删除用户「${account}」？删除为逻辑删除，历史数据不受影响，该账号将立即无法登录。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await NS.api.invoke('user.delete', { id });
      NS.data.invalidate();
      U.toast('用户已删除', 'success');
      loadUsers();
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /* ============================== 品名 ============================== */

  const productQuery = { keyword: '', status: '' };

  async function renderProduct() {
    const body = U.qs('#sys-body', state.container);
    body.innerHTML = `
      <div class="card">
        <div class="filter-bar">
          <label class="field"><span>关键字</span><input type="text" id="q-keyword" value="${U.escapeHtml(productQuery.keyword)}" placeholder="编码或名称" /></label>
          <label class="field"><span>状态</span>${selectHtml('q-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], productQuery.status, '全部')}</label>
          <button class="btn btn-primary" id="q-search">查询</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary btn-sm" id="product-add">新增品名</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th style="width:130px">编码</th><th>名称</th><th style="width:90px">单位</th><th style="width:80px">状态</th><th style="width:110px">是否被引用</th><th style="width:150px">操作</th></tr></thead>
            <tbody id="product-rows"></tbody>
          </table>
        </div>
      </div>`;

    U.qs('#q-search', body).addEventListener('click', () => {
      productQuery.keyword = U.qs('#q-keyword', body).value.trim();
      productQuery.status = U.qs('#q-status', body).value;
      loadProducts();
    });
    U.qs('#q-keyword', body).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') U.qs('#q-search', body).click();
    });
    U.qs('#product-add', body).addEventListener('click', () => openProductForm(null));
    body.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      if (button.dataset.act === 'edit') openProductForm(productRowsCache[Number(button.dataset.row)]);
      if (button.dataset.act === 'del') removeProduct(button.dataset.id, button.dataset.code);
    });

    await loadProducts();
  }

  let productRowsCache = [];

  async function loadProducts() {
    const body = U.qs('#sys-body', state.container);
    const rows = await NS.api.invoke('product.list', productQuery);
    productRowsCache = rows;
    const tbody = U.qs('#product-rows', body);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无品名</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row, index) => `
        <tr>
          <td>${U.escapeHtml(row.code)}</td>
          <td>${U.escapeHtml(row.name)}</td>
          <td>${U.escapeHtml(U.valueOrDash(row.unit))}</td>
          <td>${statusText(row.status)}</td>
          <td>${row.used ? '<span class="pill pill-today">已被日报引用</span>' : '<span class="muted">未引用</span>'}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-act="edit" data-row="${index}">编辑</button>
            <button class="btn btn-ghost btn-sm" data-act="del" data-id="${U.escapeHtml(row.id)}" data-code="${U.escapeHtml(row.code)}">删除</button>
          </td>
        </tr>`)
      .join('');
  }

  function openProductForm(row) {
    const isEdit = !!row;
    U.openModal({
      title: isEdit ? `编辑品名 · ${row.code}` : '新增品名',
      width: 560,
      bodyHtml: `
        <div class="form-row">
          <label class="field"><span>品名编码（全局唯一）</span><input type="text" id="f-code" maxlength="64" value="${U.escapeHtml(row ? row.code : '')}" /></label>
          <label class="field"><span>品名名称</span><input type="text" id="f-name" maxlength="100" value="${U.escapeHtml(row ? row.name : '')}" /></label>
          <label class="field"><span>计量单位</span><input type="text" id="f-unit" maxlength="20" value="${U.escapeHtml(row ? row.unit || '' : 'kg')}" /></label>
          <label class="field"><span>状态</span>${selectHtml('f-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], row ? row.status : '1', '')}</label>
          <div class="field-full form-error" id="f-error"></div>
        </div>`,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '保存',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            try {
              await NS.api.invoke('product.save', {
                id: row ? row.id : '',
                code: U.qs('#f-code', root).value.trim(),
                name: U.qs('#f-name', root).value.trim(),
                unit: U.qs('#f-unit', root).value.trim(),
                status: U.qs('#f-status', root).value,
              });
              ctx.modal.close();
              NS.data.invalidate();
              U.toast('品名已保存', 'success');
              loadProducts();
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  async function removeProduct(id, code) {
    const confirmed = await U.confirmDialog({
      title: '删除品名',
      message: `确认删除品名「${code}」？删除将同时移除其工艺模板；若该品名已被任何日报引用，删除会被拒绝，请改用停用。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await NS.api.invoke('product.delete', { id });
      NS.data.invalidate();
      U.toast('品名已删除', 'success');
      loadProducts();
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /* ============================== 工艺模板 ============================== */

  async function renderTemplate() {
    const body = U.qs('#sys-body', state.container);
    body.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <span class="muted">一品一模板：每个品名最多一份模板，保存时按品名覆盖。</span>
          <button class="btn btn-primary btn-sm" id="template-add">新增/维护模板</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="width:120px">品名编码</th><th style="width:170px">品名名称</th>
                <th>顶温(℃)</th><th>底温(℃)</th><th>压力</th><th style="width:180px">有效期</th><th style="width:80px">操作</th>
              </tr>
            </thead>
            <tbody id="template-rows"></tbody>
          </table>
        </div>
      </div>`;
    U.qs('#template-add', body).addEventListener('click', () => openTemplateForm(null));
    body.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act="edit"]');
      if (!button) return;
      openTemplateForm(templateRowsCache[Number(button.dataset.row)]);
    });
    await loadTemplates();
  }

  let templateRowsCache = [];

  function rangeText(min, max) {
    const hasMin = String(min === undefined || min === null ? '' : min).trim() !== '';
    const hasMax = String(max === undefined || max === null ? '' : max).trim() !== '';
    if (!hasMin && !hasMax) return '<span class="muted">不限</span>';
    if (hasMin && hasMax) return `${U.escapeHtml(min)} ~ ${U.escapeHtml(max)}`;
    if (hasMin) return `≥ ${U.escapeHtml(min)}`;
    return `≤ ${U.escapeHtml(max)}`;
  }

  async function loadTemplates() {
    const body = U.qs('#sys-body', state.container);
    const rows = await NS.api.invoke('template.list');
    templateRowsCache = rows;
    const tbody = U.qs('#template-rows', body);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">尚未配置工艺模板</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row, index) => `
        <tr>
          <td>${U.escapeHtml(row.product_code)}</td>
          <td>${U.escapeHtml(U.valueOrDash(row.product_name))}</td>
          <td>${rangeText(row.top_min, row.top_max)}</td>
          <td>${rangeText(row.bottom_min, row.bottom_max)}</td>
          <td>${rangeText(row.pressure_min, row.pressure_max)}</td>
          <td>${U.escapeHtml(row.valid_from || row.valid_to ? `${row.valid_from || '—'} ~ ${row.valid_to || '—'}` : '长期')}</td>
          <td><button class="btn btn-ghost btn-sm" data-act="edit" data-row="${index}">编辑</button></td>
        </tr>`)
      .join('');
  }

  async function openTemplateForm(row) {
    const options = await NS.data.loadOptions(true);
    const products = options.products.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }));
    U.openModal({
      title: row ? `维护工艺模板 · ${row.product_code}` : '新增工艺模板',
      width: 640,
      bodyHtml: `
        <div class="form-row">
          <label class="field field-full"><span>品名（${row ? '编辑时不可更换' : '一品一模板'}）</span>${selectHtml('f-product', products, row ? row.product_code : '', '请选择品名')}</label>
          <label class="field"><span>顶温下限(℃)</span><input type="number" step="0.01" id="f-top-min" value="${U.escapeHtml(row ? row.top_min : '')}" /></label>
          <label class="field"><span>顶温上限(℃)</span><input type="number" step="0.01" id="f-top-max" value="${U.escapeHtml(row ? row.top_max : '')}" /></label>
          <label class="field"><span>底温下限(℃)</span><input type="number" step="0.01" id="f-bottom-min" value="${U.escapeHtml(row ? row.bottom_min : '')}" /></label>
          <label class="field"><span>底温上限(℃)</span><input type="number" step="0.01" id="f-bottom-max" value="${U.escapeHtml(row ? row.bottom_max : '')}" /></label>
          <label class="field"><span>压力下限</span><input type="number" step="0.01" id="f-pressure-min" value="${U.escapeHtml(row ? row.pressure_min : '')}" /></label>
          <label class="field"><span>压力上限</span><input type="number" step="0.01" id="f-pressure-max" value="${U.escapeHtml(row ? row.pressure_max : '')}" /></label>
          <label class="field"><span>有效期起</span><input type="date" id="f-valid-from" value="${U.escapeHtml(row ? row.valid_from : '')}" /></label>
          <label class="field"><span>有效期止</span><input type="date" id="f-valid-to" value="${U.escapeHtml(row ? row.valid_to : '')}" /></label>
          <div class="field-full muted" style="font-size:12px">单边留空表示该项不限；压力支持负压。</div>
          <div class="field-full form-error" id="f-error"></div>
        </div>`,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '保存',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            const value = (id) => U.qs(id, root).value.trim();
            try {
              await NS.api.invoke('template.save', {
                id: row ? row.id : '',
                product_code: value('#f-product'),
                top_min: value('#f-top-min'),
                top_max: value('#f-top-max'),
                bottom_min: value('#f-bottom-min'),
                bottom_max: value('#f-bottom-max'),
                pressure_min: value('#f-pressure-min'),
                pressure_max: value('#f-pressure-max'),
                valid_from: value('#f-valid-from'),
                valid_to: value('#f-valid-to'),
              });
              ctx.modal.close();
              U.toast('工艺模板已保存', 'success');
              loadTemplates();
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  /* ============================== 操作类型 ============================== */

  const opQuery = { keyword: '', status: '' };

  async function renderOperationType() {
    const body = U.qs('#sys-body', state.container);
    body.innerHTML = `
      <div class="card">
        <div class="filter-bar">
          <label class="field"><span>关键字</span><input type="text" id="q-keyword" value="${U.escapeHtml(opQuery.keyword)}" placeholder="编码或名称" /></label>
          <label class="field"><span>状态</span>${selectHtml('q-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], opQuery.status, '全部')}</label>
          <button class="btn btn-primary" id="q-search">查询</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary btn-sm" id="op-add">新增操作类型</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th style="width:130px">编码</th><th>名称</th><th style="width:100px">排序号</th><th style="width:80px">状态</th><th style="width:100px">操作</th></tr></thead>
            <tbody id="op-rows"></tbody>
          </table>
        </div>
      </div>`;

    U.qs('#q-search', body).addEventListener('click', () => {
      opQuery.keyword = U.qs('#q-keyword', body).value.trim();
      opQuery.status = U.qs('#q-status', body).value;
      loadOperationTypes();
    });
    U.qs('#op-add', body).addEventListener('click', () => openOperationTypeForm(null));
    U.qs('#op-rows', body).addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act="edit"]');
      if (!button) return;
      openOperationTypeForm(opRowsCache[Number(button.dataset.row)]);
    });
    await loadOperationTypes();
  }

  let opRowsCache = [];

  async function loadOperationTypes() {
    const body = U.qs('#sys-body', state.container);
    const rows = await NS.api.invoke('operationType.list', opQuery);
    opRowsCache = rows;
    const tbody = U.qs('#op-rows', body);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无操作类型</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row, index) => `
        <tr>
          <td>${U.escapeHtml(row.code)}</td>
          <td>${U.escapeHtml(row.name)}</td>
          <td>${U.escapeHtml(row.sort)}</td>
          <td>${statusText(row.status)}</td>
          <td><button class="btn btn-ghost btn-sm" data-act="edit" data-row="${index}">编辑</button></td>
        </tr>`)
      .join('');
  }

  function openOperationTypeForm(row) {
    const isEdit = !!row;
    U.openModal({
      title: isEdit ? `编辑操作类型 · ${row.code}` : '新增操作类型',
      width: 520,
      bodyHtml: `
        <div class="form-row">
          <label class="field"><span>编码（唯一）</span><input type="text" id="f-code" maxlength="64" value="${U.escapeHtml(row ? row.code : '')}" /></label>
          <label class="field"><span>名称</span><input type="text" id="f-name" maxlength="100" value="${U.escapeHtml(row ? row.name : '')}" /></label>
          <label class="field"><span>排序号（升序展示）</span><input type="number" step="1" id="f-sort" value="${U.escapeHtml(row ? row.sort : '0')}" /></label>
          <label class="field"><span>状态</span>${selectHtml('f-status', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], row ? row.status : '1', '')}</label>
          <div class="field-full form-error" id="f-error"></div>
        </div>`,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '保存',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            try {
              await NS.api.invoke('operationType.save', {
                id: row ? row.id : '',
                code: U.qs('#f-code', root).value.trim(),
                name: U.qs('#f-name', root).value.trim(),
                sort: U.qs('#f-sort', root).value.trim(),
                status: U.qs('#f-status', root).value,
              });
              ctx.modal.close();
              NS.data.invalidate();
              U.toast('操作类型已保存', 'success');
              loadOperationTypes();
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  /* ============================== 调度 ============================== */

  function renderTab() {
    if (state.tab === 'user') renderUser();
    else if (state.tab === 'product') renderProduct();
    else if (state.tab === 'template') renderTemplate();
    else renderOperationType();
  }

  async function mount(container) {
    state.container = container;
    state.tab = 'user';
    container.innerHTML = shell();
    bindTabs(container);
    renderTab();
  }

  NS.pages = NS.pages || {};
  NS.pages.system = { mount };
}(window));
