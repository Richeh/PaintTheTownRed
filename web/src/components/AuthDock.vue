<script setup>
import { computed, onMounted, ref } from 'vue';
import { getProfile } from '../data.js';
import { isAnonymousSession, supabase } from '../supabase.js';
import AccountDialog from './AccountDialog.vue';

// AuthDock is intentionally independent from the map application state. It
// reads the persisted Supabase session and teleports account controls into the
// existing header/footer. Successful sign-in/claim/sign-out flows reload the
// page, so the map app always boots under exactly one authoritative identity.
//
// This split also means App.vue does not need to understand email addresses or
// OTP state: it continues to work entirely in terms of the current auth.uid().
const session = ref(null);
const profile = ref(null);
const open = ref(false);

// Anonymous users are offered persistence/sign-in actions; saved users see a
// normal account button instead.
const anonymous = computed(() => isAnonymousSession(session.value));
const email = computed(() => session.value?.user?.email || '');
const buttonLabel = computed(() => anonymous.value ? 'Save / sign in' : 'Account');

// This footer string is the human-facing identity summary. Profiles supply the
// collaborative display name, while Supabase Auth supplies persistence/email.
const identityLabel = computed(() => {
  const name = profile.value?.display_name || 'Town Red user';
  if (anonymous.value) return `${name} · temporary identity`;
  return email.value ? `${name} · ${email.value}` : `${name} · saved identity`;
});

// Load session and profile together so the account button/footer cannot briefly
// describe one user while showing another user's display name.
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
  <!-- Teleport lets auth remain a separate Vue tree while appearing in the
       header/footer owned by App.vue. -->
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
