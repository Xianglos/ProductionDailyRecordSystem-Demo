'use strict';

/** 通用界面工具：DOM、提示、确认框、弹窗、防抖、格式化。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});

  const ROLE_LABEL = {
    OPERATOR: '操作工',
    LEADER: '班组长',
    QA: '质量管理员',
    ADMIN: '系统管理员',
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
  }

  /* ------------------------------ 提示 ------------------------------ */

  function toast(message, type) {
    const root = qs('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast toast-${type || 'info'}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.classList.add('toast-in'), 10);
    setTimeout(() => {
      node.classList.remove('toast-in');
      setTimeout(() => node.remove(), 240);
    }, type === 'error' ? 4200 : 2600);
  }

  /* ------------------------------ 弹窗 ------------------------------ */

  /**
   * 打开模态弹窗。
   * @param {{title:string, bodyHtml:string, footer?:Array<{text:string,className?:string,onClick?:Function}>, onMount?:Function, width?:number}} options
   * @returns {{close:Function, root:HTMLElement}}
   */
  function openModal(options) {
    const root = qs('#modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const footerHtml = (options.footer || [])
      .map((btn, index) => `<button class="btn ${btn.className || 'btn-ghost'}" data-btn="${index}">${escapeHtml(btn.text)}</button>`)
      .join('');
    mask.innerHTML = `
      <div class="modal" style="width:${options.width || 520}px">
        <div class="modal-head">
          <h3>${escapeHtml(options.title || '')}</h3>
          <button class="modal-close" data-close="1" title="关闭">×</button>
        </div>
        <div class="modal-body">${options.bodyHtml || ''}</div>
        <div class="modal-foot">${footerHtml}</div>
      </div>`;
    root.appendChild(mask);

    function close() {
      mask.remove();
    }

    mask.addEventListener('click', (event) => {
      const closeBtn = event.target.closest('[data-close]');
      if (closeBtn) {
        close();
        return;
      }
      const actionBtn = event.target.closest('[data-btn]');
      if (actionBtn) {
        const config = (options.footer || [])[Number(actionBtn.dataset.btn)];
        if (config && typeof config.onClick === 'function') {
          const result = config.onClick({ modal: controller, event });
          if (result === false) return;
        }
        if (!config || config.keepOpen !== true) close();
      }
    });

    const controller = { close, root: mask };
    if (typeof options.onMount === 'function') options.onMount(controller);
    return controller;
  }

  /** 二次确认（删除生产记录等唯一需确认的操作） */
  function confirmDialog(options) {
    return new Promise((resolve) => {
      let settled = false;
      const controller = openModal({
        title: options.title || '操作确认',
        bodyHtml: `<p class="confirm-text">${escapeHtml(options.message || '确认执行该操作？')}</p>`,
        width: 420,
        footer: [
          { text: options.cancelText || '取消', className: 'btn-ghost', onClick: () => { settled = true; resolve(false); } },
          { text: options.confirmText || '确认', className: options.danger ? 'btn-danger' : 'btn-primary', onClick: () => { settled = true; resolve(true); } },
        ],
      });
      controller.root.addEventListener('click', (event) => {
        if (event.target.closest('[data-close]') && !settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  /* ------------------------------ 格式化 ------------------------------ */

  function roleLabel(role) {
    return ROLE_LABEL[role] || role || '';
  }

  function showEmpty(container, text) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(text || '暂无数据')}</div>`;
  }

  /** 数值展示：空值显示 — */
  function valueOrDash(value) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    return text === '' ? '—' : text;
  }

  /** 取当前 GMT+8 时间，用于空行预填 */
  function nowMinuteGmt8() {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  }

  function todayGmt8() {
    return nowMinuteGmt8().slice(0, 10);
  }

  /** 'yyyy-MM-dd HH:mm' → datetime-local 值 */
  function toInputDateTime(text) {
    const value = String(text || '');
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') : '';
  }

  /** datetime-local 值 → 'yyyy-MM-dd HH:mm' */
  function fromInputDateTime(value) {
    return String(value || '').replace('T', ' ').slice(0, 16);
  }

  NS.util = {
    ROLE_LABEL,
    qs,
    qsa,
    escapeHtml,
    debounce,
    toast,
    openModal,
    confirmDialog,
    roleLabel,
    showEmpty,
    valueOrDash,
    nowMinuteGmt8,
    todayGmt8,
    toInputDateTime,
    fromInputDateTime,
  };
}(window));
