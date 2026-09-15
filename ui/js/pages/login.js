'use strict';

/** 登录页（FR1）。 */

(function (global) {
  const NS = (global.PDR = global.PDR || {});
  const U = NS.util;

  let bound = false;

  function reset() {
    const password = U.qs('#login-password');
    if (password) password.value = '';
    const error = U.qs('#login-error');
    if (error) error.textContent = '';
    const submit = U.qs('#login-submit');
    if (submit) submit.disabled = false;
  }

  function bind() {
    if (bound) return;
    bound = true;

    const form = U.qs('#login-form');
    const accountInput = U.qs('#login-account');
    const passwordInput = U.qs('#login-password');
    const rememberInput = U.qs('#login-remember');
    const errorBox = U.qs('#login-error');
    const submitBtn = U.qs('#login-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '登录中…';
      try {
        const data = await NS.api.invoke('auth.login', {
          account: accountInput.value.trim(),
          password: passwordInput.value,
          remember: rememberInput.checked,
        });
        NS.api.setToken(data.token);
        passwordInput.value = '';
        await NS.app.onLoggedIn(data.user);
      } catch (err) {
        errorBox.textContent = err.message || '登录失败';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '登 录';
      }
    });

    accountInput.focus();
  }

  NS.pages = NS.pages || {};
  NS.pages.login = { bind, reset };
}(window));
