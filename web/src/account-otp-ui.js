import {
  beginAccountClaim,
  isAnonymousSession,
  sendSignInOtp,
  supabase,
  verifyAccountClaim,
  verifySignInOtp,
} from './supabase.js';

const buttonClass = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';

let mode = 'claim';
let pendingEmail = null;
let wired = false;

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function setup() {
  if (wired) return;
  const dialog = document.querySelector('#account-dialog');
  const form = document.querySelector('#account-form');
  const email = document.querySelector('#account-email');
  const code = document.querySelector('#account-password');
  const submit = document.querySelector('#account-submit');
  const oldForgot = document.querySelector('#forgot-password');
  const error = document.querySelector('#account-error');
  const success = document.querySelector('#account-success');
  const description = document.querySelector('#account-description');
  const accountButton = document.querySelector('#account-button');
  if (!dialog || !form || !email || !code || !submit || !oldForgot || !error || !success || !description || !accountButton) return;
  wired = true;

  const codeLabel = code.closest('label');
  if (codeLabel?.firstChild) codeLabel.firstChild.textContent = 'Six-digit code';
  code.type = 'text';
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.pattern = '[0-9]{6}';
  code.maxLength = 6;
  code.minLength = 6;
  code.required = false;
  codeLabel?.classList.add('hidden');

  oldForgot.classList.add('hidden');

  const leftActions = oldForgot.parentElement;
  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = buttonClass;
  sendButton.textContent = 'Send code';

  const switchButton = document.createElement('button');
  switchButton.type = 'button';
  switchButton.className = buttonClass;
  switchButton.textContent = 'Sign in instead';

  const actionWrap = document.createElement('div');
  actionWrap.className = 'flex flex-wrap gap-2';
  actionWrap.append(switchButton, sendButton);
  leftActions.insertBefore(actionWrap, leftActions.firstChild);

  function clearMessages() {
    error.textContent = '';
    error.classList.add('hidden');
    success.textContent = '';
    success.classList.add('hidden');
  }

  function resetOtpState() {
    pendingEmail = null;
    email.readOnly = false;
    code.value = '';
    code.required = false;
    codeLabel?.classList.add('hidden');
    submit.classList.add('hidden');
    sendButton.classList.remove('hidden');
  }

  function renderMode() {
    clearMessages();
    resetOtpState();
    if (mode === 'claim') {
      description.textContent = 'Save this temporary Town Red identity with your email address. We’ll send a six-digit verification code; no password is required.';
      switchButton.textContent = 'Sign in instead';
      sendButton.textContent = 'Send verification code';
      submit.textContent = 'Save identity';
    } else {
      description.textContent = 'Recover an existing Town Red identity. We’ll send a six-digit sign-in code to your email address.';
      switchButton.textContent = 'Save this identity instead';
      sendButton.textContent = 'Send sign-in code';
      submit.textContent = 'Sign in';
    }
  }

  async function refreshModeForSession() {
    const { data } = await supabase.auth.getSession();
    if (!isAnonymousSession(data.session)) return;
    mode = 'claim';
    renderMode();
  }

  accountButton.addEventListener('click', () => {
    setTimeout(() => refreshModeForSession().catch(() => {}), 0);
  });

  switchButton.addEventListener('click', () => {
    mode = mode === 'claim' ? 'signin' : 'claim';
    email.value = '';
    renderMode();
    email.focus();
  });

  sendButton.addEventListener('click', async () => {
    clearMessages();
    const address = email.value.trim();
    if (!address) {
      error.textContent = 'Enter your email address first.';
      error.classList.remove('hidden');
      return;
    }
    sendButton.disabled = true;
    try {
      if (mode === 'claim') await beginAccountClaim(address);
      else await sendSignInOtp(address);
      pendingEmail = address;
      email.readOnly = true;
      code.required = true;
      codeLabel?.classList.remove('hidden');
      submit.classList.remove('hidden');
      sendButton.classList.add('hidden');
      success.textContent = `A six-digit code has been sent to ${address}.`;
      success.classList.remove('hidden');
      code.focus();
    } catch (e) {
      error.textContent = errorText(e);
      error.classList.remove('hidden');
    } finally {
      sendButton.disabled = false;
    }
  });

  // Capture the submit before main.js's legacy password handler sees it.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearMessages();
    if (!pendingEmail) {
      error.textContent = 'Send a code first.';
      error.classList.remove('hidden');
      return;
    }
    const token = code.value.trim();
    if (!/^\d{6}$/.test(token)) {
      error.textContent = 'Enter the six-digit code from your email.';
      error.classList.remove('hidden');
      return;
    }
    submit.disabled = true;
    try {
      if (mode === 'claim') await verifyAccountClaim(pendingEmail, token);
      else await verifySignInOtp(pendingEmail, token);
      success.textContent = mode === 'claim' ? 'Identity saved. Reloading your maps…' : 'Signed in. Reloading your maps…';
      success.classList.remove('hidden');
      location.reload();
    } catch (e) {
      error.textContent = errorText(e);
      error.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  }, true);

  renderMode();
}

setup();
new MutationObserver(setup).observe(document.documentElement, { childList: true, subtree: true });
