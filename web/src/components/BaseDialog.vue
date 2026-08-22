<script setup>
import { nextTick, ref, watch } from 'vue';

// BaseDialog is the one place where Vue's declarative `open` prop meets the
// browser's imperative <dialog> API. Feature dialogs compose this component so
// they all inherit the same focus trapping, Escape handling and backdrop rules.
const props = defineProps({
  open: { type: Boolean, default: false },
  closeOnBackdrop: { type: Boolean, default: true },
});

const emit = defineEmits(['close']);
const dialog = ref(null);

// Native <dialog> gives us focus trapping and escape-key semantics. Vue owns
// only the desired open/closed state; this watcher synchronises that state
// with the imperative browser API after the DOM has caught up.
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

// Feature dialogs react to the emitted close event and update their own state;
// BaseDialog never mutates a parent's `open` prop directly.
function requestClose() {
  emit('close');
}

// Prevent the native dialog from closing behind Vue's back. Emitting first
// keeps the component tree as the single source of truth.
function onCancel(event) {
  event.preventDefault();
  requestClose();
}

// A click whose target is the <dialog> itself landed on the backdrop rather
// than on dialog content.
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
