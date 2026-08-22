<script setup>
import { computed, ref, watch } from 'vue';

// This is intentionally a dumb, reusable two-step form. It does not call
// Supabase itself: AccountDialog and ProfileDialog decide whether a code means
// "claim this anonymous identity" or "sign into an existing identity".
const props = defineProps({
  mode: { type: String, required: true }, // 'claim' | 'signin'
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  success: { type: String, default: '' },
});

const emit = defineEmits(['send', 'verify']);
const email = ref('');
const token = ref('');
const codeSent = ref(false);

const isClaim = computed(() => props.mode === 'claim');

// Supabase email OTP length is configurable. Hosted projects may emit any
// numeric code from 6 to 10 digits, so the UI must not assume the default 6.
const validToken = computed(() => /^\d{6,10}$/.test(token.value.trim()));

// Switching between "save identity" and "sign in" is a genuinely new auth
// attempt, so do not carry an email/code from the previous mode into it.
watch(
  () => props.mode,
  () => {
    email.value = '';
    token.value = '';
    codeSent.value = false;
  },
);

// The parent receives a callback rather than us immediately setting codeSent.
// It calls markSent only after Supabase has accepted the email-send request.
function send() {
  const address = email.value.trim();
  if (address) emit('send', address, () => { codeSent.value = true; });
}

function verify() {
  const code = token.value.trim();
  if (validToken.value) emit('verify', email.value.trim(), code);
}

// Let the user correct an address without closing/reopening the surrounding
// dialog. The email stays populated as a convenience; only the code is reset.
function startAgain() {
  token.value = '';
  codeSent.value = false;
}
</script>

<template>
  <div>
    <p class="mt-1 text-sm leading-6 text-stone-600">
      <template v-if="isClaim">
        Save this Town Red identity with your email address. We’ll send a verification code; no password is required.
      </template>
      <template v-else>
        Enter the email address for your saved Town Red identity and we’ll send a sign-in code.
      </template>
    </p>

    <!-- Step one exists alone in the DOM until the email send succeeds. -->
    <form v-if="!codeSent" class="mt-4" @submit.prevent="send">
      <label class="block text-sm font-medium text-stone-700">
        Email
        <input
          v-model="email"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="email"
          autocomplete="email"
          required
          autofocus
        />
      </label>

      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
      <p v-if="success" class="mt-3 text-sm text-emerald-700">{{ success }}</p>

      <div class="mt-5 flex justify-end">
        <button
          type="submit"
          class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !email.trim()"
        >
          {{ busy ? 'Sending…' : (isClaim ? 'Send verification code' : 'Send sign-in code') }}
        </button>
      </div>
    </form>

    <!-- Step two replaces the email form; it is never merely hidden by CSS. -->
    <form v-else class="mt-4" @submit.prevent="verify">
      <p class="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
        Code sent to <strong>{{ email }}</strong>.
      </p>

      <label class="mt-3 block text-sm font-medium text-stone-700">
        Verification code
        <input
          v-model="token"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm tracking-[0.25em] text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6,10}"
          minlength="6"
          maxlength="10"
          required
          autofocus
        />
      </label>
      <p class="mt-1 text-xs text-stone-500">Enter the numeric code from your Town Red email.</p>

      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
      <p v-if="success" class="mt-3 text-sm text-emerald-700">{{ success }}</p>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="startAgain">
          Change email
        </button>
        <button
          type="submit"
          class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !validToken"
        >
          {{ busy ? 'Checking…' : (isClaim ? 'Save identity' : 'Sign in') }}
        </button>
      </div>
    </form>
  </div>
</template>
