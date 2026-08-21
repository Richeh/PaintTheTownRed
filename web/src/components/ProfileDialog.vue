<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';
import OtpAuthForm from './OtpAuthForm.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  authSuccess: { type: String, default: '' },
});

const emit = defineEmits(['submit', 'send-signin', 'verify-signin']);
const displayName = ref('');
const mode = ref('profile');

watch(
  () => props.open,
  (open) => {
    if (open) {
      displayName.value = '';
      mode.value = 'profile';
    }
  },
);

function submit() {
  const value = displayName.value.trim();
  if (value) emit('submit', value);
}
</script>

<template>
  <!-- This dialog cannot be dismissed because a fresh anonymous identity needs
       either a display name or an explicit switch to a saved identity. -->
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
        <button
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50"
          @click="mode = 'signin'"
        >
          Already have an account? Sign in
        </button>
        <button
          type="submit"
          class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !displayName.trim()"
        >
          {{ busy ? 'Saving…' : 'Continue' }}
        </button>
      </div>
    </form>

    <div v-else class="p-5">
      <h2 class="m-0 text-lg font-semibold">Sign in to Town Red</h2>
      <OtpAuthForm
        mode="signin"
        :busy="busy"
        :error="error"
        :success="authSuccess"
        @send="(email, done) => emit('send-signin', email, done)"
        @verify="(email, token) => emit('verify-signin', email, token)"
      />
      <div class="mt-4">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="mode = 'profile'">
          Use a new temporary identity
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
