<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';
import OtpAuthForm from './OtpAuthForm.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  anonymous: { type: Boolean, default: true },
  email: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  success: { type: String, default: '' },
});

const emit = defineEmits(['close', 'send-claim', 'verify-claim', 'send-signin', 'verify-signin', 'signout']);
const mode = ref('claim');

watch(
  () => props.open,
  (open) => {
    if (open) mode.value = props.anonymous ? 'claim' : 'account';
  },
);
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
          <button type="button" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50" :disabled="busy" @click="emit('signout')">{{ busy ? 'Signing out…' : 'Sign out' }}</button>
        </div>
      </template>

      <template v-else>
        <div class="mt-3 flex gap-2 border-b border-stone-200 pb-3">
          <button type="button" class="rounded-lg px-3 py-2 text-sm font-semibold" :class="mode === 'claim' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'" @click="mode = 'claim'">Save this identity</button>
          <button type="button" class="rounded-lg px-3 py-2 text-sm font-semibold" :class="mode === 'signin' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'" @click="mode = 'signin'">Sign in instead</button>
        </div>

        <OtpAuthForm
          :key="mode"
          :mode="mode"
          :busy="busy"
          :error="error"
          :success="success"
          @send="(email, done) => mode === 'claim' ? emit('send-claim', email, done) : emit('send-signin', email, done)"
          @verify="(email, token) => mode === 'claim' ? emit('verify-claim', email, token) : emit('verify-signin', email, token)"
        />

        <div class="mt-4 flex justify-end">
          <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Cancel</button>
        </div>
      </template>
    </div>
  </BaseDialog>
</template>
