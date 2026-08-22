<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';
import OtpAuthForm from './OtpAuthForm.vue';
import { sendSignInOtp, verifySignInOtp } from '../supabase.js';

// ProfileDialog is the first-run gate. A new browser can either create a
// temporary anonymous identity by choosing a display name, or recover an
// existing saved identity with an email OTP. Keeping those two choices in one
// component avoids creating a throwaway profile before a returning user signs in.
const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['submit']);
const displayName = ref('');
const mode = ref('profile');
const authBusy = ref(false);
const authError = ref('');
const authSuccess = ref('');

// Treat every opening as a fresh onboarding attempt. This is especially useful
// after sign-out, where the page reloads into a brand-new anonymous session.
watch(
  () => props.open,
  (open) => {
    if (open) {
      displayName.value = '';
      mode.value = 'profile';
      authError.value = '';
      authSuccess.value = '';
    }
  },
);

// Creating a temporary identity only needs a human-readable name; App.vue owns
// the actual profiles-table write and waits for that write before continuing.
function submit() {
  const value = displayName.value.trim();
  if (value) emit('submit', value);
}

// OtpAuthForm owns the two-step form state. The callback is invoked only after
// Supabase accepts the send request, so the code field is never shown early.
async function sendOtp(email, markSent) {
  authBusy.value = true;
  authError.value = '';
  authSuccess.value = '';
  try {
    await sendSignInOtp(email);
    markSent();
    authSuccess.value = `A verification code has been sent to ${email}.`;
  } catch (error) {
    authError.value = error instanceof Error ? error.message : String(error);
  } finally {
    authBusy.value = false;
  }
}

// We reload after an identity switch instead of trying to hot-swap every map,
// realtime and profile subscription from one auth.uid() to another in-place.
async function verifyOtp(email, token) {
  authBusy.value = true;
  authError.value = '';
  try {
    await verifySignInOtp(email, token);
    authSuccess.value = 'Signed in. Loading your Town Red maps…';
    // A full reload gives the whole application one authoritative identity,
    // including realtime subscriptions and the MapLibre marker subsystem.
    location.reload();
  } catch (error) {
    authError.value = error instanceof Error ? error.message : String(error);
  } finally {
    authBusy.value = false;
  }
}
</script>

<template>
  <BaseDialog :open="open" :close-on-backdrop="false">
    <form v-if="mode === 'profile'" class="p-5" @submit.prevent="submit">
      <h2 class="m-0 text-lg font-semibold">What should we call you?</h2>
      <p class="mt-1 text-sm leading-6 text-stone-600">
        This name is shown to people who share a Town Red map with you.
      </p>

      <label class="mt-4 block text-sm font-medium text-stone-700">
        Display name
        <input
          v-model="displayName"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="text"
          maxlength="80"
          autocomplete="name"
          required
          autofocus
        />
      </label>

      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="mode = 'signin'">
          Already have an account? Sign in
        </button>
        <button type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy || !displayName.trim()">
          {{ busy ? 'Saving…' : 'Continue' }}
        </button>
      </div>
    </form>

    <div v-else class="p-5">
      <h2 class="m-0 text-lg font-semibold">Sign in to Town Red</h2>
      <OtpAuthForm mode="signin" :busy="authBusy" :error="authError" :success="authSuccess" @send="sendOtp" @verify="verifyOtp" />
      <div class="mt-4">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="mode = 'profile'">
          Use a new temporary identity
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
