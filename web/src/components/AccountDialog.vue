<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';
import OtpAuthForm from './OtpAuthForm.vue';
import {
  sendAccountClaimOtp,
  sendSignInOtp,
  signOut,
  verifyAccountClaimOtp,
  verifySignInOtp,
} from '../supabase.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  anonymous: { type: Boolean, default: true },
  email: { type: String, default: '' },
});

const emit = defineEmits(['close']);
const mode = ref('claim');
const busy = ref(false);
const error = ref('');
const success = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = props.anonymous ? 'claim' : 'account';
    error.value = '';
    success.value = '';
  },
);

function errorText(value) {
  return value instanceof Error ? value.message : String(value);
}

async function sendOtp(email, markSent) {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    if (mode.value === 'claim') await sendAccountClaimOtp(email);
    else await sendSignInOtp(email);
    markSent();
    success.value = `A six-digit code has been sent to ${email}.`;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function verifyOtp(email, token) {
  busy.value = true;
  error.value = '';
  try {
    if (mode.value === 'claim') {
      await verifyAccountClaimOtp(email, token);
      success.value = 'Identity saved. Reloading Town Red…';
    } else {
      await verifySignInOtp(email, token);
      success.value = 'Signed in. Loading your Town Red maps…';
    }
    location.reload();
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function doSignOut() {
  busy.value = true;
  error.value = '';
  try {
    await signOut();
    // A fresh load creates a new anonymous session and returns to onboarding.
    location.reload();
  } catch (err) {
    error.value = errorText(err);
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog :open="open" @close="emit('close')">
    <div class="p-5">
      <h2 class="m-0 text-lg font-semibold">Town Red account</h2>

      <template v-if="!anonymous">
        <p class="mt-2 text-sm leading-6 text-stone-600">
          This identity is saved and can be recovered on another device with an email sign-in code.
        </p>
        <p v-if="email" class="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{{ email }}</p>
        <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Close</button>
          <button type="button" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50" :disabled="busy" @click="doSignOut">{{ busy ? 'Signing out…' : 'Sign out' }}</button>
        </div>
      </template>

      <template v-else>
        <div class="mt-3 flex gap-2 border-b border-stone-200 pb-3">
          <button type="button" class="rounded-lg px-3 py-2 text-sm font-semibold" :class="mode === 'claim' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'" @click="mode = 'claim'; error = ''; success = ''">Save this identity</button>
          <button type="button" class="rounded-lg px-3 py-2 text-sm font-semibold" :class="mode === 'signin' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'" @click="mode = 'signin'; error = ''; success = ''">Sign in instead</button>
        </div>

        <OtpAuthForm :key="mode" :mode="mode" :busy="busy" :error="error" :success="success" @send="sendOtp" @verify="verifyOtp" />

        <div class="mt-4 flex justify-end">
          <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Cancel</button>
        </div>
      </template>
    </div>
  </BaseDialog>
</template>
