'use strict';

/** 视图路由、角色菜单控制与报告库导航（7.1）。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  const NAV_ITEMS = [
    { key: 'today', label: '今日日报', roles: null },
    { key: 'stats', label: '统计看板', roles: ['LEADER', 'QA', 'ADMIN'] },
    { key: 'system', label: '系统管理', roles: ['ADMIN'] },
    { key: 'audit', label: '审计日志', roles: ['QA', 'ADMIN'] },
  ];

  const TITLES = {
    today: '日报填报',
    report: '日报详情',
    stats: '统计看板',
    system: '系统管理',
    audit: '审计日志',
  };

  const state = { user: null, view: null, params: {} };
  const expandedGroups = new Set();
  let treeLoaded = false;

  /* ------------------------------ 公共数据缓存 ------------------------------ */

  NS.data = {
    _cache: {},
    _pending: null,
    async loadOptions(force) {
      if (!force && this._cache.options) return this._cache.options;
      if (!force && this._pending) return this._pending;
      this._pending = (async () => {
        const [users, operationTypes, products] = await Promise.all([
          NS.api.invoke('user.options'),
          NS.api.invoke('operationType.options'),
          NS.api.invoke('product.options'),
        ]);
        this._cache.options = { users, operationTypes, products };
        this._pending = null;
        return this._cache.options;
      })();
      return this._pending;
    },
    invalidate() {
      this._cache.options = null;
    },
  };

  /* ------------------------------ 权限 ------------------------------ */

  function can(what) {
    const role = state.user && state.user.role;
    if (!role) return false;
    switch (what) {
      case 'stats':
        return ['LEADER', 'QA', 'ADMIN'].indexOf(role) >= 0;
      case 'system':
        return role === 'ADMIN';
      case 'audit':
        return role === 'QA' || role === 'ADMIN';
      case 'export':
        return role === 'QA' || role === 'ADMIN';
      case 'write':
        return role === 'OPERATOR' || role === 'ADMIN';
      default:
        return false;
    }
  }

  function firstAllowedView() {
    for (const item of NAV_ITEMS) {
      if (!item.roles || item.roles.indexOf(state.user.role) >= 0) return item.key;
    }
    return 'today';
  }

  /* ------------------------------ 导航 ------------------------------ */

  function renderNav() {
    const nav = U.qs('#main-nav');
    nav.innerHTML = NAV_ITEMS.filter((item) => !item.roles || item.roles.indexOf(state.user.role) >= 0)
      .map((item) => `<button class="nav-item${state.view === item.key ? ' active' : ''}" data-view="${item.key}">${item.label}</button>`)
      .join('');
  }

  function bindNav() {
    U.qs('#main-nav').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-view]');
      if (button) navigate(button.dataset.view);
    });
  }

  async function navigate(key, params) {
    if (key !== 'today' && key !== 'report') {
      const item = NAV_ITEMS.filter((n) => n.key === key)[0];
      if (item && item.roles && item.roles.indexOf(state.user.role) < 0) {
        U.toast('当前角色无该功能权限', 'error');
        return navigate(firstAllowedView());
      }
    }
    state.view = key;
    state.params = params || {};
    U.qs('#view-title').textContent = key === 'report' ? TITLES.report : TITLES[key] || '';
    renderNav();

    const content = U.qs('#content');
    if (key === 'today') await NS.pages.report.mount(content, { date: U.todayGmt8() });
    else if (key === 'report') await NS.pages.report.mount(content, { date: state.params.date });
    else if (key === 'stats') await NS.pages.stats.mount(content, state.params);
    else if (key === 'system') await NS.pages.system.mount(content, state.params);
    else if (key === 'audit') await NS.pages.audit.mount(content, state.params);

    markTreeActive();
  }

  function openDate(date) {
    navigate('report', { date });
  }

  /* ------------------------------ 报告库 ------------------------------ */

  function currentMonth() {
    return U.todayGmt8().slice(0, 7);
  }

  async function refreshTree() {
    try {
      const list = await NS.api.invoke('report.list');
      const groups = new Map();
      list.forEach((item) => {
        const key = item.date.slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      // 操作工/管理员默认展开当月分组
      if (!treeLoaded && can('write')) expandedGroups.add(currentMonth());
      treeLoaded = true;

      const tree = U.qs('#report-tree');
      const keys = Array.from(groups.keys()).sort().reverse();
      if (keys.length === 0) {
        tree.innerHTML = '<div class="empty-state" style="padding:18px 0">暂无日报记录</div>';
        return;
      }

      tree.innerHTML = keys
        .map((key) => {
          const items = groups.get(key);
          const open = expandedGroups.has(key);
          const rows = items
            .map((item) => {
              const label = item.product_name ? `${item.product_code} ${item.product_name}` : '未填品名';
              const active = state.view === 'report' && state.params.date === item.date;
              return `
                <button class="tree-item${active ? ' active' : ''}" data-date="${U.escapeHtml(item.date)}">
                  <span class="date">${U.escapeHtml(item.date.slice(5))}</span>
                  <span class="pname" title="${U.escapeHtml(label)}">${U.escapeHtml(label)}</span>
                  ${item.today ? '<span class="badge-today">今日</span>' : ''}
                </button>`;
            })
            .join('');
          return `
            <div class="tree-group" data-group="${U.escapeHtml(key)}">
              <div class="tree-group-head" data-toggle="${U.escapeHtml(key)}">
                <span>${open ? '▾' : '▸'} ${U.escapeHtml(key)}</span>
                <span class="muted">${items.length}</span>
              </div>
              <div class="tree-group-items${open ? '' : ' hidden'}">${rows}</div>
            </div>`;
        })
        .join('');
    } catch (err) {
      U.toast(`报告库加载失败：${err.message}`, 'error');
    }
  }

  function bindTree() {
    const tree = U.qs('#report-tree');
    tree.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) {
        const key = toggle.dataset.toggle;
        if (expandedGroups.has(key)) expandedGroups.delete(key);
        else expandedGroups.add(key);
        refreshTree();
        return;
      }
      const item = event.target.closest('button[data-date]');
      if (item) openDate(item.dataset.date);
    });
  }

  function markTreeActive() {
    U.qsa('#report-tree button[data-date]').forEach((button) => {
      const active = state.view === 'report' && state.params.date === button.dataset.date;
      button.classList.toggle('active', active);
    });
  }

  /** 报告库刷新（防抖，避免每次自动保存都全量扫描） */
  const scheduleTreeRefresh = U.debounce(() => {
    if (state.user) refreshTree();
  }, 900);

  /* ------------------------------ 会话 ------------------------------ */

  function showLogin() {
    U.qs('#app-view').classList.add('hidden');
    U.qs('#login-view').classList.remove('hidden');
    NS.pages.login.reset();
  }

  function showApp() {
    U.qs('#login-view').classList.add('hidden');
    U.qs('#app-view').classList.remove('hidden');
  }

  async function onLoggedIn(user) {
    state.user = user;
    treeLoaded = false;
    expandedGroups.clear();
    NS.data.invalidate();

    U.qs('#user-chip').textContent = `${user.name}（${U.roleLabel(user.role)}）`;
    showApp();
    renderNav();
    await refreshTree();
    await navigate(firstAllowedView());
    U.toast(`欢迎回来，${user.name}`, 'success');
  }

  async function logout(showToast) {
    try {
      await NS.api.invoke('auth.logout');
    } catch (_) {
      /* 忽略退出异常 */
    }
    NS.api.setToken(null);
    state.user = null;
    state.view = null;
    state.params = {};
    U.qs('#content').innerHTML = '';
    U.qs('#report-tree').innerHTML = '';
    showLogin();
    if (showToast) U.toast(showToast, 'warn');
  }

  function openChangePassword() {
    U.openModal({
      title: '修改密码',
      width: 460,
      bodyHtml: `
        <div class="form-row">
          <label class="field field-full"><span>原密码</span><input type="password" id="f-old" maxlength="32" /></label>
          <label class="field field-full"><span>新密码（6–32 位）</span><input type="password" id="f-new" maxlength="32" /></label>
          <label class="field field-full"><span>确认新密码</span><input type="password" id="f-confirm" maxlength="32" /></label>
          <div class="field-full form-error" id="f-error"></div>
          <div class="field-full muted" style="font-size:12px">修改成功后需要重新登录。</div>
        </div>`,
      footer: [
        { text: '取消', className: 'btn-ghost' },
        {
          text: '确认修改',
          className: 'btn-primary',
          keepOpen: true,
          onClick: async (ctx) => {
            const root = ctx.modal.root;
            const errorBox = U.qs('#f-error', root);
            errorBox.textContent = '';
            const oldPassword = U.qs('#f-old', root).value;
            const newPassword = U.qs('#f-new', root).value;
            const confirm = U.qs('#f-confirm', root).value;
            if (newPassword !== confirm) {
              errorBox.textContent = '两次输入的新密码不一致';
              return;
            }
            try {
              await NS.api.invoke('auth.changePassword', { oldPassword, newPassword });
              ctx.modal.close();
              await logout('密码已修改，请重新登录');
            } catch (err) {
              errorBox.textContent = err.message;
            }
          },
        },
      ],
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function bindTopbar() {
    U.qs('#btn-logout').addEventListener('click', async () => {
      const confirmed = await U.confirmDialog({
        title: '退出登录',
        message: '确认退出当前账号？未保存的修改将丢失。',
        confirmText: '退出登录',
      });
      if (confirmed) logout();
    });
    U.qs('#btn-change-pwd').addEventListener('click', openChangePassword);
  }

  async function boot() {
    NS.pages.login.bind();
    bindTopbar();
    bindNav();
    bindTree();

    NS.api.on('session.expired', () => {
      if (state.user) logout('登录状态已失效，请重新登录');
    });

    U.qs('#login-account').focus();

    try {
      const restored = await NS.api.invoke('auth.restore');
      if (restored && restored.token && restored.user) {
        NS.api.setToken(restored.token);
        await onLoggedIn(restored.user);
        return;
      }
    } catch (_) {
      /* 无有效凭据则进入登录页 */
    }
    showLogin();
  }

  NS.app = {
    state,
    can,
    navigate,
    openDate,
    refreshTree,
    scheduleTreeRefresh,
    onLoggedIn,
    logout,
    boot,
  };
  boot();
}(window));
