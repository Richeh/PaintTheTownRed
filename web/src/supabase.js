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

export function isAnonymousSession(session) {
  return Boolean(session?.user?.is_anonymous);
}

async function createAnonymousSession() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.session?.user?.id) throw new Error('Supabase did not return an anonymous user.');
  return data.session;
}

/**
 * Return a server-validated Supabase session, creating an anonymous identity
 * only when this browser has no usable session yet.
 *
 * `getSession()` reads the locally persisted token. During development (and
 * after an auth user has been removed from the Supabase dashboard) that token
 * can outlive its row in auth.users. Using its stale uid as profiles.user_id
 * then fails the profiles_user_id_fkey foreign key. `getUser()` validates the
 * token against Supabase Auth before we trust it for database writes.
 */
export async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const session = sessionData.session;
  if (!session) return createAnonymousSession();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const validatedUser = userData?.user;

  if (!userError && validatedUser?.id && validatedUser.id === session.user?.id) {
    // Prefer the freshly validated user object while retaining the access and
    // refresh tokens carried by the existing session.
    return { ...session, user: validatedUser };
  }

  console.warn('[Town Red] Discarding stale Supabase session', userError || {
    sessionUserId: session.user?.id,
    validatedUserId: validatedUser?.id,
  });

  // Local scope clears only this browser's persisted session; it does not
  // revoke sessions on other devices belonging to a persistent account.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return createAnonymousSession();
}

/**
 * Start converting the currently signed-in anonymous identity to a permanent
 * email identity. Supabase keeps the same auth user id, so map ownership and
 * memberships continue to refer to the same user.
 */
export async function sendAccountClaimOtp(email) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const session = sessionData.session;
  if (!session?.user?.id) throw new Error('No Town Red session is available to save.');
  if (!isAnonymousSession(session)) throw new Error('This Town Red identity is already saved.');

  const { error } = await supabase.auth.updateUser({ email: email.trim() });
  if (error) throw error;
}

/** Verify the code sent while attaching an email to an anonymous user. */
export async function verifyAccountClaimOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: String(token || '').trim(),
    type: 'email_change',
  });
  if (error) throw error;
  if (!data.session) throw new Error('Supabase verified the email but did not return a session.');
  return data.session;
}

/**
 * Send a returning-user OTP. shouldCreateUser:false is intentional: a typo or
 * unknown email must not silently create another Town Red identity.
 */
export async function sendSignInOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

/** Verify a returning-user OTP and replace the browser's current session. */
export async function verifySignInOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: String(token || '').trim(),
    type: 'email',
  });
  if (error) throw error;
  if (!data.session) throw new Error('Supabase verified the code but did not return a session.');
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
