<script setup>
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  closeOnBackdrop: { type: Boolean, default: true },
});

const emit = defineEmits(['close']);
const dialog = ref(null);

// Native <dialog> gives us focus trapping and escape-key semantics. Vue owns
// only the desired open/closed state; this watcher synchronises that state
// with the imperative browser API.
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (!dialog.value) return;
    if (open && !dialog.value.open) dialog.value.showModal();
    if (!open && dialog.value.open) dialog.value.close();
  },
  { immediate: true },
);

function requestClose() {
  emit('close');
}

function onCancel(event) {
  event.preventDefault();
  requestClose();
}

function onClick(event) {
  if (props.closeOnBackdrop && event.target === dialog.value) requestClose();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40"
    @cancel="onCancel"
    @click="onClick"
  >
    <slot />
  </dialog>
</template>
