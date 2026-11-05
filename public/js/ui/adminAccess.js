// i18n-ignore-file: Chinese host console settings, never loaded by player UI.
export async function initAdminAccess(host, api) {
  const $ = (selector) => host.querySelector(selector);
  host.innerHTML = `<h2>访问与登录</h2>
    <p class="meta" data-access-status role="status">正在读取访问设置…</p>
    <form data-access-form>
      <p><label><input type="checkbox" data-login-enabled> 启用登录界面</label></p>
      <p class="meta">默认关闭。本机显示登录界面时仍可选择跳过密码。</p>
      <p><label><input type="checkbox" data-allow-remote> 允许非本机访问</label></p>
      <p class="meta">默认关闭。开启前必须启用登录界面并设置密码；使用独立控制台端口，外网需另行配置端口转发或隧道。</p>
      <div class="row"><button type="submit" class="primary">保存访问设置</button><span data-access-saved role="status" aria-live="polite"></span></div>
    </form>
    <form data-password-form class="access-password">
      <h3>管理密码</h3><p class="meta" data-password-help></p>
      <label data-old-password-label>旧密码<input type="password" data-old-password autocomplete="current-password"></label>
      <label>新密码（8–128 个字符）<input type="password" data-new-password autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <label>再次输入新密码<input type="password" data-confirm-password autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <div class="row"><button type="submit">保存密码</button><span data-password-saved role="status" aria-live="polite"></span></div>
    </form>`;
  let state;
  try { state = await api('/api/access'); if (state.error) throw new Error(state.error); }
  catch (error) { $('[data-access-status]').textContent = `读取失败：${error.message}，请重新打开设置。`; for (const input of host.querySelectorAll('input, button')) input.disabled = true; return; }
  function draw() {
    $('[data-login-enabled]').checked = state.loginEnabled;
    $('[data-allow-remote]').checked = state.allowRemote;
    $('[data-access-status]').textContent = state.warning || `${state.local ? '当前为本机访问' : '当前为非本机访问'} · ${state.allowRemote ? '已允许非本机访问' : '仅允许本机访问'} · ${state.passwordSet ? '已设置密码' : '尚未设置密码'}`;
    $('[data-old-password-label]').hidden = state.local;
    $('[data-old-password]').required = !state.local;
    $('[data-password-help]').textContent = state.local ? '本机可直接修改密码，无需旧密码。其他浏览器会话会失效。' : '非本机修改密码需要验证旧密码。其他浏览器会话会失效。';
  }
  draw();
  $('[data-allow-remote]').addEventListener('change', () => { if ($('[data-allow-remote]').checked) $('[data-login-enabled]').checked = true; });
  $('[data-access-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = $('[data-access-saved]'), button = event.submitter;
    const next = { loginEnabled: $('[data-login-enabled]').checked, allowRemote: $('[data-allow-remote]').checked };
    if (next.allowRemote && (!next.loginEnabled || !state.passwordSet)) { feedback.textContent = '请先启用登录界面并保存管理密码。'; return; }
    button.disabled = true; feedback.textContent = '';
    try {
      if (next.allowRemote && !state.allowRemote) {
        const proof = await api('/api/access/confirmation', {});
        if (proof.error) throw new Error(proof.error);
        if (!await confirmRemote(proof.waitMs)) { await api('/api/access/confirmation', {}, 'DELETE'); draw(); return; }
        next.confirmation = proof.confirmation;
      }
      const result = await api('/api/access', next);
      if (!result.ok) throw new Error(result.error || '保存失败');
      state = result; draw(); feedback.textContent = '已保存，立即生效。';
      if (!state.local && !state.allowRemote) location.replace('/login');
    } catch (error) { feedback.textContent = `保存失败：${error.message}`; draw(); }
    finally { button.disabled = false; }
  });
  $('[data-password-form]').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.submitter, feedback = $('[data-password-saved]');
    button.disabled = true; feedback.textContent = '正在保存…';
    try {
      const result = await api('/api/auth/password', { oldPassword: $('[data-old-password]').value,
        newPassword: $('[data-new-password]').value, confirmPassword: $('[data-confirm-password]').value });
      if (!result.ok) throw new Error(result.error || '密码保存失败');
      state.passwordSet = true; draw(); event.target.reset();
      feedback.textContent = '密码已保存，其他浏览器会话已退出。';
    } catch (error) { feedback.textContent = `保存失败：${error.message}`; }
    finally { button.disabled = false; }
  });
}

function confirmRemote(waitMs) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'access-risk'; dialog.setAttribute('aria-labelledby', 'access-risk-title');
    dialog.innerHTML = `<h2 id="access-risk-title">允许非本机访问控制台？</h2>
      <p>知道管理密码的人将拥有完整控制台权限，包括修改对局、更新程序和关闭服务。</p>
      <p>控制台端口会向网络开放。HTTP 不会加密密码和会话，请仅在可信网络使用，公网访问应配置 HTTPS。</p>
      <p>确认前请阅读提示，等待 5 秒。此设置不会自动配置防火墙或游戏隧道。</p>
      <div class="row"><button type="button" data-cancel>取消</button><button type="button" class="danger" data-confirm disabled></button></div>`;
    document.body.append(dialog);
    const confirm = dialog.querySelector('[data-confirm]'), start = performance.now();
    const update = () => { const left = Math.max(0, Math.ceil((waitMs - (performance.now() - start)) / 1000)); confirm.disabled = left > 0; confirm.textContent = left > 0 ? `我已了解风险（${left} 秒）` : '我已了解风险，允许访问'; };
    update(); const timer = setInterval(update, 100);
    const finish = (value) => { clearInterval(timer); dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector('[data-cancel]').onclick = () => finish(false);
    confirm.onclick = () => { if (!confirm.disabled) finish(true); };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
  });
}
