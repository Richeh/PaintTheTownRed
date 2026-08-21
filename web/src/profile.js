import { getProfile, saveProfile } from './data.js';

const dialogClass = 'm-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40';
const inputClass = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100';
const buttonClass = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50';

let dialog = null;
let profileForm = null;
let signInForm = null;
let nameInput = null;
let signInEmail = null;
let signInCode = null;
let codeBlock = null;
let errorElement = null;
let successElement = null;
let submitButton = null;
let signInSubmit = null;
let resendButton = null;
let signInToggle = null;
let profileToggle = null;
let pendingResolve = null;
let activeUserId = null;
let pendingSignInEmail = null;

function clearMessages() {
  errorElement.textContent = '';
  errorElement.classList.add('hidden');
  successElement.textContent = '';
  successElement.classList.add('hidden');
}

function showProfileMode() {
  profileForm.classList.remove('hidden');
  signInForm.classList.add('hidden');
  pendingSignInEmail = null;
  codeBlock.classList.add('hidden');
  signInCode.required = false;
  clearMessages();
  requestAnimationFrame(() => nameInput.focus());
}

function showSignInMode() {
  profileForm.classList.add('hidden');
  signInForm.classList.remove('hidden');
  pendingSignInEmail = null;
  codeBlock.classList.add('hidden');
  signInCode.required = false;
  signInSubmit.textContent = 'Send code';
  resendButton.classList.add('hidden');
  clearMessages();
  requestAnimationFrame(() => signInEmail.focus());
}

function showCodeMode(email) {
  pendingSignInEmail = email;
  signInEmail.readOnly = true;
  codeBlock.classList.remove('hidden');
  signInCode.required = true;
  signInSubmit.textContent = 'Sign in';
  resendButton.classList.remove('hidden');
  successElement.textContent = `We sent a six-digit sign-in code to ${email}.`;
  successElement.classList.remove('hidden');
  requestAnimationFrame(() => signInCode.focus());
}

function finish(profile) {
  dialog.close();
  pendingResolve?.(profile);
  pendingResolve = null;
  activeUserId = null;
  pendingSignInEmail = null;
}

async function sendCode(email) {
  const { sendSignInOtp } = await import('./supabase.js');
  await sendSignInOtp(email);
  showCodeMode(email);
}

function ensureDialog() {
  if (dialog) return;

  dialog = document.createElement('dialog');
  dialog.className = dialogClass;
  dialog.innerHTML = `
    <div class="p-5">
      <form data-profile-form>
        <h2 class="m-0 text-lg font-semibold">What should we call you?</h2>
        <p class="mt-1 text-sm leading-6 text-stone-600">
          This name is shown to people who share a Town Red map with you. Your email address is not shared.
        </p>
        <label class="mt-4 block text-sm font-medium text-stone-700">
          Display name
          <input data-profile-name class="${inputClass}" type="text" maxlength="80" autocomplete="name" required />
        </label>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button data-sign-in-toggle type="button" class="${buttonClass}">Already have an account? Sign in</button>
          <button type="submit" class="${primaryButtonClass}">Continue</button>
        </div>
      </form>

      <form data-sign-in-form class="hidden">
        <h2 class="m-0 text-lg font-semibold">Sign in to Town Red</h2>
        <p class="mt-1 text-sm leading-6 text-stone-600">
          Enter your email and we'll send you a one-time sign-in code. No password needed.
        </p>
        <label class="mt-4 block text-sm font-medium text-stone-700">
          Email
          <input data-sign-in-email class="${inputClass}" type="email" autocomplete="email" required />
        </label>
        <label data-code-block class="mt-3 hidden text-sm font-medium text-stone-700">
          Six-digit code
          <input data-sign-in-code class="${inputClass}" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" />
        </label>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-2">
            <button data-profile-toggle type="button" class="${buttonClass}">Use a new temporary identity</button>
            <button data-resend type="button" class="${buttonClass} hidden">Resend code</button>
          </div>
          <button type="submit" class="${primaryButtonClass}">Send code</button>
        </div>
      </form>

      <p class="mt-3 hidden text-sm text-red-700" aria-live="assertive" data-error></p>
      <p class="mt-3 hidden text-sm text-emerald-700" aria-live="polite" data-success></p>
    </div>
  `;

  document.body.append(dialog);
  profileForm = dialog.querySelector('[data-profile-form]');
  signInForm = dialog.querySelector('[data-sign-in-form]');
  nameInput = dialog.querySelector('[data-profile-name]');
  signInEmail = dialog.querySelector('[data-sign-in-email]');
  signInCode = dialog.querySelector('[data-sign-in-code]');
  codeBlock = dialog.querySelector('[data-code-block]');
  errorElement = dialog.querySelector('[data-error]');
  successElement = dialog.querySelector('[data-success]');
  submitButton = profileForm.querySelector('button[type="submit"]');
  signInSubmit = signInForm.querySelector('button[type="submit"]');
  resendButton = dialog.querySelector('[data-resend]');
  signInToggle = dialog.querySelector('[data-sign-in-toggle]');
  profileToggle = dialog.querySelector('[data-profile-toggle]');

  dialog.addEventListener('cancel', (event) => event.preventDefault());
  signInToggle.addEventListener('click', showSignInMode);
  profileToggle.addEventListener('click', () => {
    signInEmail.readOnly = false;
    signInEmail.value = '';
    signInCode.value = '';
    showProfileMode();
  });

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const displayName = nameInput.value.trim();
    if (!displayName || !activeUserId) return;
    clearMessages();
    submitButton.disabled = true;
    try {
      const profile = await saveProfile({ userId: activeUserId, displayName });
      finish(profile);
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
      errorElement.classList.remove('hidden');
    } finally {
      submitButton.disabled = false;
    }
  });

  signInForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessages();
    const email = (pendingSignInEmail || signInEmail.value).trim();
    if (!email) return;
    signInSubmit.disabled = true;
    try {
      if (!pendingSignInEmail) {
        await sendCode(email);
        return;
      }

      const token = signInCode.value.trim();
      if (!/^\d{6}$/.test(token)) throw new Error('Enter the six-digit code from your email.');
      const { verifySignInOtp } = await import('./supabase.js');
      const session = await verifySignInOtp(email, token);
      const signedInUserId = session?.user?.id;
      if (!signedInUserId) throw new Error('Supabase did not return a signed-in user.');

      activeUserId = signedInUserId;
      const profile = await getProfile(signedInUserId);
      if (profile) {
        finish(profile);
        return;
      }

      nameInput.value = '';
      signInEmail.readOnly = false;
      showProfileMode();
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
      errorElement.classList.remove('hidden');
    } finally {
      signInSubmit.disabled = false;
    }
  });

  resendButton.addEventListener('click', async () => {
    if (!pendingSignInEmail) return;
    clearMessages();
    resendButton.disabled = true;
    try {
      await sendCode(pendingSignInEmail);
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
      errorElement.classList.remove('hidden');
    } finally {
      resendButton.disabled = false;
    }
  });
}

export async function ensureProfile(userId) {
  if (!userId) return null;

  const existing = await getProfile(userId);
  if (existing) return existing;

  ensureDialog();
  activeUserId = userId;
  nameInput.value = '';
  signInEmail.value = '';
  signInEmail.readOnly = false;
  signInCode.value = '';
  clearMessages();
  showProfileMode();

  return new Promise((resolve) => {
    pendingResolve = resolve;
    dialog.showModal();
  });
}
