<script setup>
import { computed, onMounted, ref } from 'vue';
import { getProfile } from '../data.js';
import { isAnonymousSession, supabase } from '../supabase.js';
import AccountDialog from './AccountDialog.vue';

// AuthDock is intentionally independent from the map application state. It
// reads the persisted Supabase session and teleports account controls into the
// existing header/footer. Successful sign-in/claim/sign-out flows reload the
// page, so the map app always boots under exactly one authoritative identity.
const session = ref(null);
const profile = ref(null);
const open = ref(false);

const anonymous = computed(() => isAnonymousSession(session.value));
const email = computed(() => session.value?.user?.email || '');
const buttonLabel = computed(() => anonymous.value ? 'Save / sign in' : 'Account');
const identityLabel = computed(() => {
  const name = profile.value?.display_name || 'Town Red user';
  if (anonymous.value) return `${name} · temporary identity`;
  return email.value ? `${name} · ${email.value}` : `${name} · saved identity`;
});

async function loadIdentity() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  session.value = data.session;
  const userId = data.session?.user?.id;
  profile.value = userId ? await getProfile(userId) : null;
}

onMounted(() => {
  loadIdentity().catch((error) => console.warn('[Town Red] could not load account status', error));
});
</script>

<template>
  <Teleport to="header > div:first-child > div:last-child">
    <button
      type="button"
      class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50"
      @click="open = true"
    >
      {{ buttonLabel }}
    </button>
  </Teleport>

  <Teleport to="footer > span:first-child">
    <span class="town-red-auth-identity">{{ identityLabel }}</span>
  </Teleport>

  <AccountDialog :open="open" :anonymous="anonymous" :email="email" @close="open = false" />
</template>

<style>
/* App.vue's original baseline identity text is a text node. Hiding the parent
   font size lets the Vue auth status replace it without any DOM mutation. */
footer > span:first-child { font-size: 0; }
footer > span:first-child .town-red-auth-identity { font-size: 0.875rem; }
</style>
