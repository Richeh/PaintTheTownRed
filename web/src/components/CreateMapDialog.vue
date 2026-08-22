<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';

// This component is deliberately presentation-only: it collects a map name
// and emits it to App.vue. Database creation, selection and error recovery all
// remain in the application controller rather than being hidden in the dialog.
const props = defineProps({
  open: Boolean,
  busy: Boolean,
  error: { type: String, default: '' },
});
const emit = defineEmits(['close', 'submit']);
const name = ref('House Search');

// Reopening the dialog starts from a friendly default instead of retaining a
// half-entered name from a cancelled attempt.
watch(() => props.open, (open) => {
  if (open) name.value = 'House Search';
});
</script>

<template>
  <BaseDialog :open="open" @close="emit('close')">
    <form class="p-5" @submit.prevent="emit('submit', name.trim())">
      <h2 class="m-0 text-lg font-semibold">Create a map</h2>
      <p class="mt-1 text-sm text-stone-600">Create a new shared Town Red overlay.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Map name
        <input
          v-model="name"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="text"
          maxlength="120"
          required
        />
      </label>
      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Cancel</button>
        <button type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:opacity-50" :disabled="busy || !name.trim()">{{ busy ? 'Creating…' : 'Create map' }}</button>
      </div>
    </form>
  </BaseDialog>
</template>
