<script setup>
import BaseDialog from './BaseDialog.vue';

// A deliberately tiny generic modal for errors/notices that need more space
// than the status pill. Keeping this separate prevents App.vue from duplicating
// dialog markup every time it needs to explain a recoverable failure.
defineProps({
  open: Boolean,
  title: { type: String, default: 'Town Red' },
  body: { type: String, default: '' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <BaseDialog :open="open" @close="emit('close')">
    <div class="p-5">
      <h2 class="m-0 text-lg font-semibold">{{ title }}</h2>
      <p class="mt-3 whitespace-pre-wrap text-sm text-stone-600">{{ body }}</p>
      <div class="mt-5 flex justify-end">
        <button type="button" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900" @click="emit('close')">OK</button>
      </div>
    </div>
  </BaseDialog>
</template>
