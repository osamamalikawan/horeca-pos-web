import { supabase } from './supabase';

const NOT_DEPLOYED = 'The admin-users function is not deployed yet. In Supabase open Edge Functions and deploy it (steps: supabase/functions/admin-users/README.md).';

/** Calls the admin-users Edge Function (service role lives there, never in the app). */
export async function callAdmin(action: 'create' | 'update' | 'set_password' | 'delete', payload: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) {
    // what the server answered (the response can only be read once, so read a copy)
    const res = (error as any).context as Response | undefined;
    let body: any = null;
    try { body = await res?.clone?.().json?.(); } catch { /* not JSON */ }
    const status = res?.status;
    if (body?.error) throw new Error(body.error);                     // our function's own message, e.g. "User not found"
    if (status === 404 || /requested function was not found/i.test(body?.message ?? '')) throw new Error(NOT_DEPLOYED);
    if (status === 401 || /jwt/i.test(body?.message ?? '')) {
      throw new Error('The user service did not accept your sign-in. Redeploy admin-users with "Verify JWT" turned off (the function checks the sign-in itself), then try again.');
    }
    if ((error as any).name === 'FunctionsFetchError' || /failed to send/i.test(error.message)) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline. Connect to the internet and try again.');
      // Online but no answer: Supabase answers a missing function (and a blocked CORS check) without CORS headers, so the browser reports it as a network failure.
      throw new Error('The user service did not answer. In Supabase open Edge Functions: admin-users must be deployed with the latest index.ts from the repo (steps: supabase/functions/admin-users/README.md). Then try again.');
    }
    throw new Error(body?.message || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
