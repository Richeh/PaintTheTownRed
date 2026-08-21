<script setup>
import { computed, ref, watch } from 'vue';

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

watch(
  () => props.mode,
  () => {
    email.value = '';
    token.value = '';
    codeSent.value = false;
  },
);

function send() {
  const address = email.value.trim();
  if (address) emit('send', address, () => { codeSent.value = true; });
}

function verify() {
  const code = token.value.trim();
  if (/^\d{6}$/.test(code)) emit('verify', email.value.trim(), code);
}

function startAgain() {
  token.value = '';
  codeSent.value = false;
}
</script>

<template>
  <div>
    <p class="mt-1 text-sm leading-6 text-stone-600">
      <template v-if="isClaim">
        Save this Town Red identity with your email address. We’ll send a six-digit verification code; no password is required.
      </template>
      <template v-else>
        Enter the email address for your saved Town Red identity and we’ll send a six-digit sign-in code.
      </template>
    </p>

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

    <form v-else class="mt-4" @submit.prevent="verify">
      <p class="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
        Code sent to <strong>{{ email }}</strong>.
      </p>

      <label class="mt-3 block text-sm font-medium text-stone-700">
        Six-digit code
        <input
          v-model="token"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm tracking-[0.25em] text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
          required
          autofocus
        />
      </label>

      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
      <p v-if="success" class="mt-3 text-sm text-emerald-700">{{ success }}</p>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="startAgain">
          Change email
        </button>
        <button
          type="submit"
          class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !/^\d{6}$/.test(token.trim())"
        >
          {{ busy ? 'Checking…' : (isClaim ? 'Save identity' : 'Sign in') }}
        </button>
      </div>
    </form>
  </div>
</template>
