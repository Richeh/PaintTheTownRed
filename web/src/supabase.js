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

  // Email/password identities are linked with updateUser(), not linkIdentity().
  // This keeps the current auth.uid(), so existing Town Red ownership and memberships survive.
  const { data: emailData, error: emailError } = await supabase.auth.updateUser({ email });
  if (emailError) throw emailError;

  // Supabase requires the email to be verified before a password can be attached.
  // On projects where verification is immediate/disabled this succeeds straight away;
  // otherwise the caller can ask the user to verify and then finish the password later.
  const { data: passwordData, error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) {
    return {
      session: emailData.session || session,
      emailPendingVerification: true,
      passwordSet: false,
      passwordError,
    };
  }

  return {
    session: passwordData.session || emailData.session || session,
    emailPendingVerification: false,
    passwordSet: true,
    passwordError: null,
  };
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
