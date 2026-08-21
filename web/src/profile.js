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
let signInPassword = null;
let errorElement = null;
let submitButton = null;
let signInSubmit = null;
let signInToggle = null;
let profileToggle = null;
let pendingResolve = null;
let activeUserId = null;

function showProfileMode() {
  profileForm.classList.remove('hidden');
  signInForm.classList.add('hidden');
  errorElement.textContent = '';
  errorElement.classList.add('hidden');
  requestAnimationFrame(() => nameInput.focus());
}

function showSignInMode() {
  profileForm.classList.add('hidden');
  signInForm.classList.remove('hidden');
  errorElement.textContent = '';
  errorElement.classList.add('hidden');
  requestAnimationFrame(() => signInEmail.focus());
}

function finish(profile) {
  dialog.close();
  pendingResolve?.(profile);
  pendingResolve = null;
  activeUserId = null;
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
          Recover your saved maps, memberships and profile on this device.
        </p>
        <label class="mt-4 block text-sm font-medium text-stone-700">
          Email
          <input data-sign-in-email class="${inputClass}" type="email" autocomplete="email" required />
        </label>
        <label class="mt-3 block text-sm font-medium text-stone-700">
          Password
          <input data-sign-in-password class="${inputClass}" type="password" autocomplete="current-password" required />
        </label>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button data-profile-toggle type="button" class="${buttonClass}">Use a new temporary identity</button>
          <button type="submit" class="${primaryButtonClass}">Sign in</button>
        </div>
      </form>

      <p class="mt-3 hidden text-sm text-red-700" aria-live="polite"></p>
    </div>
  `;

  document.body.append(dialog);
  profileForm = dialog.querySelector('[data-profile-form]');
  signInForm = dialog.querySelector('[data-sign-in-form]');
  nameInput = dialog.querySelector('[data-profile-name]');
  signInEmail = dialog.querySelector('[data-sign-in-email]');
  signInPassword = dialog.querySelector('[data-sign-in-password]');
  errorElement = dialog.querySelector('p[aria-live]');
  submitButton = profileForm.querySelector('button[type="submit"]');
  signInSubmit = signInForm.querySelector('button[type="submit"]');
  signInToggle = dialog.querySelector('[data-sign-in-toggle]');
  profileToggle = dialog.querySelector('[data-profile-toggle]');

  dialog.addEventListener('cancel', (event) => {
    // A profile or recovered account is required before startup can continue.
    event.preventDefault();
  });

  signInToggle.addEventListener('click', showSignInMode);
  profileToggle.addEventListener('click', showProfileMode);

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const displayName = nameInput.value.trim();
    if (!displayName || !activeUserId) return;

    errorElement.classList.add('hidden');
    errorElement.textContent = '';
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
    const email = signInEmail.value.trim();
    const password = signInPassword.value;
    if (!email || !password) return;

    errorElement.classList.add('hidden');
    errorElement.textContent = '';
    signInSubmit.disabled = true;

    try {
      // Dynamic import avoids the profile -> data -> supabase -> profile module cycle.
      const { supabase } = await import('./supabase.js');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const signedInUserId = data.session?.user?.id;
      if (!signedInUserId) throw new Error('Supabase did not return a signed-in user.');

      activeUserId = signedInUserId;
      const profile = await getProfile(signedInUserId);
      if (profile) {
        finish(profile);
        return;
      }

      // A valid saved account without a Town Red profile can choose its display name now.
      nameInput.value = '';
      showProfileMode();
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
      errorElement.classList.remove('hidden');
    } finally {
      signInSubmit.disabled = false;
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
  signInPassword.value = '';
  errorElement.textContent = '';
  errorElement.classList.add('hidden');
  showProfileMode();

  return new Promise((resolve) => {
    pendingResolve = resolve;
    dialog.showModal();
  });
}
