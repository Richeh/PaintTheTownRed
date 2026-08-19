import { getProfile, saveProfile } from './data.js';

const dialogClass = 'm-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40';
const inputClass = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100';
const primaryButtonClass = 'rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50';

let dialog = null;
let form = null;
let nameInput = null;
let errorElement = null;
let submitButton = null;
let pendingResolve = null;
let activeUserId = null;

function ensureDialog() {
  if (dialog) return;

  dialog = document.createElement('dialog');
  dialog.className = dialogClass;
  dialog.innerHTML = `
    <form class="p-5">
      <h2 class="m-0 text-lg font-semibold">What should we call you?</h2>
      <p class="mt-1 text-sm leading-6 text-stone-600">
        This name is shown to people who share a Town Red map with you. Your email address is not shared.
      </p>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Display name
        <input class="${inputClass}" type="text" maxlength="80" autocomplete="name" required />
      </label>
      <p class="mt-3 hidden text-sm text-red-700" aria-live="polite"></p>
      <div class="mt-5 flex justify-end">
        <button type="submit" class="${primaryButtonClass}">Continue</button>
      </div>
    </form>
  `;

  document.body.append(dialog);
  form = dialog.querySelector('form');
  nameInput = dialog.querySelector('input');
  errorElement = dialog.querySelector('p[aria-live]');
  submitButton = dialog.querySelector('button[type="submit"]');

  dialog.addEventListener('cancel', (event) => {
    // A display name is required for a new Town Red profile.
    event.preventDefault();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const displayName = nameInput.value.trim();
    if (!displayName || !activeUserId) return;

    errorElement.classList.add('hidden');
    errorElement.textContent = '';
    submitButton.disabled = true;

    try {
      const profile = await saveProfile({
        userId: activeUserId,
        displayName,
      });
      dialog.close();
      pendingResolve?.(profile);
      pendingResolve = null;
      activeUserId = null;
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
      errorElement.classList.remove('hidden');
    } finally {
      submitButton.disabled = false;
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
  errorElement.textContent = '';
  errorElement.classList.add('hidden');

  return new Promise((resolve) => {
    pendingResolve = resolve;
    dialog.showModal();
    requestAnimationFrame(() => nameInput.focus());
  });
}
