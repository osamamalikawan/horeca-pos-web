import { supabase } from './supabase';

export const SYNC_LIMIT_MS = 72 * 60 * 60 * 1000;   // must sync at least every 3 days
export const LOCK_KEY = 'horeca-lock';
export const SEEN_KEY = 'horeca-last-seen';          // latest clock reading, to spot a clock set back
export const SUB_CHECKED_KEY = 'horeca-sub-checked'; // last time the subscription switch was actually read

export type LockReason = 'sync' | 'clock' | 'paused' | 'stopped' | 'expired' | 'disabled';

export const LOCK_MESSAGES: Record<LockReason, string> = {
  sync: 'You were signed out because this device has not synced for 3 days. Sign in while online to continue. Unsynced sales are kept and upload after you sign in.',
  clock: 'You were signed out because the device clock was set back. Sign in while online to continue.',
  paused: 'Your subscription is paused. Contact support to resume it.',
  stopped: 'Your subscription has ended. Contact support to renew it.',
  expired: 'Your subscription has expired. Contact support to renew it.',
  disabled: 'Your account has been disabled. Contact the administrator.',
};

export function readLock(): string {
  try { const r = localStorage.getItem(LOCK_KEY) as LockReason | null; return r ? LOCK_MESSAGES[r] ?? '' : ''; } catch { return ''; }
}

/** Sign out this device. Local data stays on disk; the session is cleared without needing internet. */
export function lockDevice(reason: LockReason) {
  localStorage.setItem(LOCK_KEY, reason);
  supabase?.auth.signOut({ scope: 'local' });
}

/**
 * Sync type 1: reads the subscription switch. It is its own small request, so it runs first and does not
 * depend on the data sync (a broken data sync must never hide a paused or ended subscription).
 * Anything unreadable (offline, table missing) counts as active, and `reached` says whether it was really read.
 */
export async function checkSubscription(): Promise<{ ok: true; reached: boolean } | { ok: false; reason: LockReason }> {
  if (!supabase) return { ok: true, reached: false };
  try {
    const { data, error } = await supabase.from('subscription').select('status, valid_until').limit(1).maybeSingle();
    if (error || !data) return { ok: true, reached: false };
    try { localStorage.setItem(SUB_CHECKED_KEY, new Date().toISOString()); } catch { /* ignore */ }
    if (data.status === 'paused') return { ok: false, reason: 'paused' };
    if (data.status === 'stopped') return { ok: false, reason: 'stopped' };
    if (data.valid_until && new Date(data.valid_until).getTime() < Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, reached: true };
  } catch { return { ok: true, reached: false }; }
}
