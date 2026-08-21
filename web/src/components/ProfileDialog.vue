<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['submit']);
const displayName = ref('');

watch(
  () => props.open,
  (open) => {
    if (open) displayName.value = '';
  },
);

function submit() {
  const value = displayName.value.trim();
  if (value) emit('submit', value);
}
</script>

<template>
  <!-- This dialog deliberately cannot be dismissed: a display name is the
       only onboarding step in the anonymous-only baseline. -->
  <BaseDialog :open="open" :close-on-backdrop="false">
    <form class="p-5" @submit.prevent="submit">
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

      <div class="mt-5 flex justify-end">
        <button
          type="submit"
          class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !displayName.trim()"
        >
          {{ busy ? 'Saving…' : 'Continue' }}
        </button>
      </div>
    </form>
  </BaseDialog>
</template>
