<script setup>
import { ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';

const props = defineProps({
  open: Boolean,
  mapName: { type: String, default: 'this map' },
  busy: Boolean,
  error: { type: String, default: '' },
  inviteUrl: { type: String, default: '' },
  inviteToken: { type: String, default: '' },
});
const emit = defineEmits(['close', 'submit']);
const role = ref('editor');
const maxUses = ref('1');

watch(() => props.open, (open) => {
  if (open) {
    role.value = 'editor';
    maxUses.value = '1';
  }
});

function submit() {
  const raw = maxUses.value.trim();
  const parsed = raw === '' ? null : Number(raw);
  emit('submit', { role: role.value, maxUses: parsed });
}

async function copyInvite() {
  if (!props.inviteUrl) return;
  await navigator.clipboard.writeText(props.inviteUrl);
}
</script>

<template>
  <BaseDialog :open="open" @close="emit('close')">
    <div class="p-5">
      <h2 class="m-0 text-lg font-semibold">Invite collaborators</h2>
      <p class="mt-1 text-sm text-stone-600">Create a share link for “{{ mapName }}”.</p>

      <form v-if="!inviteUrl" @submit.prevent="submit">
        <label class="mt-4 block text-sm font-medium text-stone-700">
          Access
          <select v-model="role" class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100">
            <option value="editor">Editor — can paint</option>
            <option value="viewer">Viewer — view only</option>
          </select>
        </label>
        <label class="mt-4 block text-sm font-medium text-stone-700">
          Maximum uses
          <input v-model="maxUses" class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" type="number" min="1" step="1" placeholder="Leave blank for unlimited" />
          <span class="mt-1 block text-xs font-normal text-stone-500">Leave blank for an unlimited-use link.</span>
        </label>
        <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="emit('close')">Close</button>
          <button type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:opacity-50" :disabled="busy">{{ busy ? 'Creating…' : 'Create invite' }}</button>
        </div>
      </form>

      <div v-else class="mt-4">
        <label class="block text-sm font-medium text-stone-700">Invite link</label>
        <div class="mt-1 flex gap-2">
          <input :value="inviteUrl" class="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700" type="text" readonly />
          <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50" @click="copyInvite">Copy</button>
        </div>
        <details v-if="inviteToken" class="mt-3 text-sm text-stone-600">
          <summary class="cursor-pointer select-none">Show raw token</summary>
          <code class="mt-2 block break-all rounded-lg bg-stone-100 p-3 text-xs text-stone-700">{{ inviteToken }}</code>
        </details>
        <div class="mt-5 flex justify-end">
          <button type="button" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900" @click="emit('close')">Close</button>
        </div>
      </div>
    </div>
  </BaseDialog>
</template>
