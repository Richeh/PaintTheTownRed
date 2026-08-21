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

export async function beginAccountClaim(email) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const session = sessionData.session;
  if (!session?.user?.id) throw new Error('No Town Red session is available to save.');
  if (!session.user.is_anonymous) throw new Error('This Town Red identity is already saved.');

  const { data, error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
  return data;
}

export async function verifyAccountClaim(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: String(token || '').trim(),
    type: 'email_change',
  });
  if (error) throw error;
  return data.session;
}

export async function sendSignInOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function verifySignInOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: String(token || '').trim(),
    type: 'email',
  });
  if (error) throw error;
  return withProfile(data.session);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
