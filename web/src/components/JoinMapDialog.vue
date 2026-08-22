<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';

// JoinMapDialog accepts either the bare invite token or the full Town Red URL.
// App.vue normalises and redeems the value; the dialog only collects input and
// displays busy/error state.
const props = defineProps({
  open: Boolean,
  busy: Boolean,
  error: { type: String, default: '' },
  initialValue: { type: String, default: '' },
});
const emit = defineEmits(['close', 'submit']);
const invite = ref('');

// When opened automatically from an invite URL, pre-fill the token/link so the
// same component can support both manual joining and URL-driven onboarding.
watch(() => props.open, (open) => {
  if (open) invite.value = props.initialValue;
});
</script>

<template>
  <BaseDialog :open="open" @close="emit('close')">
    <form class="p-5" @submit.prevent="emit('submit', invite.trim())">
      <h2 class="m-0 text-lg font-semibold">Join a map</h2>
      <p class="mt-1 text-sm text-stone-600">Paste either a Town Red invite token or a full invite link.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Invite
        <input
          v-model="invite"
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
          type="text"
          autocomplete="off"
          required
        />
      </label>
      <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Cancel</button>
        <button type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:opacity-50" :disabled="busy || !invite.trim()">{{ busy ? 'Joining…' : 'Join map' }}</button>
      </div>
    </form>
  </BaseDialog>
</template>
