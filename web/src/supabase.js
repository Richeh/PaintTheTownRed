import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase configuration. Copy web/.env.example to web/.env and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

async function withProfile(session) {
  if (!session?.user?.id) return session;
  const { ensureProfile } = await import('./profile.js');
  await ensureProfile(session.user.id);
  return session;
}

export function isAnonymousSession(session) {
  return Boolean(session?.user?.is_anonymous);
}

export async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) return withProfile(sessionData.session);

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return withProfile(data.session);
}

export async function claimAnonymousAccount(email, password) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const session = sessionData.session;
  if (!session?.user?.id) throw new Error('No Town Red session is available to save.');
  if (!session.user.is_anonymous) throw new Error('This Town Red identity is already a saved account.');

  // Linking the email identity upgrades the existing anonymous auth user, preserving auth.uid().
  const { data: linkData, error: linkError } = await supabase.auth.linkIdentity({
    provider: 'email',
    options: { email },
  });
  if (linkError) throw linkError;

  // Supabase may require email verification before it permits credentials to be updated.
  // Try now so projects without confirmation requirements complete in one step; otherwise
  // the UI tells the user to verify and return to finish setting the password.
  const { data: passwordData, error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) {
    return { session, linkData, passwordSet: false, passwordError };
  }
  return { session: passwordData.session || session, linkData, passwordSet: true, passwordError: null };
}

export async function finishAccountPassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return withProfile(data.session);
}

export async function sendPasswordReset(email) {
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
