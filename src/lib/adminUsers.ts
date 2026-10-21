import { supabase } from './supabase';

/** Calls the admin-users Edge Function (service role lives there, never in the app). */
export async function callAdmin(action: 'create' | 'update' | 'set_password' | 'delete', payload: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch {}
    if (/failed to send|not found|404/i.test(msg)) msg = 'The admin-users function is not deployed yet. See supabase/functions/admin-users/README.md.';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
